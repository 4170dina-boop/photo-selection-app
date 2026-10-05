// הקטנת תמונות בדפדפן לפני העלאה - החלק הטהור (חישובי מידות והחלטות) כאן,
// כדי שאפשר יהיה לבדוק אותו ב-vitest; הפענוח/ציור/קידוד עצמם רצים ב-worker
// (app/dashboard/imageResize.worker.ts) או בגיבוי על ה-main thread
// (app/dashboard/uploadCompressor.ts) - שניהם דרך resizeImageToJpeg למטה.

// הצלע הארוכה של הקובץ שעולה ל-R2. הקובץ הזה משמש רק לתצוגה/בחירה של הלקוחה:
// סימן המים מוקטן ממילא ל-2000px (lib/watermark.ts), ציון החדות ל-800px
// (lib/sharpness.ts) ובחירת ה-AI עובדת מה-thumbnail. 3000px משאיר מרווח
// לתצוגה על מסכי 4K/רטינה ולהדפסה עד ~25x17 ס"מ, והקובץ קטן פי 5-8 ממקור של
// מצלמה (24MP -> ~6MP). מי שצריכה את הקובץ המלא (למשל הורדת ZIP בכפתור הקסם
// ב-Safari/Firefox, ראו components/MagicButton.tsx) מסמנת "רזולוציה מלאה".
export const UPLOAD_MAX_EDGE = 3000;
export const UPLOAD_JPEG_QUALITY = 0.85;

// רק פורמטים שכל הדפדפנים יודעים לפענח ב-createImageBitmap. השאר (avif/tiff)
// עולים כמו שהם - sharp בצד שרת מטפל בהם.
const RESIZABLE_TYPES = /^image\/(jpeg|png|webp)$/;

export function isResizableType(type: string): boolean {
  return RESIZABLE_TYPES.test(type);
}

// מידות היעד: שומרות על יחס הצלעות, אף פעם לא מגדילות, ומעגלות לפיקסל שלם
// (לפחות 1). scaled=false אומר שהתמונה כבר קטנה מספיק.
export function targetDimensions(
  width: number,
  height: number,
  maxEdge: number = UPLOAD_MAX_EDGE
): { width: number; height: number; scaled: boolean } {
  if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) return { width, height, scaled: false };
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height, scaled: false };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

// האם להעלות את הגרסה המעובדת או את המקור. אם הגרסה המעובדת לא קטנה יותר
// (קורה בקבצים קטנים שכבר דחוסים חזק) - המקור, כמו קודם.
export function shouldUseResized(originalBytes: number, resizedBytes: number | null): boolean {
  return resizedBytes !== null && resizedBytes > 0 && resizedBytes < originalBytes;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

async function decode(file: Blob): Promise<ImageBitmap> {
  // imageOrientation: 'from-image' = מיישמים את סיבוב ה-EXIF כבר בפענוח. הקובץ
  // שיוצא מהקנבס כבר בלי EXIF, אז בלי זה תמונה שצולמה "לאורך" הייתה עולה
  // שוכבת (ו-sharp().rotate() בצד שרת כבר לא היה יכול לתקן). זו גם ברירת
  // המחדל בדפדפנים עדכניים; דפדפן ישן שלא מכיר את האפשרות זורק - ננסה בלעדיה.
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

// מפענחת, מקטינה (אם צריך) ומקודדת ל-JPEG. מחזירה null אם משהו נכשל - הקורא
// מעלה את המקור במקרה כזה. createCanvas מאפשר אותו קוד ב-worker
// (OffscreenCanvas) ועל ה-main thread (canvas רגיל) כגיבוי.
export async function resizeImageToJpeg(
  file: Blob,
  maxEdge: number,
  quality: number,
  createCanvas: (width: number, height: number) => AnyCanvas
): Promise<Blob | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await decode(file);
    const target = targetDimensions(bitmap.width, bitmap.height, maxEdge);
    const canvas = createCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    // רקע לבן - ב-PNG/WebP שקוף, JPEG בלי ערוץ שקיפות היה הופך את השקוף לשחור.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    // משחררים את הזיכרון של הפענוח המלא (24MP = ~100MB) מיד, לא מחכים ל-GC.
    bitmap.close();
    bitmap = null;

    if ('convertToBlob' in canvas) {
      return await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
