import sharp from 'sharp';
import { sampleImageSvg, SAMPLE_IMAGE_HEIGHT, SAMPLE_IMAGE_WIDTH } from './sampleGallery';

// ממירה את ה-SVG של תמונת דוגמה (lib/sampleGallery.ts) ל-JPEG בגודל
// 1600x1067 - ה"מקור" שעולה ל-R2 ועובר את אותו עיבוד סימן מים כמו העלאה אמיתית.
export async function renderSampleJpeg(number: number): Promise<Buffer> {
  return sharp(Buffer.from(sampleImageSvg(number)))
    .resize(SAMPLE_IMAGE_WIDTH, SAMPLE_IMAGE_HEIGHT, { fit: 'fill' })
    .jpeg({ quality: 85 })
    .toBuffer();
}
