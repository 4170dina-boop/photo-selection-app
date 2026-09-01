import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { createWatermarkedPreview } from './watermark';

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
    const plainResize = await sharp(input).jpeg({ quality: 82 }).toBuffer();
    const watermarked = await createWatermarkedPreview(input, 'סטודיו דוגמה');

    expect(Buffer.compare(watermarked, plainResize)).not.toBe(0);
  });

  it('does not throw on watermark text containing XML-special characters', async () => {
    const input = await buildTestImage(400, 300);
    const output = await createWatermarkedPreview(input, 'Studio <A&B> "Photos"');

    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(400);
    expect(meta.format).toBe('jpeg');
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
