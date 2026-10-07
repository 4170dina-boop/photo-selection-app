import { describe, expect, it } from 'vitest';
import { isPhotoVariant, photoKeysForVariant, stablePhotoUrl } from './stablePhotoUrl';
import { gridThumbKey } from './uploadPolicy';

const G = 'gal-1';

describe('stablePhotoUrl', () => {
  it('is identical on every call (no timestamp/signature)', () => {
    expect(stablePhotoUrl(G, 'p1', 'grid')).toBe('/api/gallery/gal-1/img/p1/grid');
    expect(stablePhotoUrl(G, 'p1', 'grid')).toBe(stablePhotoUrl(G, 'p1', 'grid'));
  });

  it('validates variants', () => {
    expect(isPhotoVariant('grid')).toBe(true);
    expect(isPhotoVariant('full')).toBe(true);
    expect(isPhotoVariant('original')).toBe(false);
  });
});

describe('photoKeysForVariant', () => {
  const full = `${G}/thumbs/abc.hd.jpg`;
  const photo = { file_path: `${G}/abc.jpg`, thumbnail_path: full };

  it('never exposes the clean original', () => {
    expect(photoKeysForVariant(G, { file_path: `${G}/abc.jpg`, thumbnail_path: null }, 'full')).toEqual([]);
    expect(photoKeysForVariant(G, { file_path: `${G}/abc.jpg`, thumbnail_path: `${G}/abc.jpg` }, 'grid')).toEqual([]);
  });

  it('rejects keys outside the gallery', () => {
    expect(photoKeysForVariant(G, { file_path: 'x', thumbnail_path: 'other/thumbs/a_preview.jpg' }, 'full')).toEqual([]);
  });

  it('full -> watermarked preview', () => {
    expect(photoKeysForVariant(G, photo, 'full')).toEqual([full]);
  });

  it('grid -> grid key first, preview as fallback', () => {
    const keys = photoKeysForVariant(G, photo, 'grid');
    expect(keys[keys.length - 1]).toBe(full);
    const grid = gridThumbKey(full);
    expect(grid).toBe(`${G}/thumbs/abc.sm.jpg`);
    expect(keys).toEqual([grid, full]);
  });
});
