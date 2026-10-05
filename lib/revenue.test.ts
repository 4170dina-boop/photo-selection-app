import { describe, expect, it } from 'vitest';
import { galleryRevenue, israelMonthKey, sumShekels } from './revenue';

const pkg = { included_photos: 10, base_price: 25, extra_photo_price: 12.5 };

describe('galleryRevenue', () => {
  it('is base + overage when not overridden', () => {
    expect(galleryRevenue({ pkg, selectedCount: 12, amountDueOverride: null })).toEqual({ total: 50, overage: 25 });
    expect(galleryRevenue({ pkg, selectedCount: 5, amountDueOverride: null })).toEqual({ total: 25, overage: 0 });
  });
  it('uses amount_due_override and reports no overage', () => {
    expect(galleryRevenue({ pkg, selectedCount: 12, amountDueOverride: 40 })).toEqual({ total: 40, overage: 0 });
    expect(galleryRevenue({ pkg, selectedCount: 12, amountDueOverride: '0' })).toEqual({ total: 0, overage: 0 });
  });
  it('handles string numerics and missing packages', () => {
    expect(
      galleryRevenue({ pkg: { included_photos: 0, base_price: '0.1', extra_photo_price: '0.2' }, selectedCount: 1, amountDueOverride: null })
    ).toEqual({ total: 0.3, overage: 0.2 });
    expect(galleryRevenue({ pkg: null, selectedCount: 3, amountDueOverride: null })).toEqual({ total: 0, overage: 0 });
  });
});

describe('sumShekels', () => {
  it('sums without float drift', () => {
    expect(sumShekels([0.1, 0.2])).toBe(0.3);
    expect(sumShekels([12.5, 12.5, 0.01])).toBe(25.01);
    expect(sumShekels([])).toBe(0);
    expect(sumShekels([5, NaN])).toBe(5);
  });
});

describe('israelMonthKey', () => {
  it('uses the Israel calendar month, not UTC/browser', () => {
    // 1 בנובמבר 00:30 בישראל (שעון חורף, +2) = 31 באוקטובר 22:30 UTC
    expect(israelMonthKey('2026-10-31T22:30:00.000Z')).toBe('2026-11');
    // 1 באוגוסט 00:30 בישראל (שעון קיץ, +3) = 31 ביולי 21:30 UTC
    expect(israelMonthKey('2026-07-31T21:30:00.000Z')).toBe('2026-08');
    expect(israelMonthKey('2026-07-31T20:30:00.000Z')).toBe('2026-07');
  });
});
