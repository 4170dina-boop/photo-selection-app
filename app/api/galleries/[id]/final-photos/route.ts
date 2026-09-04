import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPresignedDownloadUrl } from '@/lib/r2';

// יחליף (בעתיד) את loadDeliveredPhotos ב-app/dashboard/galleries/[id]/edit/page.tsx,
// שהיום קורא ל-Supabase ישירות עם ה-session client (RLS דואג לבעלות שם) - ל-R2
// אין מקבילה ל-RLS, אז בדיקת הבעלות וחתימת ה-URL עוברות route ייעודי כאן.
//
// עדיין לא בשימוש בפועל - נוסף כתשתית תוסף בלבד לפני המעבר האטומי.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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
    .select('id')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const { data: rows } = await supabase
    .from('delivered_photos')
    .select('id, file_path, original_filename')
    .eq('gallery_id', params.id)
    .order('created_at', { ascending: false });

  const photos = await Promise.all(
    (rows ?? []).map(async (row) => ({
      id: row.id,
      path: row.file_path,
      filename: row.original_filename,
      url: await getPresignedDownloadUrl(row.file_path),
    }))
  );

  return NextResponse.json(photos);
}
