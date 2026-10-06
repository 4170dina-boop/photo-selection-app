import { describe, it, expect } from 'vitest';
import { clientPackagePricing, resolveClientPriceDisplay } from './clientPricing';
import { computePackageUsage } from './gifts';
import { formatCurrency } from './i18n/format';

const pkgRow = { included_photos: 30, extra_photo_price: '25.5', base_price: '1000' };

describe('clientPackagePricing', () => {
  it('returns null without a package', () => {
    expect(clientPackagePricing(null, 500, true)).toBeNull();
  });

  it('no override: plain pricing, not overridden', () => {
    expect(clientPackagePricing(pkgRow, null, true)).toEqual({
      included: 30, extraPrice: 25.5, basePrice: 1000, priceOverridden: false, agreedTotal: null,
    });
  });

  it('override goes to the owner only; guests just get the flag', () => {
    expect(clientPackagePricing(pkgRow, '1200.50', true)).toMatchObject({ priceOverridden: true, agreedTotal: 1200.5 });
    expect(clientPackagePricing(pkgRow, '1200.50', false)).toMatchObject({ priceOverridden: true, agreedTotal: null });
  });

  it('override of 0 is a real amount (free), empty string is not', () => {
    expect(clientPackagePricing(pkgRow, 0, true)).toMatchObject({ priceOverridden: true, agreedTotal: 0 });
    expect(clientPackagePricing(pkgRow, '', true)).toMatchObject({ priceOverridden: false, agreedTotal: null });
  });
});

describe('resolveClientPriceDisplay', () => {
  const usage = computePackageUsage({ billableSelectedCount: 33, included: 30, extraPrice: 25.5, basePrice: 1000 });

  it('computed: estimate with breakdown when over the package', () => {
    const d = resolveClientPriceDisplay(clientPackagePricing(pkgRow, null, true), usage);
    expect(d).toEqual({ mode: 'computed', total: 1076.5, showBreakdown: true, showExtraCosts: true });
  });

  it('computed without base price: no total line (as before)', () => {
    const pkg = clientPackagePricing({ ...pkgRow, base_price: 0 }, null, true);
    expect(resolveClientPriceDisplay(pkg, usage)).toMatchObject({ total: null, showBreakdown: false, showExtraCosts: true });
  });

  it('owner with override: shows the agreed total and hides every computed cost', () => {
    const d = resolveClientPriceDisplay(clientPackagePricing(pkgRow, 900, true), usage);
    expect(d).toEqual({ mode: 'agreed', total: 900, showBreakdown: false, showExtraCosts: false });
  });

  it('guest with override: hides prices entirely', () => {
    const d = resolveClientPriceDisplay(clientPackagePricing(pkgRow, 900, false), usage);
    expect(d).toEqual({ mode: 'hidden', total: null, showBreakdown: false, showExtraCosts: false });
  });

  it('formatted parts add up to the formatted total (no whole-shekel rounding)', () => {
    // 3 × 25.5 = 76.5 - Math.round הציג 77 + 1000 = 1077 ליד סה"כ 1076.5
    expect(formatCurrency('en', 1000)).toBe('₪1,000');
    expect(formatCurrency('en', usage.extraCost)).toBe('₪76.5');
    expect(formatCurrency('en', usage.totalEstimate)).toBe('₪1,076.5');
  });
});
