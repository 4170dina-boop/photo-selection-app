import sharp from 'sharp';

// מקטינה לפני הניתוח - מהיר יותר, והתוצאה נשארת עקבית בין תמונות בגדלים שונים
const ANALYSIS_MAX_DIMENSION = 800;

// קרנל Laplacian קלאסי לזיהוי קצוות (3x3)
const LAPLACIAN_KERNEL = {
  width: 3,
  height: 3,
  kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
};

// variance של הפלט אחרי הקרנל, על תמונה באפור - מדד היוריסטי קלאסי לחדות
// (לא ML): ערך נמוך = מעט קצוות = כנראה מטושטשת. זו היוריסטיקה תלוית-תוכן,
// לא שיפוט מוחלט - תמונת שמיים בהירים בלי מרקם תקבל ציון נמוך גם אם היא חדה
// לגמרי, ותמונה עמוסת מרקם תקבל ציון גבוה גם אם היא קצת רכה. לכן צריך להציג
// את זה כרמז עדין, לא כפסק דין.
export async function computeSharpnessScore(input: Buffer): Promise<number> {
  // flatten לפני convolve חובה - עם ערוץ alpha (נפוץ ב-PNG, ולפעמים גם ב-JPEG
  // אחרי עיבוד), sharp מטפל בפלט כ-premultiplied ומחזיר אפסים בכל מקום, גם
  // בתמונה עם קצוות אמיתיים. גילינו את זה כי הטסט על תמונה סינתטית נכשל -
  // אחרי flatten() הוא עבר.
  const { data } = await sharp(input)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: ANALYSIS_MAX_DIMENSION, height: ANALYSIS_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .convolve(LAPLACIAN_KERNEL)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = data.length;
  let sum = 0;
  for (let i = 0; i < pixelCount; i++) sum += data[i];
  const mean = sum / pixelCount;

  let variance = 0;
  for (let i = 0; i < pixelCount; i++) {
    const diff = data[i] - mean;
    variance += diff * diff;
  }

  return variance / pixelCount;
}

// סף התחלתי בלבד - לא מכויל על תמונות אמיתיות של המוצר הזה, רק על הטווח
// המקובל ל-Laplacian variance בגודל ניתוח כזה. עשוי לדרוש כיוונון.
export const BLUR_THRESHOLD = 100;
