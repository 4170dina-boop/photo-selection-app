import { describe, it, expect } from 'vitest';
import {
  packageAmount,
  computePaymentSummary,
  nextPaidAt,
  parsePaymentInput,
  parseAmountDueOverride,
  formatShekels,
} from './payments';

const pkg = { included_photos: 30, base_price: 1500, extra_photo_price: 40 };

describe('packageAmount', () => {
  it('returns the base price when no extra photos were selected', () => {
    expect(packageAmount(pkg, 20)).toBe(1500);
    expect(packageAmount(pkg, 30)).toBe(1500);
  });

  it('adds extra photos beyond the included count', () => {
    expect(packageAmount(pkg, 35)).toBe(1500 + 5 * 40);
  });

  it('handles a missing package and numeric strings from the DB', () => {
    expect(packageAmount(null, 10)).toBe(0);
    expect(packageAmount({ included_photos: 2, base_price: '100.50', extra_photo_price: '10.25' }, 4)).toBe(121);
  });
});

describe('computePaymentSummary', () => {
  it('derives the total from the package when there is no override', () => {
    const s = computePaymentSummary({ pkg, selectedCount: 32, amountDueOverride: null, payments: [{ amount: 500 }], paidAt: null });
    expect(s).toEqual({
      packageAmount: 1580,
      total: 1580,
      isOverridden: false,
      paid: 500,
      balance: 1080,
      outstanding: 1080,
      paymentCount: 1,
    });
  });

  it('uses the manual override when set, including 0', () => {
    const s = computePaymentSummary({ pkg, selectedCount: 32, amountDueOverride: 1200, payments: [], paidAt: null });
    expect(s.total).toBe(1200);
    expect(s.packageAmount).toBe(1580);
    expect(s.isOverridden).toBe(true);

    const free = computePaymentSummary({ pkg, selectedCount: 0, amountDueOverride: 0, payments: [], paidAt: null });
    expect(free.total).toBe(0);
    expect(free.isOverridden).toBe(true);
    expect(free.outstanding).toBe(0);
  });

  it('avoids floating point leftovers when summing payments', () => {
    const s = computePaymentSummary({
      pkg: null,
      selectedCount: 0,
      amountDueOverride: 0.3,
      payments: [{ amount: 0.1 }, { amount: 0.2 }],
      paidAt: null,
    });
    expect(s.balance).toBe(0);
    expect(s.outstanding).toBe(0);
  });

  it('reports overpayment as a negative balance but zero outstanding', () => {
    const s = computePaymentSummary({ pkg, selectedCount: 0, amountDueOverride: null, payments: [{ amount: 1600 }], paidAt: null });
    expect(s.balance).toBe(-100);
    expect(s.outstanding).toBe(0);
  });

  it('treats a gallery marked paid (manual toggle) as owing nothing', () => {
    const s = computePaymentSummary({ pkg, selectedCount: 0, amountDueOverride: null, payments: [], paidAt: '2026-01-01T00:00:00Z' });
    expect(s.balance).toBe(1500);
    expect(s.outstanding).toBe(0);
  });
});

