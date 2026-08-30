import sharp from 'sharp';

const MAX_DIMENSION = 2000; // px בצלע הארוכה - מספיק לצפייה מלאה, לא לאיכות הדפסה

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// SVG של טקסט חוזר באלכסון על פני כל התמונה (patternUnits) - קשה להסיר בעריכה
// פשוטה (חיתוך/קרופ) כי הוא מכסה את כל השטח, לא רק פינה אחת.
function buildWatermarkSvg(width: number, height: number, text: string): Buffer {
  const escaped = escapeXml(text);
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="wm" width="320" height="220" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
          <text x="0" y="110" font-family="sans-serif" font-size="26" fill="white" fill-opacity="0.32">${escaped}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)" />
    </svg>`;
  return Buffer.from(svg);
}

// מקטינה לגודל תצוגה סביר ומטביעה סימן מים - משמשת גם לתצוגה המוקטנת (גריד)
// וגם למצב ההשוואה המוגדל, כדי שאף מקום בגלריית הלקוחה לא יחשוף את הקובץ
// המקורי הנקי (הוא נשאר רק בצד שרת, לצורך המסירה הסופית).
export async function createWatermarkedPreview(input: Buffer, watermarkText: string): Promise<Buffer> {
  // חייבים לסיים את שינוי הגודל לפני שקוראים metadata - אחרת מקבלים את מידות
  // התמונה המקורית (לפני resize), וסימן המים ייצא במידות הלא-נכונות.
  const resizedBuffer = await sharp(input)
    .rotate() // מתקן orientation לפי EXIF לפני שהמידע הזה נמחק
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  const { width, height } = await sharp(resizedBuffer).metadata();
  const watermarkSvg = buildWatermarkSvg(width ?? MAX_DIMENSION, height ?? MAX_DIMENSION, watermarkText);

  return sharp(resizedBuffer)
    .composite([{ input: watermarkSvg }])
    .jpeg({ quality: 82 })
    .toBuffer();
}
