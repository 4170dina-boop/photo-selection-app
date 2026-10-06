import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  digitRects,
  numberRects,
  SAMPLE_EXPIRY_DAYS,
  SAMPLE_IMAGE_HEIGHT,
  SAMPLE_IMAGE_WIDTH,
  SAMPLE_PHOTO_COUNT,
  sampleExpiryIso,
  sampleGradient,
  sampleImageSvg,
  sampleOriginalFilename,
  samplePackage,
  samplePhotoCount,
} from './sampleGallery';
import { renderSampleJpeg } from './sampleGalleryImages';

describe('sampleGallery', () => {
  it('תוקף +14 יום', () => {
    const now = Date.UTC(2026, 9, 6, 12);
    expect(new Date(sampleExpiryIso(now)).getTime() - now).toBe(SAMPLE_EXPIRY_DAYS * 86400000);
  });

  it('חבילה קטנה עם מחירי ברירת המחדל', () => {
    expect(samplePackage({ default_base_price: '900.00', default_extra_photo_price: 25 })).toEqual({
      included_photos: 3,
      base_price: 900,
      extra_photo_price: 25,
    });
    expect(samplePackage(null)).toEqual({ included_photos: 3, base_price: 0, extra_photo_price: 0 });
    expect(samplePackage({ default_base_price: -5, default_extra_photo_price: 'abc' }).base_price).toBe(0);
  });

  it('מכסת תמונות', () => {
    expect(samplePhotoCount(null)).toBe(SAMPLE_PHOTO_COUNT);
    expect(samplePhotoCount(25)).toBe(SAMPLE_PHOTO_COUNT);
    expect(samplePhotoCount(3)).toBe(3);
    expect(samplePhotoCount(0)).toBe(0);
  });

  it('ספרות 7 מקטעים', () => {
    expect(digitRects('8', 0, 0, 50, 100)).toHaveLength(7);
    expect(digitRects('1', 0, 0, 50, 100)).toHaveLength(2);
    expect(digitRects('x', 0, 0, 50, 100)).toHaveLength(0);
    expect(numberRects(12, 100, 100, 50, 100)).toHaveLength(2 + 5);
  });

  it('גרדיאנט מחזורי', () => {
    expect(sampleGradient(0)).toEqual(sampleGradient(8));
    expect(sampleGradient(-1)).toEqual(sampleGradient(7));
  });

  it('SVG בלי <text>', () => {
    const svg = sampleImageSvg(3);
    expect(svg).toContain(`width="${SAMPLE_IMAGE_WIDTH}"`);
    expect(svg).not.toContain('<text');
  });

  it('שם קובץ', () => {
    expect(sampleOriginalFilename(4)).toBe('sample-04.jpg');
  });

  it('JPEG בגודל 1600x1067', async () => {
    const buf = await renderSampleJpeg(5);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(SAMPLE_IMAGE_WIDTH);
    expect(meta.height).toBe(SAMPLE_IMAGE_HEIGHT);
  });
});
