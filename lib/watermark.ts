import sharp from 'sharp';

const MAX_DIMENSION = 2000; // px בצלע הארוכה - מספיק לצפייה מלאה, לא לאיכות הדפסה

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// SVG של טקסט חוזר באלכסון על פני כל התמונה (patternUnits) - קשה להסיר בעריכה
// פשוטה (חיתוך/קרופ) כי הוא מכסה את כל השטח, לא רק פינה אחת.
// שימי לב: ב-runtime של Vercel אין פונט עברי זמין לרינדור <text> ב-SVG, אז הטקסט
// הזה יוצא כג'יבריש/תיבות ריקות שם. זו הסיבה שהנתיב המועדף הוא הלוגו (למטה) -
// זהו fallback לצלמות שעוד לא העלו לוגו.
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

const LOGO_TILE_WIDTH = 320;
const LOGO_TILE_HEIGHT = 220;
const LOGO_TILE_LOGO_HEIGHT = 90; // גובה הלוגו בתוך כל אריח - משאיר מרווח בין חזרות
const LOGO_WATERMARK_OPACITY = 0.35; // אפקט "השתקפות" עדין, לא כיסוי מלא

// SVG של לוגו חוזר באלכסון, באותו קונספט patternUnits/rotate(-30) כמו הטקסט,
// אבל עם <image> שמפנה ל-PNG של הלוגו כ-data URI במקום <text>. זה עוקף לגמרי
// את באג רינדור הפונט העברי כי אין כאן טקסט בכלל - רק הרכבת תמונה (image compositing).
async function buildLogoWatermarkSvg(width: number, height: number, logoBuffer: Buffer): Promise<Buffer> {
  // מקטינים את הלוגו לגודל אריח סביר ושומרים PNG (עם שקיפות) כדי שהחזרה תהיה עדינה
  const resizedLogo = await sharp(logoBuffer)
    .resize({ height: LOGO_TILE_LOGO_HEIGHT, withoutEnlargement: true })
    .png()
    .toBuffer();

  const logoMeta = await sharp(resizedLogo).metadata();
  const logoWidth = logoMeta.width ?? LOGO_TILE_LOGO_HEIGHT;
  const logoHeight = logoMeta.height ?? LOGO_TILE_LOGO_HEIGHT;
  const dataUri = `data:image/png;base64,${resizedLogo.toString('base64')}`;

  const x = (LOGO_TILE_WIDTH - logoWidth) / 2;
  const y = (LOGO_TILE_HEIGHT - logoHeight) / 2;

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <pattern id="wm" width="${LOGO_TILE_WIDTH}" height="${LOGO_TILE_HEIGHT}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
          <image x="${x}" y="${y}" width="${logoWidth}" height="${logoHeight}" href="${dataUri}" xlink:href="${dataUri}" opacity="${LOGO_WATERMARK_OPACITY}" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)" />
    </svg>`;
  return Buffer.from(svg);
}

// מקטינה לגודל תצוגה סביר ומטביעה סימן מים - משמשת גם לתצוגה המוקטנת (גריד)
// וגם למצב ההשוואה המוגדל, כדי שאף מקום בגלריית הלקוחה לא יחשוף את הקובץ
// המקורי הנקי (הוא נשאר רק בצד שרת, לצורך המסירה הסופית).
export async function createWatermarkedPreview(
  input: Buffer,
  watermarkText: string,
  logoBuffer?: Buffer | null
): Promise<Buffer> {
  // חייבים לסיים את שינוי הגודל לפני שקוראים metadata - אחרת מקבלים את מידות
  // התמונה המקורית (לפני resize), וסימן המים ייצא במידות הלא-נכונות.
  const resizedBuffer = await sharp(input)
    .rotate() // מתקן orientation לפי EXIF לפני שהמידע הזה נמחק
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  const { width, height } = await sharp(resizedBuffer).metadata();
  const w = width ?? MAX_DIMENSION;
  const h = height ?? MAX_DIMENSION;

  let watermarkSvg: Buffer;
  if (logoBuffer) {
    try {
      watermarkSvg = await buildLogoWatermarkSvg(w, h, logoBuffer);
    } catch (err) {
      // לוגו פגום/פורמט לא נתמך - נופלים חזרה לסימן מים טקסטואלי במקום להפיל
      // את כל עיבוד התמונה בגלל בעיה בקובץ הלוגו.
      watermarkSvg = buildWatermarkSvg(w, h, watermarkText);
    }
  } else {
    watermarkSvg = buildWatermarkSvg(w, h, watermarkText);
  }

  return sharp(resizedBuffer)
    .composite([{ input: watermarkSvg }])
    .jpeg({ quality: 82 })
    .toBuffer();
}
