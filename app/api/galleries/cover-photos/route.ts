import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getPresignedDownloadUrl } from '@/lib/r2';
import { mapWithConcurrency } from '@/lib/concurrency';

// signed URL של התמונה הראשונה שהועלתה לכל גלריה של הצלמת המחוברת - לתמונה
// קטנה ברשימת הגלריות (app/dashboard/galleries/page.tsx) כדי שיהיה קל לזהות
// ויזואלית איזו גלריה זו, לא רק לפי שם לקוחה. ה-bucket ב-R2 פרטי - חתימת ה-URL
// עוברת דרך lib/r2.ts עם מפתחות R2 סודיים, בדיוק כמו app/api/galleries/[id]/selected-photos/route.ts.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const SIGNED_URL_TTL_SECONDS = 60 * 60; // שעה - מספיק לישיבה אחת בלוח הגלריות
const COVER_QUERY_CONCURRENCY = 8;

export async function GET() {
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

  const { data: galleries } = await supabase.from('galleries').select('id').eq('photographer_id', photographer.id);
  const galleryIds = (galleries ?? []).map((g) => g.id);
  if (galleryIds.length === 0) {
    return NextResponse.json({ covers: {} });
  }

  // שאילתה נפרדת (limit 1) לכל גלריה, ולא שליפה אחת של כל התמונות - שליפה
  // אחת נחתכת ב-1000 שורות של PostgREST, כך שגלריות חדשות (שהתמונות שלהן
  // ממוינות אחרונות) נשארו בלי תמונת שער. במקביל, אבל עם תקרה, כדי לא להציף
  // את ה-DB כשיש לצלמת הרבה גלריות.
  const firstPhotoByGallery = new Map<string, string>();
  await mapWithConcurrency(galleryIds, COVER_QUERY_CONCURRENCY, async (galleryId) => {
    const { data } = await supabaseAdmin
      .from('photos')
      .select('thumbnail_path')
      .eq('gallery_id', galleryId)
      .not('thumbnail_path', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data?.thumbnail_path) firstPhotoByGallery.set(galleryId, data.thumbnail_path);
  });

  const covers: Record<string, string> = {};
  await Promise.all(
    Array.from(firstPhotoByGallery.entries()).map(async ([galleryId, path]) => {
      const url = await getPresignedDownloadUrl(path, SIGNED_URL_TTL_SECONDS);
      if (url) covers[galleryId] = url;
    })
  );

  return NextResponse.json({ covers });
}