describe('nextPaidAt', () => {
  const now = '2026-10-05T10:00:00.000Z';
  const earlier = '2026-09-01T10:00:00.000Z';

  it('marks paid when payments cover the total', () => {
    expect(nextPaidAt(null, { total: 1500, paid: 1500, paymentCount: 2 }, 'payment_added', now)).toBe(now);
  });

  it('keeps the original paid date if already marked', () => {
    expect(nextPaidAt(earlier, { total: 1500, paid: 1600, paymentCount: 2 }, 'payment_added', now)).toBe(earlier);
  });

  it('clears paid when the balance is still open', () => {
    expect(nextPaidAt(earlier, { total: 1500, paid: 500, paymentCount: 1 }, 'payment_added', now)).toBeNull();
    expect(nextPaidAt(earlier, { total: 1500, paid: 500, paymentCount: 1 }, 'payment_deleted', now)).toBeNull();
  });

  it('keeps a manual paid mark when the last payment is deleted', () => {
    expect(nextPaidAt(earlier, { total: 1500, paid: 0, paymentCount: 0 }, 'payment_deleted', now)).toBe(earlier);
    expect(nextPaidAt(null, { total: 1500, paid: 0, paymentCount: 0 }, 'payment_deleted', now)).toBeNull();
  });

  it('treats an indirect total change like an amount change', () => {
    expect(nextPaidAt(earlier, { total: 2000, paid: 0, paymentCount: 0 }, 'total_changed', now)).toBe(earlier);
    expect(nextPaidAt(null, { total: 1000, paid: 1000, paymentCount: 1 }, 'total_changed', now)).toBe(now);
    expect(nextPaidAt(earlier, { total: 2000, paid: 1000, paymentCount: 1 }, 'total_changed', now)).toBeNull();
  });

  it('does not touch a manual mark when the amount changes and no payments are recorded', () => {
    expect(nextPaidAt(earlier, { total: 2000, paid: 0, paymentCount: 0 }, 'amount_changed', now)).toBe(earlier);
    expect(nextPaidAt(null, { total: 2000, paid: 0, paymentCount: 0 }, 'amount_changed', now)).toBeNull();
  });

  it('re-derives from payments when the amount changes and payments exist', () => {
    expect(nextPaidAt(null, { total: 1000, paid: 1000, paymentCount: 1 }, 'amount_changed', now)).toBe(now);
    expect(nextPaidAt(earlier, { total: 2000, paid: 1000, paymentCount: 1 }, 'amount_changed', now)).toBeNull();
  });
});

describe('parsePaymentInput', () => {
  const today = '2026-10-05';

  it('accepts a valid payment and defaults the date to today', () => {
    expect(parsePaymentInput({ amount: 500 }, today)).toEqual({
      ok: true,
      value: { amount: 500, paidOn: today, method: null, note: null },
    });
  });

  it('accepts numeric strings, trims text fields and rounds to agorot', () => {
    const r = parsePaymentInput({ amount: '250.555', paidOn: '2026-09-30', method: ' ביט ', note: ' מקדמה ' }, today);
    expect(r).toEqual({ ok: true, value: { amount: 250.56, paidOn: '2026-09-30', method: 'ביט', note: 'מקדמה' } });
  });

  it('rejects zero, negative, empty and non-numeric amounts', () => {
    for (const amount of [0, -5, '', 'abc', null, undefined, Infinity]) {
      expect(parsePaymentInput({ amount }, today).ok).toBe(false);
    }
  });

  it('rejects invalid dates', () => {
    expect(parsePaymentInput({ amount: 10, paidOn: '2026-02-30' }, today).ok).toBe(false);
    expect(parsePaymentInput({ amount: 10, paidOn: '05/10/2026' }, today).ok).toBe(false);
  });
});

describe('parseAmountDueOverride', () => {
  it('treats empty values as "back to automatic"', () => {
    expect(parseAmountDueOverride(null)).toEqual({ ok: true, value: null });
    expect(parseAmountDueOverride('')).toEqual({ ok: true, value: null });
    expect(parseAmountDueOverride('  ')).toEqual({ ok: true, value: null });
  });

  it('accepts zero and positive amounts', () => {
    expect(parseAmountDueOverride(0)).toEqual({ ok: true, value: 0 });
    expect(parseAmountDueOverride('1200')).toEqual({ ok: true, value: 1200 });
  });

  it('rejects negatives and garbage', () => {
    expect(parseAmountDueOverride(-1).ok).toBe(false);
    expect(parseAmountDueOverride('abc').ok).toBe(false);
  });
});

describe('formatShekels', () => {
  it('formats whole and fractional amounts', () => {
    expect(formatShekels(1500)).toBe('₪1,500');
    expect(formatShekels(99.5)).toBe('₪99.50');
    expect(formatShekels(-100)).toBe('-₪100');
  });
});
