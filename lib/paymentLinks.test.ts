import { describe, it, expect } from 'vitest';
import {
  isSafePaymentUrl,
  parsePaymentUrl,
  parseBankDetails,
  normalizePaymentLinks,
  hasAnyPaymentLink,
  computeClientPayAmount,
  PAYMENT_BANK_DETAILS_MAX_LENGTH,
} from './paymentLinks';

describe('isSafePaymentUrl', () => {
  it('accepts https links (bit, PayBox, anything https)', () => {
    expect(isSafePaymentUrl('https://www.bitpay.co.il/app/me/ABC123')).toBe(true);
    expect(isSafePaymentUrl('https://payboxapp.page.link/xyz')).toBe(true);
    expect(isSafePaymentUrl('  https://example.com/pay?x=1  ')).toBe(true);
  });

  it('rejects http, other schemes and junk', () => {
    expect(isSafePaymentUrl('http://www.bitpay.co.il/x')).toBe(false);
    expect(isSafePaymentUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePaymentUrl('data:text/html,hi')).toBe(false);
    expect(isSafePaymentUrl('www.bitpay.co.il')).toBe(false);
    expect(isSafePaymentUrl('https://localhost/x')).toBe(false);
    expect(isSafePaymentUrl('https://user:pass@evil.com')).toBe(false);
    expect(isSafePaymentUrl('https://a.com/ b')).toBe(false);
    expect(isSafePaymentUrl('https://a.com/' + 'x'.repeat(600))).toBe(false);
    expect(isSafePaymentUrl('')).toBe(false);
    expect(isSafePaymentUrl(null)).toBe(false);
    expect(isSafePaymentUrl(42)).toBe(false);
  });
});

describe('parsePaymentUrl', () => {
  it('treats empty as clearing the link', () => {
    expect(parsePaymentUrl('', 'ביט')).toEqual({ ok: true, value: null });
    expect(parsePaymentUrl('   ', 'ביט')).toEqual({ ok: true, value: null });
    expect(parsePaymentUrl(null, 'ביט')).toEqual({ ok: true, value: null });
  });

  it('trims valid links and rejects invalid ones with the label', () => {
    expect(parsePaymentUrl(' https://www.bitpay.co.il/a ', 'ביט')).toEqual({ ok: true, value: 'https://www.bitpay.co.il/a' });
    const bad = parsePaymentUrl('http://x.com', 'PayBox');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('PayBox');
    expect(parsePaymentUrl(5, 'ביט').ok).toBe(false);
  });
});

describe('parseBankDetails', () => {
  it('trims, keeps inner line breaks, empty = null', () => {
    expect(parseBankDetails('\n בנק לאומי\r\nסניף 123 \n')).toEqual({ ok: true, value: 'בנק לאומי\nסניף 123' });
    expect(parseBankDetails('  ')).toEqual({ ok: true, value: null });
    expect(parseBankDetails(undefined)).toEqual({ ok: true, value: null });
  });

  it('rejects too long / non-string', () => {
    expect(parseBankDetails('x'.repeat(PAYMENT_BANK_DETAILS_MAX_LENGTH + 1)).ok).toBe(false);
    expect(parseBankDetails({}).ok).toBe(false);
  });
});

describe('normalizePaymentLinks / hasAnyPaymentLink', () => {
  it('drops unsafe values from the DB row', () => {
    const links = normalizePaymentLinks({
      payment_bit_url: 'javascript:alert(1)',
      payment_paybox_url: 'https://paybox.co.il/p',
      payment_bank_details: '  ',
    });
    expect(links).toEqual({ bitUrl: null, payboxUrl: 'https://paybox.co.il/p', bankDetails: null });
    expect(hasAnyPaymentLink(links)).toBe(true);
  });

  it('handles a missing row', () => {
    const links = normalizePaymentLinks(null);
    expect(hasAnyPaymentLink(links)).toBe(false);
    expect(hasAnyPaymentLink(null)).toBe(false);
  });
});

describe('computeClientPayAmount', () => {
  const pkg = { included_photos: 30, base_price: 1500, extra_photo_price: 40 };

  it('is the extras cost when nothing was paid', () => {
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 35, amountDueOverride: null, payments: [], paidAt: null })).toBe(200);
  });

  it('is 0 without extras, without a package or with a free extra price', () => {
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 30, amountDueOverride: null, payments: [], paidAt: null })).toBe(0);
    expect(computeClientPayAmount({ pkg: null, billableSelectedCount: 50, amountDueOverride: null, payments: [], paidAt: null })).toBe(0);
    expect(
      computeClientPayAmount({ pkg: { ...pkg, extra_photo_price: 0 }, billableSelectedCount: 50, amountDueOverride: null, payments: [], paidAt: null })
    ).toBe(0);
  });

  it('is 0 once the gallery is marked paid', () => {
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 35, amountDueOverride: null, payments: [], paidAt: '2026-01-01' })).toBe(0);
  });

  it('never exceeds what is still outstanding', () => {
    // שולמו 1600 מתוך 1700 -> נשארו 100, פחות מעלות התוספת (200)
    expect(
      computeClientPayAmount({ pkg, billableSelectedCount: 35, amountDueOverride: null, payments: [{ amount: 1600 }], paidAt: null })
    ).toBe(100);
    // דריסה ידנית לסכום נמוך
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 35, amountDueOverride: '50', payments: [], paidAt: null })).toBe(50);
  });

  it('shows the manual agreed total even without extra photos', () => {
    // סכום ידני = הסכום לתשלום, גם כשלא נבחרו תמונות נוספות (לא 0)
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 10, amountDueOverride: '1800', payments: [], paidAt: null })).toBe(1800);
    expect(computeClientPayAmount({ pkg: null, billableSelectedCount: 0, amountDueOverride: 900, payments: [], paidAt: null })).toBe(900);
    // פחות תשלומים שנרשמו, ו-0 כשסומן כשולם / שולם במלואו
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 10, amountDueOverride: '1800', payments: [{ amount: 500 }], paidAt: null })).toBe(1300);
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 10, amountDueOverride: '1800', payments: [], paidAt: '2026-01-01' })).toBe(0);
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 10, amountDueOverride: '1800', payments: [{ amount: 2000 }], paidAt: null })).toBe(0);
    // סכום ידני ריק = כמו בלי סכום ידני
    expect(computeClientPayAmount({ pkg, billableSelectedCount: 30, amountDueOverride: '', payments: [], paidAt: null })).toBe(0);
  });

  it('works in agorot (no float leftovers)', () => {
    expect(
      computeClientPayAmount({ pkg: { included_photos: 0, base_price: 0, extra_photo_price: '0.1' }, billableSelectedCount: 3, amountDueOverride: null, payments: [], paidAt: null })
    ).toBe(0.3);
  });
});
