import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  parseExifDateTime,
  parseTakenAtInput,
  takenAtFromExifBlock,
  takenAtFromJpeg,
  takenAtFromTiff,
} from './exifDate';

// בונה בלוק TIFF מינימלי: IFD0 (DateTime + מצביע ל-Exif IFD) ו-Exif IFD
// (DateTimeOriginal + SubSecTimeOriginal אופציונלי), בסדר בייטים לבחירה.
function buildTiff(opts: { little: boolean; original?: string; subSec?: string; ifd0DateTime?: string }): Uint8Array {
  const bytes: number[] = [];
  const u16 = (v: number) => (opts.little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) =>
    opts.little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
      : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const ascii = (s: string) => [...Array.from(s).map((c) => c.charCodeAt(0)), 0];

  const ifd0Entries = 1 + (opts.ifd0DateTime ? 1 : 0);
  const ifd0Offset = 8;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifEntries = (opts.original ? 1 : 0) + (opts.subSec ? 1 : 0);
  const exifOffset = ifd0Offset + ifd0Size;
  const exifSize = 2 + exifEntries * 12 + 4;
  const dataOffset = exifOffset + exifSize;
  const data: number[] = [];
  const place = (s: string) => {
    const enc = ascii(s);
    if (enc.length <= 4) return { count: enc.length, value: [...enc, 0, 0, 0, 0].slice(0, 4) };
    const off = dataOffset + data.length;
    data.push(...enc);
    return { count: enc.length, value: u32(off) };
  };

  bytes.push(...(opts.little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0Offset));
  bytes.push(...u16(ifd0Entries));
  if (opts.ifd0DateTime) {
    const p = place(opts.ifd0DateTime);
    bytes.push(...u16(0x0132), ...u16(2), ...u32(p.count), ...p.value);
  }
  bytes.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifOffset));
  bytes.push(...u32(0));
  bytes.push(...u16(exifEntries));
  if (opts.original) {
    const p = place(opts.original);
    bytes.push(...u16(0x9003), ...u16(2), ...u32(p.count), ...p.value);
  }
  if (opts.subSec) {
    const p = place(opts.subSec);
    bytes.push(...u16(0x9291), ...u16(2), ...u32(p.count), ...p.value);
  }
  bytes.push(...u32(0));
  return new Uint8Array([...bytes, ...data]);
}

function wrapJpeg(tiff: Uint8Array): Uint8Array {
  const header = [0x45, 0x78, 0x69, 0x66, 0, 0];
  const len = 2 + header.length + tiff.length;
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...header, ...Array.from(tiff), 0xff, 0xda, 0, 2]);
}

describe('parseExifDateTime', () => {
  it('parses EXIF wall-clock time as UTC', () => {
    expect(parseExifDateTime('2024:06:01 18:30:05')).toBe('2024-06-01T18:30:05.000Z');
  });
  it('adds sub-seconds', () => {
    expect(parseExifDateTime('2024:06:01 18:30:05', '25')).toBe('2024-06-01T18:30:05.250Z');
  });
  it('rejects zero / invalid dates', () => {
    expect(parseExifDateTime('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDateTime('2024:02:31 10:00:00')).toBeNull();
    expect(parseExifDateTime('garbage')).toBeNull();
    expect(parseExifDateTime(null)).toBeNull();
  });
});

describe('takenAtFromTiff / takenAtFromJpeg', () => {
  it('reads DateTimeOriginal (little endian) with sub-seconds, preferring it over IFD0 DateTime', () => {
    const tiff = buildTiff({ little: true, original: '2023:09:10 20:15:00', subSec: '5', ifd0DateTime: '2025:01:01 00:00:00' });
    expect(takenAtFromTiff(tiff)).toBe('2023-09-10T20:15:00.500Z');
  });
  it('reads DateTimeOriginal (big endian)', () => {
    const tiff = buildTiff({ little: false, original: '2023:09:10 20:15:00' });
    expect(takenAtFromTiff(tiff)).toBe('2023-09-10T20:15:00.000Z');
  });
  it('falls back to IFD0 DateTime', () => {
    const tiff = buildTiff({ little: true, ifd0DateTime: '2022:01:02 03:04:05' });
    expect(takenAtFromTiff(tiff)).toBe('2022-01-02T03:04:05.000Z');
  });
  it('finds the EXIF segment after APP0 in a JPEG', () => {
    const jpeg = wrapJpeg(buildTiff({ little: true, original: '2021:05:05 12:00:00' }));
    expect(takenAtFromJpeg(jpeg)).toBe('2021-05-05T12:00:00.000Z');
  });
  it('returns null for non-JPEG / truncated / no EXIF', () => {
    expect(takenAtFromJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    const jpeg = wrapJpeg(buildTiff({ little: true, original: '2021:05:05 12:00:00' }));
    expect(takenAtFromJpeg(jpeg.subarray(0, 30))).toBeNull();
    expect(takenAtFromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
  });
  it('handles the "Exif\\0\\0"-prefixed block shape', () => {
    const tiff = buildTiff({ little: true, original: '2021:05:05 12:00:00' });
    const block = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...Array.from(tiff)]);
    expect(takenAtFromExifBlock(block)).toBe('2021-05-05T12:00:00.000Z');
    expect(takenAtFromExifBlock(tiff)).toBe('2021-05-05T12:00:00.000Z');
    expect(takenAtFromExifBlock(null)).toBeNull();
  });
  it('reads EXIF written by sharp (the server-side path)', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888888' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'Test' }, IFD2: { DateTimeOriginal: '2020:12:24 19:45:30' } } as any)
      .toBuffer();
    const { exif } = await sharp(jpeg).metadata();
    expect(takenAtFromExifBlock(exif ? new Uint8Array(exif) : null)).toBe('2020-12-24T19:45:30.000Z');
    expect(takenAtFromJpeg(new Uint8Array(jpeg))).toBe('2020-12-24T19:45:30.000Z');
  });
});

describe('parseTakenAtInput', () => {
  it('accepts ISO strings and normalizes', () => {
    expect(parseTakenAtInput('2024-06-01T18:30:05.000Z')).toBe('2024-06-01T18:30:05.000Z');
  });
  it('rejects junk', () => {
    expect(parseTakenAtInput(123)).toBeNull();
    expect(parseTakenAtInput('nope')).toBeNull();
    expect(parseTakenAtInput('1900-01-01T00:00:00Z')).toBeNull();
    expect(parseTakenAtInput('2999-01-01T00:00:00Z')).toBeNull();
  });
});
