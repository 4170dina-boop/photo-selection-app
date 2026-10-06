import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  burstIdByPhoto,
  dhashFromGrey,
  groupBursts,
  hammingDistance,
  hideSimilarPhotos,
  isSimilarPair,
} from './bursts';
import { computeDHash } from './phash';

const H0 = '0000000000000000';
const H3 = '0000000000000007'; // 3 ביטים שונים מ-H0
const H8 = '00000000000000ff'; // 8
const HFAR = 'ffffffffffffffff'; // 64

describe('dhashFromGrey', () => {
  it('sets a bit where the left neighbour is brighter', () => {
    // כל שורה יורדת בבהירות משמאל לימין -> כל הביטים 1
    const desc = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 10);
    expect(dhashFromGrey(desc)).toBe('ffffffffffffffff');
    const asc = Array.from({ length: 72 }, (_, i) => (i % 9) * 10);
    expect(dhashFromGrey(asc)).toBe('0000000000000000');
  });
  it('throws on too few pixels', () => {
    expect(() => dhashFromGrey([1, 2, 3])).toThrow();
  });
});

describe('hammingDistance', () => {
  it('counts differing bits', () => {
    expect(hammingDistance(H0, H0)).toBe(0);
    expect(hammingDistance(H0, H3)).toBe(3);
    expect(hammingDistance(H0, H8)).toBe(8);
    expect(hammingDistance(H0, HFAR)).toBe(64);
    expect(hammingDistance('ABCDEF0123456789', 'abcdef0123456789')).toBe(0);
  });
  it('returns null for missing/invalid hashes', () => {
    expect(hammingDistance(null, H0)).toBeNull();
    expect(hammingDistance('xyz', H0)).toBeNull();
  });
});

const t = (s: number) => new Date(Date.UTC(2024, 5, 1, 18, 0, s)).toISOString();

describe('isSimilarPair', () => {
  it('requires both close hash and small time gap when times exist', () => {
    expect(isSimilarPair({ id: 'a', phash: H0, takenAt: t(0) }, { id: 'b', phash: H8, takenAt: t(3) })).toBe(true);
    expect(isSimilarPair({ id: 'a', phash: H0, takenAt: t(0) }, { id: 'b', phash: H8, takenAt: t(30) })).toBe(false);
    expect(isSimilarPair({ id: 'a', phash: H0, takenAt: t(0) }, { id: 'b', phash: HFAR, takenAt: t(1) })).toBe(false);
  });
  it('uses the stricter distance without capture time', () => {
    expect(isSimilarPair({ id: 'a', phash: H0, takenAt: null }, { id: 'b', phash: H3, takenAt: null })).toBe(true);
    expect(isSimilarPair({ id: 'a', phash: H0, takenAt: null }, { id: 'b', phash: H8, takenAt: null })).toBe(false);
  });
  it('never groups photos without a hash', () => {
    expect(isSimilarPair({ id: 'a', phash: null, takenAt: t(0) }, { id: 'b', phash: null, takenAt: t(0) })).toBe(false);
  });
});

describe('groupBursts', () => {
  it('chains consecutive similar photos and skips singletons', () => {
    const photos = [
      { id: '1', phash: H0, takenAt: t(0) },
      { id: '2', phash: H3, takenAt: t(1) },
      { id: '3', phash: H8, takenAt: t(2) },
      { id: '4', phash: HFAR, takenAt: t(3) },
      { id: '5', phash: H0, takenAt: t(40) },
      { id: '6', phash: H0, takenAt: t(42) },
      { id: '7', phash: null, takenAt: t(43) },
    ];
    expect(groupBursts(photos)).toEqual([['1', '2', '3'], ['5', '6']]);
  });
  it('returns nothing for empty input', () => {
    expect(groupBursts([])).toEqual([]);
  });
  it('builds a stable burst id per photo', () => {
    const map = burstIdByPhoto([['a', 'b'], ['c', 'd', 'e']]);
    expect(map.get('b')).toBe('a');
    expect(map.get('e')).toBe('c');
    expect(map.has('z')).toBe(false);
  });
});

describe('hideSimilarPhotos', () => {
  const photos = [
    { id: 'a', burstId: 'a' },
    { id: 'b', burstId: 'a' },
    { id: 'c', burstId: null },
    { id: 'd', burstId: 'd' },
    { id: 'e', burstId: 'd' },
  ];
  it('keeps the first photo of each burst by default', () => {
    expect(hideSimilarPhotos(photos, () => false).map((p) => p.id)).toEqual(['a', 'c', 'd']);
  });
  it('keeps the selected photo instead of the first', () => {
    expect(hideSimilarPhotos(photos, (id) => id === 'b' || id === 'e').map((p) => p.id)).toEqual(['b', 'c', 'e']);
  });
});

describe('computeDHash (sharp)', () => {
  async function gradient(width: number, flip = false): Promise<Buffer> {
    const svg = `<svg width="${width}" height="${Math.round(width * 0.75)}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g"><stop offset="0" stop-color="${flip ? 'black' : 'white'}"/><stop offset="1" stop-color="${flip ? 'white' : 'black'}"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/><circle cx="30%" cy="40%" r="15%" fill="#777"/></svg>`;
    return sharp(Buffer.from(svg)).jpeg().toBuffer();
  }
  it('gives near-identical hashes for resized copies and far hashes for different images', async () => {
    const a = await computeDHash(await gradient(480));
    const b = await computeDHash(await gradient(300));
    const c = await computeDHash(await gradient(480, true));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(a, b)!).toBeLessThanOrEqual(4);
    expect(hammingDistance(a, c)!).toBeGreaterThan(20);
  });
});
