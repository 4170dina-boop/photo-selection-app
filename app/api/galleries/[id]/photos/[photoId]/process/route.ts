import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { downloadToBuffer, uploadBuffer } from '@/lib/r2';
import { createWatermarkedPreview } from '@/lib/watermark';
import { computeSharpnessScore } from '@/lib/sharpness';

// יוצרת thumbnail_path אמיתי: מקטינה ומטביעה סימן מים על התמונה שהועלתה.
// רצה אחרי שהמקור כבר הועלה ישירות מהדפדפן ל-R2 (app/dashboard/UploadProvider.tsx,
// דרך URL חתום) - כך שאין בעיית מגבלת גודל בקשה של Vercel (הקובץ המקורי לא
// עובר דרך ה-route הזה בכלל, רק ה-photoId; ה-route מוריד את המקור בעצמו
// מ-R2 בצד שרת).
//
// בעלות נבדקת עם session הצלם - אותו דפוס כמו שאר ה-routes תחת
// app/api/galleries/*. גישת ה-Storage עצמה (הורדה/העלאה) עוברת דרך lib/r2.ts
// עם מפתחות R2 סודיים, בלי קשר ל-RLS של Supabase.

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
    .select('id, business_name, watermark_text, logo_url')
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

  const originalBuffer = await downloadToBuffer(photo.file_path);

  if (!originalBuffer) {
    return NextResponse.json({ error: 'הורדת התמונה המקורית נכשלה' }, { status: 500 });
  }

  // מעדיפים את הלוגו של הצלמת כסימן מים (עוקף את באג הפונט העברי ב-SVG טקסט);
  // אם אין לוגו, או שההורדה שלו נכשלת, נופלים חזרה לסימן המים הטקסטואלי הקיים
  // כדי לא להפיל את כל העלאת התמונה בגלל בעיית רשת/קובץ בלוגו בלבד.
  let logoBuffer: Buffer | null = null;
  if (photographer.logo_url) {
    try {
      const logoRes = await fetch(photographer.logo_url);
      if (logoRes.ok) {
        logoBuffer = Buffer.from(await logoRes.arrayBuffer());
      }
    } catch (err) {
      logoBuffer = null;
    }
  }

  let watermarked: Buffer;
  try {
    const watermarkText = photographer.watermark_text?.trim() || photographer.business_name;
    watermarked = await createWatermarkedPreview(originalBuffer, watermarkText, logoBuffer);
  } catch (err) {
    // לא מפילים את כל ההעלאה בגלל תמונה בעייתית אחת - thumbnail_path נשאר
    // כמו שהוא (זהה ל-file_path, כמו שנקבע בהעלאה), פשוט בלי סימן מים.
    return NextResponse.json({ error: 'עיבוד התמונה נכשל' }, { status: 500 });
  }

  const thumbnailPath = `${params.id}/thumbs/${crypto.randomUUID()}.jpg`;

  try {
    await uploadBuffer(thumbnailPath, watermarked, 'image/jpeg');
  } catch (err) {
    return NextResponse.json({ error: 'העלאת התצוגה המעובדת נכשלה' }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('photos')
    .update({ thumbnail_path: thumbnailPath })
    .eq('id', photo.id);

  if (updateError) {
    return NextResponse.json({ error: 'עדכון רשומת התמונה נכשל' }, { status: 500 });
  }

  // best-effort ומופרד מהעדכון הראשי בכוונה: אם sharpness_score עוד לא קיימת
  // כעמודה ב-DB (דורש להריץ את המיגרציה ב-supabase/schema.sql), כישלון כאן
  // לא אמור למנוע את יצירת ה-thumbnail עצמו, שהוא הדבר החשוב.
  try {
    const sharpnessScore = await computeSharpnessScore(originalBuffer);
    await supabase.from('photos').update({ sharpness_score: sharpnessScore }).eq('id', photo.id);
  } catch (err) {
    console.error('[process] חישוב ציון חדות נכשל:', err);
  }

  return NextResponse.json({ success: true });
}
