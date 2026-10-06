import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteObjects, downloadToBuffer, headObject, uploadBuffer } from '@/lib/r2';
import {
  gridThumbKey,
  hasWatermarkedThumbnail,
  isAllowedLogoUrl,
  isKeyInGallery,
  MAX_UPLOAD_BYTES,
  previewKey,
} from '@/lib/uploadPolicy';
import { createGridThumbnail, createWatermarkedPreview } from '@/lib/watermark';
import { computeSharpnessScore } from '@/lib/sharpness';
import { computeDHash } from '@/lib/phash';
import { takenAtFromExifBlock } from '@/lib/exifDate';
import sharp from 'sharp';

// יוצרת thumbnail_path אמיתי: מקטינה ומטביעה סימן מים על התמונה שהועלתה.
// רצה אחרי שהמקור כבר הועלה ישירות מהדפדפן ל-R2 (app/dashboard/UploadProvider.tsx,
// דרך URL חתום) - כך שאין בעיית מגבלת גודל בקשה של Vercel (הקובץ המקורי לא
// עובר דרך ה-route הזה בכלל, רק ה-photoId; ה-route מוריד את המקור בעצמו
// מ-R2 בצד שרת).
//
// בעלות נבדקת עם session הצלם - אותו דפוס כמו שאר ה-routes תחת
// app/api/galleries/*. גישת ה-Storage עצמה (הורדה/העלאה) עוברת דרך lib/r2.ts
// עם מפתחות R2 סודיים, בלי קשר ל-RLS של Supabase.
//
// כל עיבוד שומר שני אובייקטים: התצוגה הגדולה (previewKey, 2000px) ותמונת גריד
// קטנה (gridThumbKey, 480px) שנגזרת מהתצוגה שכבר עם סימן מים. ?mode=grid =
// השלמה "עצלה" לתמונות ישנות שעובדו לפני שהיו תמונות גריד: מורידה רק את
// התצוגה הקיימת (לא את המקור - שאולי כבר נמחק ע"י ה-cron), מקטינה, ומעבירה
// את thumbnail_path לפורמט החדש. ראו gridThumbKey ב-lib/uploadPolicy.ts.
//
// בנוסף, כל עיבוד שומר (best-effort) חתימת דמיון photos.phash מתמונת הגריד
// (lib/phash.ts - ל"תמונות דומות"), ובעיבוד מלא גם photos.taken_at מה-EXIF של
// המקור אם עוד אין (קבצים שעלו בלי הקטנה; בהקטנה בדפדפן ה-EXIF נמחק, ושם
// הדפדפן כבר שלח את שעת הצילום ברישום). ?mode=phash = השלמה "עצלה" של phash
// בלבד לתמונות ישנות: מורידה רק את תמונת הגריד הקטנה (~50KB).

