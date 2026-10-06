import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { nextToggleTimestamp, readToggleValue } from '@/lib/toggleValue';
import { canStartEditing, EDITING_REQUIRES_COMPLETED_MESSAGE, REOPEN_CONFLICT_MESSAGE } from '@/lib/galleryLifecycle';
import { applyRowGuard, type RowGuard } from '@/lib/rowGuard';

// הופכת (toggle) את סימון "בעריכה" - שלב ביניים נפרד גם מ-status ('completed'
// אומר רק שהלקוחה סיימה לבחור) וגם מ-delivered_at (מסירת הקבצים הסופיים
// בפועל). שדה נפרד (editing_started_at) כדי שאפשר יהיה לראות ברשימת הגלריות
// אילו גלריות "הושלמו" כבר בעריכה בפועל. רץ עם session הצלם, אותו דפוס
// בעלות כמו app/api/galleries/[id]/toggle-delivered/route.ts.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, editing_started_at, status, reopened_for_selection_at')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const newEditingStartedAt = nextToggleTimestamp(gallery.editing_started_at, await readToggleValue(req), new Date().toISOString());

  // עריכה מתחילה רק אחרי שהלקוחה סיימה לבחור. ביטול סימון קיים מותר תמיד.
  if (newEditingStartedAt && !gallery.editing_started_at && !canStartEditing(gallery)) {
    return NextResponse.json({ error: EDITING_REQUIRES_COMPLETED_MESSAGE }, { status: 409 });
  }

  if (newEditingStartedAt === gallery.editing_started_at) {
    return NextResponse.json({ editingStartedAt: newEditingStartedAt });
  }

  // עדכון מותנה במצב שנקרא - אם הגלריה נפתחה מחדש לבחירה בינתיים (status /
  // reopened_for_selection_at השתנו), לא מסמנים "בעריכה" על בסיס מצב ישן
  const guard: RowGuard = {
    status: gallery.status ?? null,
    reopened_for_selection_at: gallery.reopened_for_selection_at ?? null,
    editing_started_at: gallery.editing_started_at ?? null,
  };
  const { data: updated, error } = await applyRowGuard(
    supabase.from('galleries').update({ editing_started_at: newEditingStartedAt }).eq('id', gallery.id),
    guard
  ).select('id');

  if (error) {
    return NextResponse.json({ error: 'עדכון סימון העריכה נכשל' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: REOPEN_CONFLICT_MESSAGE }, { status: 409 });
  }

  return NextResponse.json({ editingStartedAt: newEditingStartedAt });
}
