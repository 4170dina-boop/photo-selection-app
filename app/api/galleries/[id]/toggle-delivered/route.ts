import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { nextToggleTimestamp, readToggleValue } from '@/lib/toggleValue';
import { canDeliverFinals, REOPEN_CONFLICT_MESSAGE, SELECTION_NOT_FINAL_MESSAGE } from '@/lib/galleryLifecycle';
import { applyRowGuard, type RowGuard } from '@/lib/rowGuard';

// הופכת (toggle) את סימון "נמסר" - "הושלם" (galleries.status) אומר רק שהלקוחה
// סיימה לבחור, לא שהתמונות המוגמרות בפועל כבר נשלחו/נמסרו אליה. שדה נפרד
// (delivered_at) כדי שאפשר יהיה לראות ברשימת הגלריות אילו גלריות "הושלמו"
// אבל עדיין ממתינות למסירה בפועל. רץ עם session הצלם, אותו דפוס בעלות כמו
// app/api/galleries/[id]/route.ts.
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
    .select('id, delivered_at, status, reopened_for_selection_at')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const newDeliveredAt = nextToggleTimestamp(gallery.delivered_at, await readToggleValue(req), new Date().toISOString());

  // סימון "נמסר" מתחיל את ספירת 30 הימים למחיקת המקור (cron/tick) - מותר רק
  // אחרי שהלקוחה סיימה לבחור. ביטול סימון קיים מותר תמיד.
  if (newDeliveredAt && !gallery.delivered_at && !canDeliverFinals(gallery)) {
    return NextResponse.json({ error: SELECTION_NOT_FINAL_MESSAGE }, { status: 409 });
  }

  // אין שינוי בפועל (למשל value=true על גלריה שכבר מסומנת) - לא נוגעים בשורה,
  // כדי לא לאפס בטעות התראת מחיקה שכבר נשלחה על המסירה הנוכחית
  if (newDeliveredAt === gallery.delivered_at) {
    return NextResponse.json({ deliveredAt: newDeliveredAt });
  }

  // כל שינוי ב-delivered_at מאפס גם את התראת מחיקת המקור - ההתראה הקודמת
  // (אם נשלחה) דיברה על תאריך מסירה אחר, ו-cron/tick מוחק מקור רק אחרי
  // שנשלחה התראה על המסירה הנוכחית לפחות 5 ימים קודם.
  // עדכון מותנה במצב שנקרא (status / reopened_for_selection_at / delivered_at) -
  // אם הגלריה נפתחה מחדש לבחירה בינתיים, לא מסמנים "נמסר" על בסיס מצב ישן.
  const guard: RowGuard = {
    status: gallery.status ?? null,
    reopened_for_selection_at: gallery.reopened_for_selection_at ?? null,
    delivered_at: gallery.delivered_at ?? null,
  };
  const { data: updated, error } = await applyRowGuard(
    supabase
      .from('galleries')
      .update({ delivered_at: newDeliveredAt, originals_deletion_warning_sent_at: null })
      .eq('id', gallery.id),
    guard
  ).select('id');

  if (error) {
    return NextResponse.json({ error: 'עדכון סימון המסירה נכשל' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: REOPEN_CONFLICT_MESSAGE }, { status: 409 });
  }

  return NextResponse.json({ deliveredAt: newDeliveredAt });
}
