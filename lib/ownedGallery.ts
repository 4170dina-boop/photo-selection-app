import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// בדיקת "הצלמת המחוברת היא הבעלים של הגלריה" - אותו דפוס בדיוק כמו בשאר
// ה-routes תחת app/api/galleries/* (auth -> photographers -> galleries), רוכז
// כאן ל-routes של הפרקים. מחזיר את לקוח ה-session (RLS של הצלמת) או תשובת שגיאה.
export async function requireOwnedGallery(
  galleryId: string
): Promise<{ ok: true; supabase: ReturnType<typeof createClient> } | { ok: false; response: NextResponse }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: 'לא מחוברת' }, { status: 401 }) };

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();
  if (!photographer) return { ok: false, response: NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 }) };

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id')
    .eq('id', galleryId)
    .eq('photographer_id', photographer.id)
    .single();
  if (!gallery) return { ok: false, response: NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 }) };

  return { ok: true, supabase };
}
