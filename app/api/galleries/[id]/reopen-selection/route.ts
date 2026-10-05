import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  // נעילה בחזרה (reopened_for_selection_at -> null) תמיד מותרת - זו רק
  // חזרה למצב "הושלם" הרגיל. פתיחה מחדש רלוונטית רק כשהבחירה באמת הושלמה -
  // גלריה שעדיין בבחירה (sent/in_progress) כבר פתוחה לעריכה כרגיל.
  if (!gallery.reopened_for_selection_at && gallery.status !== 'completed') {
    return NextResponse.json({ error: 'אפשר לפתוח מחדש רק גלריה שהבחירה בה כבר הושלמה' }, { status: 400 });
  }

  // תמונות המקור נמחקות 30 יום אחרי המסירה (cron, originals_cleaned_up_at) -
  // אין יותר מה לבחור מתוכו.
  if (!gallery.reopened_for_selection_at && gallery.originals_cleaned_up_at) {
    return NextResponse.json(
      { error: 'אי אפשר לפתוח מחדש את הבחירה - תמונות המקור של הגלריה כבר נמחקו' },
      { status: 409 }
    );
  }

  const newReopenedForSelectionAt = gallery.reopened_for_selection_at ? null : new Date().toISOString();

  const { error } = await supabase
    .from('galleries')
    .update({ reopened_for_selection_at: newReopenedForSelectionAt })
    .eq('id', gallery.id);

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

  return NextResponse.json({ reopenedForSelectionAt: newReopenedForSelectionAt });
}
