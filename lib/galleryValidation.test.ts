import { describe, expect, it } from 'vitest';
import {
  parseExpiresAt,
  parseGalleryNumbers,
  parseLogoUrl,
  parseNonNegativeInt,
  parsePrice,
  parseReminderDays,
} from './galleryValidation';

describe('parseNonNegativeInt', () => {
  it('accepts non-negative integers and numeric strings', () => {
    expect(parseNonNegativeInt(0, 'e')).toEqual({ ok: true, value: 0 });
    expect(parseNonNegativeInt(30, 'e')).toEqual({ ok: true, value: 30 });
    expect(parseNonNegativeInt('12', 'e')).toEqual({ ok: true, value: 12 });
  });
  it('rejects NaN, empty string, fractions, negatives and non-numbers', () => {
    for (const v of [NaN, Infinity, '', '  ', 'abc', 1.5, -1, null, undefined, true, {}]) {
      expect(parseNonNegativeInt(v, 'e')).toEqual({ ok: false, error: 'e' });
    }
  });
});

describe('parsePrice', () => {
  it('accepts non-step-10 prices like 25 and 12.50', () => {
    expect(parsePrice(25, 'e')).toEqual({ ok: true, value: 25 });
    expect(parsePrice(12.5, 'e')).toEqual({ ok: true, value: 12.5 });
    expect(parsePrice('12.50', 'e')).toEqual({ ok: true, value: 12.5 });
    expect(parsePrice(0, 'e')).toEqual({ ok: true, value: 0 });
  });
  it('rounds to agorot', () => {
    expect(parsePrice(10.005, 'e')).toEqual({ ok: true, value: 10.01 });
  });
  it('rejects negative, NaN, empty and too large', () => {
    for (const v of [-0.01, NaN, '', 'x', 1e9, null]) {
      expect(parsePrice(v, 'e').ok).toBe(false);
    }
  });
});

describe('parseReminderDays', () => {
  it('requires an integer >= 1', () => {
    expect(parseReminderDays(1)).toEqual({ ok: true, value: 1 });
    expect(parseReminderDays('5')).toEqual({ ok: true, value: 5 });
    expect(parseReminderDays(0).ok).toBe(false);
    expect(parseReminderDays(2.5).ok).toBe(false);
    expect(parseReminderDays('').ok).toBe(false);
    expect(parseReminderDays(NaN).ok).toBe(false);
  });
});

describe('parseExpiresAt', () => {
  it('treats empty values as no expiry', () => {
    expect(parseExpiresAt(null)).toEqual({ ok: true, value: null });
    expect(parseExpiresAt(undefined)).toEqual({ ok: true, value: null });
    expect(parseExpiresAt('')).toEqual({ ok: true, value: null });
  });
  it('normalizes valid dates to ISO', () => {
    expect(parseExpiresAt('2026-10-05T20:59:59.000Z')).toEqual({ ok: true, value: '2026-10-05T20:59:59.000Z' });
  });
  it('rejects invalid dates and non-strings', () => {
    expect(parseExpiresAt('not a date').ok).toBe(false);
    expect(parseExpiresAt(12345).ok).toBe(false);
  });
});

describe('parseGalleryNumbers', () => {
  it('parses a full valid body', () => {
    expect(
      parseGalleryNumbers({
        includedPhotos: 30,
        basePrice: 25,
        extraPhotoPrice: 12.5,
        reminderDays: 3,
        expiresAt: '2026-10-05T20:59:59.000Z',
      })
    ).toEqual({
      ok: true,
      value: { includedPhotos: 30, basePrice: 25, extraPhotoPrice: 12.5, reminderDays: 3, expiresAt: '2026-10-05T20:59:59.000Z' },
    });
  });
  it('defaults missing prices to 0 and missing reminder/expiry to null', () => {
    expect(parseGalleryNumbers({ includedPhotos: 0 })).toEqual({
      ok: true,
      value: { includedPhotos: 0, basePrice: 0, extraPhotoPrice: 0, reminderDays: null, expiresAt: null },
    });
  });
  it('rejects any invalid field', () => {
    expect(parseGalleryNumbers({ includedPhotos: 1.5 }).ok).toBe(false);
    expect(parseGalleryNumbers({ includedPhotos: 1, basePrice: -5 }).ok).toBe(false);
    expect(parseGalleryNumbers({ includedPhotos: 1, extraPhotoPrice: 'abc' }).ok).toBe(false);
    expect(parseGalleryNumbers({ includedPhotos: 1, reminderDays: 0 }).ok).toBe(false);
    expect(parseGalleryNumbers({ includedPhotos: 1, expiresAt: 'nope' }).ok).toBe(false);
  });
});

describe('parseLogoUrl', () => {
  const base = 'https://abc.supabase.co';
  const prefix = `${base}/storage/v1/object/public/photographer-logos/`;

  it('allows null/empty (logo removal)', () => {
    expect(parseLogoUrl(null, base)).toEqual({ ok: true, value: null });
    expect(parseLogoUrl('', base)).toEqual({ ok: true, value: null });
  });
  it('allows public URLs inside the photographer-logos bucket', () => {
    const url = `${prefix}photographer-id/logo?t=123`;
    expect(parseLogoUrl(url, base)).toEqual({ ok: true, value: url });
    expect(parseLogoUrl(url, `${base}/`)).toEqual({ ok: true, value: url });
  });
  it('rejects external, non-https, other buckets and traversal', () => {
    expect(parseLogoUrl('https://evil.example.com/logo.png', base).ok).toBe(false);
    expect(parseLogoUrl(`http://abc.supabase.co/storage/v1/object/public/photographer-logos/x`, 'http://abc.supabase.co').ok).toBe(false);
    expect(parseLogoUrl(`${base}/storage/v1/object/public/other-bucket/x`, base).ok).toBe(false);
    expect(parseLogoUrl(`${prefix}../other-bucket/x`, base).ok).toBe(false);
    expect(parseLogoUrl(prefix, base).ok).toBe(false);
    expect(parseLogoUrl('javascript:alert(1)', base).ok).toBe(false);
    expect(parseLogoUrl(123, base).ok).toBe(false);
  });
  it('rejects everything when the Supabase URL is not configured', () => {
    expect(parseLogoUrl(`${prefix}x`, undefined).ok).toBe(false);
  });
});
