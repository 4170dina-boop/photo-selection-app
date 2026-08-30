import type { SupabaseClient } from '@supabase/supabase-js';

// בדיקה משותפת ל-selection/note routes: אחרי שהלקוחה לוחצת "סיימתי לבחור"
// (app/api/gallery/[id]/finish/route.ts) או שתוקף הגלריה פג, אסור לאפשר
// עוד שינויים - זה מה שהופך את "completed"/"expired" למשמעותיים בפועל,
// ולא רק תווית בדשבורד.
export async function checkGalleryWritable(
  supabaseAdmin: SupabaseClient,
  galleryId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('status, expires_at')
    .eq('id', galleryId)
    .single();

  if (!gallery) {
    return { ok: false, status: 404, error: 'גלריה לא נמצאה' };
  }
  if (gallery.expires_at && new Date(gallery.expires_at) < new Date()) {
    return { ok: false, status: 410, error: 'תוקף הגלריה פג' };
  }
  if (gallery.status === 'completed') {
    return { ok: false, status: 403, error: 'הבחירה כבר נשלחה - אי אפשר לערוך אותה יותר' };
  }

  return { ok: true };
}
