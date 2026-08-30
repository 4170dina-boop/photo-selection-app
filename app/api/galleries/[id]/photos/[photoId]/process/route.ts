import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createWatermarkedPreview } from '@/lib/watermark';

// יוצרת thumbnail_path אמיתי: מקטינה ומטביעה סימן מים על התמונה שהועלתה.
// רצה אחרי שהמקור כבר הועלה ישירות מהדפדפן ל-Storage (app/dashboard/upload/[galleryId]/page.tsx) -
// כך שאין בעיית מגבלת גודל בקשה של Vercel (הקובץ המקורי לא עובר דרך ה-route הזה
// בכלל, רק ה-photoId; ה-route מוריד את המקור בעצמו מ-Storage בצד שרת).
//
// בעלות נבדקת עם session הצלם (לא service key) - אותו דפוס כמו שאר ה-routes
// תחת app/api/galleries/*. ה-service key נדרש רק להורדה/העלאה מה-bucket הפרטי.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(req: NextRequest, { params }: { params: { id: string; photoId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name, watermark_text')
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

  const { data: photo } = await supabase
    .from('photos')
    .select('id, file_path')
    .eq('id', params.photoId)
    .eq('gallery_id', params.id)
    .single();

  if (!photo) {
    return NextResponse.json({ error: 'תמונה לא נמצאה' }, { status: 404 });
  }

  const { data: original, error: downloadError } = await supabaseAdmin.storage
    .from('gallery-photos')
    .download(photo.file_path);

  if (downloadError || !original) {
    return NextResponse.json({ error: 'הורדת התמונה המקורית נכשלה' }, { status: 500 });
  }

  let watermarked: Buffer;
  try {
    const originalBuffer = Buffer.from(await original.arrayBuffer());
    const watermarkText = photographer.watermark_text?.trim() || photographer.business_name;
    watermarked = await createWatermarkedPreview(originalBuffer, watermarkText);
  } catch (err) {
    // לא מפילים את כל ההעלאה בגלל תמונה בעייתית אחת - thumbnail_path נשאר
    // כמו שהוא (זהה ל-file_path, כמו שנקבע בהעלאה), פשוט בלי סימן מים.
    return NextResponse.json({ error: 'עיבוד התמונה נכשל' }, { status: 500 });
  }

  const thumbnailPath = `${params.id}/thumbs/${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('gallery-photos')
    .upload(thumbnailPath, watermarked, { contentType: 'image/jpeg', upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: 'העלאת התצוגה המעובדת נכשלה' }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('photos')
    .update({ thumbnail_path: thumbnailPath })
    .eq('id', photo.id);

  if (updateError) {
    return NextResponse.json({ error: 'עדכון רשומת התמונה נכשל' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
