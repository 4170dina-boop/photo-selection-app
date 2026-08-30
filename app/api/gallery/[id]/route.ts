import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';

// service_role - נשאר בצד שרת בלבד. כל הגישה של הלקוחה לנתוני הגלריה
// עוברת דרך ה-API הזה (ולא דרך anon key ישירות מהדפדפן), כי אין policy
// שמאפשרת גישת anon/לקוח ישירה ל-photos/selections/packages - ראו schema.sql.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const SIGNED_URL_TTL_SECONDS = 60 * 60; // שעה - מספיק לצפייה בגלריה בישיבה אחת

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);

  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, status, expires_at, photographers(brand_color)')
    .eq('id', galleryId)
    .single();

  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (gallery.expires_at && new Date(gallery.expires_at) < new Date()) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  const [{ data: photosData }, { data: selectionsData }, { data: packageData }] = await Promise.all([
    supabaseAdmin.from('photos').select('id, file_path, thumbnail_path, original_filename').eq('gallery_id', galleryId),
    supabaseAdmin.from('selections').select('photo_id, note, status').eq('gallery_id', galleryId),
    supabaseAdmin.from('packages').select('included_photos, extra_photo_price').eq('gallery_id', galleryId).single(),
  ]);

  const photos = await Promise.all(
    (photosData ?? []).map(async (photo) => {
      const thumbPath = photo.thumbnail_path ?? photo.file_path;

      const { data: thumbSigned } = await supabaseAdmin.storage
        .from('gallery-photos')
        .createSignedUrl(thumbPath, SIGNED_URL_TTL_SECONDS);

      // thumbnailUrl ו-fullUrl מצביעים לאותה גרסה (המוקטנת/עם סימן המים) -
      // file_path (המקור הנקי) לא נחשף ללקוחה בשום מקום, כולל מצב השוואה
      // מוגדל; הוא משמש רק בצד שרת לצורך המסירה הסופית (app/api/galleries/[id]/selected-photos).
      return {
        id: photo.id,
        thumbnailUrl: thumbSigned?.signedUrl ?? null,
        fullUrl: thumbSigned?.signedUrl ?? null,
        original_filename: photo.original_filename,
      };
    })
  );

  // '#000000' הוא ערך ברירת המחדל של העמודה - צלמת שלא הגדירה צבע מותג
  // מפורש עדיין מקבלת את הפלטה הקבועה (theme.gold) בצד הלקוח, לא שחור.
  const brandColor = (gallery as any).photographers?.brand_color;

  return NextResponse.json({
    status: gallery.status,
    photos,
    selections: selectionsData ?? [],
    package: packageData ? { included: packageData.included_photos, extraPrice: packageData.extra_photo_price } : null,
    brandColor: brandColor && brandColor !== '#000000' ? brandColor : null,
  });
}
