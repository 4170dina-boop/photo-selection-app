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
