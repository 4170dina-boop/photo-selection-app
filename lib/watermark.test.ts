import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { createGridThumbnail, createWatermarkedPreview, GRID_THUMB_DIMENSION } from './watermark';

async function buildTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } } })
    .jpeg()
    .toBuffer();
}

describe('createWatermarkedPreview', () => {
  it('resizes a large image down to fit within the max dimension, preserving aspect ratio', async () => {
    const input = await buildTestImage(3000, 1500); // יחס 2:1
    const output = await createWatermarkedPreview(input, 'סטודיו דוגמה');

    const meta = await sharp(output).metadata();
    expect(meta.width).toBeLessThanOrEqual(2000);
    expect(meta.height).toBeLessThanOrEqual(2000);
    // היחס נשמר (בערך - עיגול פיקסלים)
    expect(Math.abs(meta.width! / meta.height! - 2)).toBeLessThan(0.05);
  });

  it('does not enlarge an image already smaller than the max dimension', async () => {
    const input = await buildTestImage(400, 300);
    const output = await createWatermarkedPreview(input, 'סטודיו דוגמה');

    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('actually alters the pixel data (watermark is really composited, not a no-op)', async () => {
    const input = await buildTestImage(800, 600);
    // אותו pipeline בדיוק כמו createWatermarkedPreview (rotate + resize + jpeg 82),
    // רק בלי ה-composite - כך שההבדל היחיד בין שתי התוצאות הוא סימן המים עצמו.
    const resized = await sharp(input)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    const noWatermark = await sharp(resized).jpeg({ quality: 82 }).toBuffer();
    const watermarked = await createWatermarkedPreview(input, 'Studio Demo');

    // בדיקת שפיות: בלי composite ה-pipeline המשוחזר זהה בייט לבייט, אחרת
    // ההשוואה למטה לא הייתה מוכיחה כלום
    const again = await sharp(resized).jpeg({ quality: 82 }).toBuffer();
    expect(Buffer.compare(again, noWatermark)).toBe(0);

    const a = await sharp(noWatermark).raw().toBuffer();
    const b = await sharp(watermarked).raw().toBuffer();
    expect(a.length).toBe(b.length);

    // סימן מים לבן חצי-שקוף מבהיר פיקסלים: סופרים כמה ערכים השתנו משמעותית
    // (מעבר לרעש דחיסת JPEG) ובודקים שהממוצע הכללי עלה
    let changed = 0;
    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 20) changed++;
      sumA += a[i];
      sumB += b[i];
    }
    expect(changed / a.length).toBeGreaterThan(0.005);
    expect(sumB / b.length).toBeGreaterThan(sumA / a.length);
  });

  it('does not throw on watermark text containing XML-special characters', async () => {
    const input = await buildTestImage(400, 300);
    const output = await createWatermarkedPreview(input, 'Studio <A&B> "Photos"');

    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(400);
    expect(meta.format).toBe('jpeg');
  });
});

describe('createGridThumbnail', () => {
  it('shrinks the watermarked preview to the grid size, keeping aspect ratio and JPEG', async () => {
    const preview = await createWatermarkedPreview(await buildTestImage(3000, 2000), 'Studio Demo');
    const grid = await createGridThumbnail(preview);

    const meta = await sharp(grid).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(GRID_THUMB_DIMENSION);
    expect(Math.abs(meta.width! / meta.height! - 1.5)).toBeLessThan(0.02);
  });

  it('is much smaller in bytes than the 2000px preview on a photo-like (noisy) image', async () => {
    const noisy = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
      .jpeg({ quality: 90 })
      .toBuffer();
    const preview = await createWatermarkedPreview(noisy, 'Studio Demo');
    const grid = await createGridThumbnail(preview);
    expect(grid.length * 8).toBeLessThan(preview.length);
  });

  it('does not enlarge a preview that is already small, and keeps the watermark (derived from the preview)', async () => {
    const preview = await createWatermarkedPreview(await buildTestImage(300, 200), 'Studio Demo');
    const grid = await createGridThumbnail(preview);
    const meta = await sharp(grid).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);

    // תמונת הגריד נגזרת מהתצוגה עם סימן המים - היא קרובה אליה, לא למקור הנקי
    const clean = await sharp(await buildTestImage(300, 200)).raw().toBuffer();
    const a = await sharp(preview).raw().toBuffer();
    const b = await sharp(grid).raw().toBuffer();
    let diffPreview = 0;
    let diffClean = 0;
    for (let i = 0; i < b.length; i++) {
      diffPreview += Math.abs(a[i] - b[i]);
      diffClean += Math.abs(clean[i] - b[i]);
    }
    expect(diffPreview).toBeLessThan(diffClean);
  });
});

async function buildTestLogo(size = 60): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.8 } },
  })
    .png()
    .toBuffer();
}

describe('createWatermarkedPreview with a logo', () => {
  it('composites the logo watermark and produces different output than the text watermark', async () => {
    const input = await buildTestImage(800, 600);
    const logo = await buildTestLogo();

    const textOutput = await createWatermarkedPreview(input, 'סטודיו דוגמה');
    const logoOutput = await createWatermarkedPreview(input, 'סטודיו דוגמה', logo);

    expect(Buffer.compare(logoOutput, textOutput)).not.toBe(0);

    const meta = await sharp(logoOutput).metadata();
    expect(meta.width).toBe(800);
    expect(meta.format).toBe('jpeg');
  });

  it('falls back to the text watermark when no logo is provided (null)', async () => {
    const input = await buildTestImage(800, 600);

    const withNull = await createWatermarkedPreview(input, 'סטודיו דוגמה', null);
    const withoutArg = await createWatermarkedPreview(input, 'סטודיו דוגמה');

    // אותה קלט/טקסט, בלי לוגו בשני המקרים - אמורות להפיק תוצאה זהה בייט לבייט
    expect(Buffer.compare(withNull, withoutArg)).toBe(0);
  });

  it('falls back to the text watermark instead of throwing when the logo buffer is invalid/corrupted', async () => {
    const input = await buildTestImage(800, 600);
    const corruptLogo = Buffer.from('this is not a valid image file');

    const output = await createWatermarkedPreview(input, 'סטודיו דוגמה', corruptLogo);
    const textOnly = await createWatermarkedPreview(input, 'סטודיו דוגמה');

    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(800);
    expect(meta.format).toBe('jpeg');
    // נפילה חזרה לאותו נתיב טקסטואלי - לא זריקת שגיאה שהייתה מפילה את כל ההעלאה
    expect(Buffer.compare(output, textOnly)).toBe(0);
  });
});
