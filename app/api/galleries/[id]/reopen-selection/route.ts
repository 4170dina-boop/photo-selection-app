import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decideReopenToggle, REOPEN_CONFLICT_MESSAGE } from '@/lib/galleryLifecycle';
import { applyRowGuard } from '@/lib/rowGuard';

// הופכת (toggle) את "פתיחה מחדש לבחירה" - מאפשרת ללקוחה לערוך בחירות גם
// אחרי שלחצה "סיימתי לבחור", בלי להחזיר את galleries.status מ-completed
// לאחור (ראו ההערה המלאה על reopened_for_selection_at ב-supabase/schema.sql).
// גלריה שנפתחה מחדש נספרת כפעילה בחשבון חינמי - trg_enforce_active_gallery_limit
// חוסם פתיחה כשיש כבר גלריה פעילה אחרת (LIMIT_ACTIVE_GALLERY). checkGalleryWritable
// ב-lib/galleryAccess.ts היא זו שבפועל אוכפת את ההרשאה הזו על selection/note.
// רץ עם session הצלם, אותו דפוס בעלות כמו app/api/galleries/[id]/toggle-delivered/route.ts.
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
    .select('id, status, reopened_for_selection_at, originals_cleaned_up_at')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // ההחלטה (מה מותר, לאיזה ערך, ובאיזה תנאי) - decideReopenToggle ב-lib/galleryLifecycle.ts
  const decision = decideReopenToggle(gallery, new Date());
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.httpStatus });
  }
  const { newReopenedForSelectionAt } = decision;

  // UPDATE מותנה במצב שנקרא: ה-cron "תופס" גלריה לניקוי המקור ע"י סימון
  // originals_cleaned_up_at באותו אופן מותנה, כך שפתיחה מחדש והמחיקה לא יכולות
  // להצליח שתיהן. 0 שורות = הגלריה השתנתה מאז הקריאה (ניקוי מקור, סיום בחירה
  // מחדש של הלקוחה, לחיצה כפולה וכו').
  const { data: updated, error } = await applyRowGuard(
    supabase.from('galleries').update({ reopened_for_selection_at: newReopenedForSelectionAt }).eq('id', gallery.id),
    decision.guard
  ).select('id');

  if (error?.message?.includes('LIMIT_ACTIVE_GALLERY')) {
    return NextResponse.json(
      {
        error:
          'בחשבון חינמי אפשר רק גלריה פעילה אחת, וגלריה שנפתחה מחדש לבחירה נחשבת פעילה. השלימי או מחקי את הגלריה הפעילה האחרת ונסי שוב.',
      },
      { status: 402 }
    );
  }
  if (error) {
    return NextResponse.json({ error: 'עדכון סימון הפתיחה מחדש נכשל' }, { status: 500 });
  }
  if (!updated?.length) {
    const { data: fresh } = await supabase
      .from('galleries')
      .select('id, status, reopened_for_selection_at, originals_cleaned_up_at')
      .eq('id', gallery.id)
      .single();
    const freshDecision = fresh ? decideReopenToggle(fresh, new Date()) : null;
    const error =
      freshDecision && !freshDecision.ok && freshDecision.httpStatus === 409 ? freshDecision.error : REOPEN_CONFLICT_MESSAGE;
    return NextResponse.json({ error }, { status: 409 });
  }

  return NextResponse.json({ reopenedForSelectionAt: newReopenedForSelectionAt });
}