// הורדה + שינוי גודל + הטבעה של תמונה גדולה לוקחים זמן - ברירת המחדל של
// Vercel (10 שניות) קצרה מדי לקבצים של עשרות MB.
export const maxDuration = 60;

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
    .select('id, file_path, thumbnail_path')
    .eq('id', params.photoId)
    .eq('gallery_id', params.id)
    .single();

  if (!photo) {
    return NextResponse.json({ error: 'תמונה לא נמצאה' }, { status: 404 });
  }

  // file_path נכתב בעבר ישירות מהדפדפן - מוודאים שהוא באמת בתוך תיקיית
  // הגלריה הזו לפני שמורידים/כותבים משהו (גם ה-CHECK constraint ב-schema.sql
  // אוכף את זה, אבל שורות ישנות קודמות לו).
  if (!isKeyInGallery(params.id, photo.file_path)) {
    return NextResponse.json({ error: 'נתיב תמונה לא תקין' }, { status: 400 });
  }

  // key קבוע לכל תמונה - הרצה חוזרת דורסת את אותו אובייקט במקום להשאיר thumb יתום.
  const thumbnailPath = previewKey(params.id, photo.id);
  const gridPath = gridThumbKey(thumbnailPath) as string;

  // שמירה משותפת לשני המצבים: קודם שני האובייקטים, ורק אחר כך thumbnail_path -
  // כך ש-thumbnail_path בפורמט החדש תמיד מבטיח שגם תמונת הגריד קיימת.
  async function storeAndRecord(preview: Buffer, grid: Buffer): Promise<NextResponse | null> {
    try {
      await Promise.all([uploadBuffer(gridPath, grid, 'image/jpeg'), uploadBuffer(thumbnailPath, preview, 'image/jpeg')]);
    } catch (err) {
      return NextResponse.json({ error: 'העלאת התצוגה המעובדת נכשלה' }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from('photos')
      .update({ thumbnail_path: thumbnailPath })
      .eq('id', photo!.id);

    if (updateError) {
      return NextResponse.json({ error: 'עדכון רשומת התמונה נכשל' }, { status: 500 });
    }

    // thumbnail ישן (uuid אקראי / פורמט thumbs/<id>.jpg מלפני תמונות הגריד) -
    // מוחקים אותו כדי שלא יישאר יתום. אף פעם לא את המקור עצמו (thumbnail_path
    // == file_path בשורות ישנות). URL חתום ישן אצל לקוחה שכבר פתוחה נכשל ->
    // handleImageError בדף הגלריה מרענן ומקבל את ה-URLs החדשים.
    const previousThumb = photo!.thumbnail_path;
    if (
      previousThumb &&
      previousThumb !== thumbnailPath &&
      previousThumb !== gridPath &&
      previousThumb !== photo!.file_path &&
      previousThumb.startsWith(`${params.id}/thumbs/`)
    ) {
      try {
        await deleteObjects([previousThumb]);
      } catch (err) {
        console.error('[process] מחיקת thumbnail קודם נכשלה:', previousThumb, err);
      }
    }
    return null;
  }

  // best-effort ומופרד מהעדכון הראשי: אם העמודה phash עוד לא קיימת (המיגרציה
  // ב-supabase/schema.sql לא רצה) - שום דבר לא נשבר, פשוט אין תגי "דומות".
  async function recordPhash(grid: Buffer): Promise<string | null> {
    try {
      const phash = await computeDHash(grid);
      const { error } = await supabase.from('photos').update({ phash }).eq('id', photo!.id);
      return error ? null : phash;
    } catch (err) {
      console.error('[process] חישוב חתימת דמיון נכשל:', photo!.id, err);
      return null;
    }
  }

  if (req.nextUrl.searchParams.get('mode') === 'phash') {
    const phashGridPath = hasWatermarkedThumbnail(photo) ? gridThumbKey(photo.thumbnail_path) : null;
    if (!phashGridPath || !isKeyInGallery(params.id, phashGridPath)) {
      return NextResponse.json({ error: 'אין עדיין תמונת גריד' }, { status: 409 });
    }
    const gridBuffer = await downloadToBuffer(phashGridPath);
    if (!gridBuffer) {
      return NextResponse.json({ error: 'תמונת הגריד לא נמצאה' }, { status: 404 });
    }
    const phash = await recordPhash(gridBuffer);
    return phash ? NextResponse.json({ success: true, phash }) : NextResponse.json({ error: 'שמירת חתימת הדמיון נכשלה' }, { status: 500 });
  }

  if (req.nextUrl.searchParams.get('mode') === 'grid') {
    // השלמה בלבד - תמונה שעוד לא עובדה צריכה עיבוד מלא (בלי mode).
    if (!hasWatermarkedThumbnail(photo) || !isKeyInGallery(params.id, photo.thumbnail_path)) {
      return NextResponse.json({ error: 'התמונה עוד לא עובדה' }, { status: 409 });
    }
    if (gridThumbKey(photo.thumbnail_path)) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const existingPreview = await downloadToBuffer(photo.thumbnail_path);
    if (!existingPreview) {
      return NextResponse.json({ error: 'התצוגה הקיימת לא נמצאה' }, { status: 404 });
    }

    let backfillGrid: Buffer;
    try {
      backfillGrid = await createGridThumbnail(existingPreview);
    } catch (err) {
      console.error('[process] יצירת תמונת גריד נכשלה:', photo.id, err);
      return NextResponse.json({ error: 'עיבוד התמונה נכשל' }, { status: 500 });
    }

    const backfillFailure = await storeAndRecord(existingPreview, backfillGrid);
    if (backfillFailure) return backfillFailure;
    await recordPhash(backfillGrid);
    return NextResponse.json({ success: true });
  }

  // בודקים גודל לפני שמורידים לזיכרון - קובץ ענק היה מפיל את ה-function.
  const head = await headObject(photo.file_path).catch(() => null);
  if (!head) {
    return NextResponse.json({ error: 'התמונה המקורית לא נמצאה' }, { status: 404 });
  }
  if (head.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'הקובץ גדול מדי לעיבוד' }, { status: 413 });
  }

  const originalBuffer = await downloadToBuffer(photo.file_path);

  if (!originalBuffer) {
    return NextResponse.json({ error: 'הורדת התמונה המקורית נכשלה' }, { status: 500 });
  }

  // מעדיפים את הלוגו של הצלמת כסימן מים (עוקף את באג הפונט העברי ב-SVG טקסט);
  // אם אין לוגו, או שההורדה שלו נכשלת, נופלים חזרה לסימן המים הטקסטואלי הקיים
  // כדי לא להפיל את כל העלאת התמונה בגלל בעיית רשת/קובץ בלוגו בלבד.
  let logoBuffer: Buffer | null = null;
  // רק לוגו מה-bucket שלנו ב-Supabase (photographer-logos) - logo_url נקבע ע"י
  // הצלמת, ובלי הגבלה השרת היה מבצע fetch לכל כתובת שהיא (SSRF).
  if (isAllowedLogoUrl(photographer.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    try {
      const logoRes = await fetch(photographer.logo_url, { redirect: 'error' });
      if (logoRes.ok) {
        logoBuffer = Buffer.from(await logoRes.arrayBuffer());
      }
    } catch (err) {
      logoBuffer = null;
    }
  }

  let watermarked: Buffer;
  let grid: Buffer;
  try {
    const watermarkText = photographer.watermark_text?.trim() || photographer.business_name;
    watermarked = await createWatermarkedPreview(originalBuffer, watermarkText, logoBuffer);
    grid = await createGridThumbnail(watermarked);
  } catch (err) {
    // לא מפילים את כל ההעלאה בגלל תמונה בעייתית אחת - thumbnail_path נשאר
    // null, כך שהתמונה פשוט לא מוצגת ללקוחה (אף פעם לא המקור בלי סימן מים),
    // ודף ההעלאה של הצלמת ינסה לעבד אותה שוב.
    console.error('[process] עיבוד סימן מים נכשל:', photo.id, err);
    return NextResponse.json({ error: 'עיבוד התמונה נכשל' }, { status: 500 });
  }

  const failure = await storeAndRecord(watermarked, grid);
  if (failure) return failure;

  // best-effort ומופרד מהעדכון הראשי בכוונה: אם sharpness_score עוד לא קיימת
  // כעמודה ב-DB (דורש להריץ את המיגרציה ב-supabase/schema.sql), כישלון כאן
  // לא אמור למנוע את יצירת ה-thumbnail עצמו, שהוא הדבר החשוב.
  try {
    const sharpnessScore = await computeSharpnessScore(originalBuffer);
    await supabase.from('photos').update({ sharpness_score: sharpnessScore }).eq('id', photo.id);
  } catch (err) {
    console.error('[process] חישוב ציון חדות נכשל:', err);
  }

  await recordPhash(grid);

  // שעת צילום מה-EXIF של המקור - רק אם עוד לא נשמרה ברישום (is null), כדי לא
  // לדרוס ערך שהדפדפן קרא מהקובץ המקורי המלא. best-effort כמו למעלה.
  try {
    const { exif } = await sharp(originalBuffer).metadata(); // קריאת header בלבד, בלי פענוח
    const takenAt = takenAtFromExifBlock(exif ? new Uint8Array(exif) : null);
    if (takenAt) {
      await supabase.from('photos').update({ taken_at: takenAt }).eq('id', photo.id).is('taken_at', null);
    }
  } catch (err) {
    console.error('[process] קריאת שעת צילום נכשלה:', err);
  }

  return NextResponse.json({ success: true });
}
