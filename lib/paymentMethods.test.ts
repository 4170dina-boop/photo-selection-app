import { describe, it, expect } from 'vitest';
import {
  PAYMENT_METHOD_TYPES,
  isValidPhone,
  phoneTelHref,
  extractAccountNumber,
  normalizePaymentMethods,
  clientPaymentMethods,
  parsePaymentMethodsInput,
  legacyColumnsFromMethods,
  parsePaymentChoice,
  paymentMethodLabel,
  type PaymentMethod,
} from './paymentMethods';

const get = (methods: PaymentMethod[], type: string) => methods.find((m) => m.type === type)!;

describe('isValidPhone / phoneTelHref', () => {
  it('accepts Israeli and international numbers', () => {
    expect(isValidPhone('050-1234567')).toBe(true);
    expect(isValidPhone('+972 50 123 4567')).toBe(true);
    expect(isValidPhone('(02) 6543210')).toBe(true);
  });

  it('rejects short numbers and letters', () => {
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone('050-abc')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });

  it('builds a digits-only tel: link', () => {
    expect(phoneTelHref('050-123 4567')).toBe('tel:0501234567');
    expect(phoneTelHref('+972-50-1234567')).toBe('tel:+972501234567');
    expect(phoneTelHref('javascript:alert(1)')).toBeNull();
    expect(phoneTelHref(null)).toBeNull();
  });
});

describe('extractAccountNumber', () => {
  it('prefers the number after "חשבון"', () => {
    expect(extractAccountNumber('בנק לאומי (10)\nסניף 902\nחשבון: 12345-67\nע"ש רחל כהן')).toBe('1234567');
    expect(extractAccountNumber("בנק 12, סניף 345, ח-ן 678901")).toBe('678901');
  });

  it('falls back to the longest digit run (5+)', () => {
    expect(extractAccountNumber('הפועלים 12 / 600 / 3344556')).toBe('3344556');
  });

  it('is null when nothing looks like an account number', () => {
    expect(extractAccountNumber('נא לתאם בטלפון')).toBeNull();
    expect(extractAccountNumber('')).toBeNull();
    expect(extractAccountNumber(null)).toBeNull();
  });
});

describe('normalizePaymentMethods', () => {
  it('always returns all methods in a fixed order', () => {
    const methods = normalizePaymentMethods(null);
    expect(methods.map((m) => m.type)).toEqual([...PAYMENT_METHOD_TYPES]);
    expect(methods.every((m) => !m.enabled && m.text === '')).toBe(true);
  });

  it('derives from the legacy columns when payment_methods is missing', () => {
    const methods = normalizePaymentMethods({
      payment_bit_url: 'https://www.bitpay.co.il/app/me/abc',
      payment_paybox_url: 'http://not-https.example.com',
      payment_bank_details: '  בנק 12 סניף 3 חשבון 45678  ',
    });
    expect(get(methods, 'bank')).toEqual({ type: 'bank', enabled: true, text: 'בנק 12 סניף 3 חשבון 45678' });
    expect(get(methods, 'bit').enabled).toBe(true);
    expect(get(methods, 'paybox').enabled).toBe(false);
    expect(get(methods, 'cash').enabled).toBe(false);
  });

  it('uses payment_methods (even an empty array) over the legacy columns', () => {
    const methods = normalizePaymentMethods({
      payment_methods: [],
      payment_bank_details: 'בנק 12 חשבון 45678',
    });
    expect(methods.every((m) => !m.enabled)).toBe(true);

    const fromJson = normalizePaymentMethods({
      payment_methods: [
        { type: 'cash', enabled: true, text: 'בעת המסירה' },
        { type: 'phone', enabled: true, text: '050-1234567' },
        { type: 'bit', enabled: false, text: 'https://www.bitpay.co.il/x' },
      ],
      payment_bit_url: 'https://www.bitpay.co.il/legacy',
    });
    expect(get(fromJson, 'cash')).toEqual({ type: 'cash', enabled: true, text: 'בעת המסירה' });
    expect(get(fromJson, 'phone').enabled).toBe(true);
    // כבוי אבל הטקסט נשמר (לא נלקח מהעמודה הישנה)
    expect(get(fromJson, 'bit')).toEqual({ type: 'bit', enabled: false, text: 'https://www.bitpay.co.il/x' });
  });

  it('disables broken entries and ignores junk', () => {
    const methods = normalizePaymentMethods({
      payment_methods: [
        null,
        'bank',
        { type: 'crypto', enabled: true, text: 'x' },
        { type: 'paybox', enabled: true, text: 'javascript:alert(1)' },
        { type: 'phone', enabled: true, text: 'abc' },
        { type: 'bank', enabled: true, text: '' },
        { type: 'check', enabled: 'yes', text: '' },
      ],
    });
    expect(methods.every((m) => !m.enabled)).toBe(true);
  });
});

describe('clientPaymentMethods', () => {
  it('keeps only enabled, usable methods (cash/check without text are fine)', () => {
    const methods = normalizePaymentMethods({
      payment_methods: [
        { type: 'bank', enabled: true, text: 'חשבון 123456' },
        { type: 'cash', enabled: true, text: '' },
        { type: 'check', enabled: false, text: 'לפקודת רחל' },
      ],
    });
    expect(clientPaymentMethods(methods).map((m) => m.type)).toEqual(['bank', 'cash']);
    expect(clientPaymentMethods(null)).toEqual([]);
  });
});

describe('parsePaymentMethodsInput', () => {
  it('accepts a valid form and fills missing methods as off', () => {
    const r = parsePaymentMethodsInput([
      { type: 'bank', enabled: true, text: 'בנק 12\r\nסניף 3\r\nחשבון 45678\n' },
      { type: 'phone', enabled: true, text: ' 050-1234567 ' },
      { type: 'check', enabled: true, text: 'לפקודת\nרחל' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((m) => m.type)).toEqual([...PAYMENT_METHOD_TYPES]);
    expect(get(r.value, 'bank').text).toBe('בנק 12\nסניף 3\nחשבון 45678');
    expect(get(r.value, 'phone').text).toBe('050-1234567');
    expect(get(r.value, 'check').text).toBe('לפקודת רחל');
    expect(get(r.value, 'bit')).toEqual({ type: 'bit', enabled: false, text: '' });
  });

  it('requires details for bank/phone/bit/paybox when enabled', () => {
    expect(parsePaymentMethodsInput([{ type: 'bank', enabled: true, text: ' ' }]).ok).toBe(false);
    expect(parsePaymentMethodsInput([{ type: 'phone', enabled: true, text: '' }]).ok).toBe(false);
    expect(parsePaymentMethodsInput([{ type: 'bit', enabled: true, text: '' }]).ok).toBe(false);
    // מזומן בלי טקסט - בסדר
    expect(parsePaymentMethodsInput([{ type: 'cash', enabled: true, text: '' }]).ok).toBe(true);
    // כבוי בלי פרטים - בסדר
    expect(parsePaymentMethodsInput([{ type: 'bank', enabled: false, text: '' }]).ok).toBe(true);
  });

  it('validates links and phones even when the method is off', () => {
    expect(parsePaymentMethodsInput([{ type: 'paybox', enabled: false, text: 'http://x.com' }]).ok).toBe(false);
    expect(parsePaymentMethodsInput([{ type: 'phone', enabled: false, text: 'abc' }]).ok).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(parsePaymentMethodsInput(null).ok).toBe(false);
    expect(parsePaymentMethodsInput({}).ok).toBe(false);
    expect(parsePaymentMethodsInput([{ type: 'crypto', enabled: true, text: '' }]).ok).toBe(false);
    expect(parsePaymentMethodsInput([{ type: 'cash', enabled: 'true', text: '' }]).ok).toBe(false);
    expect(parsePaymentMethodsInput([{ type: 'cash', enabled: true, text: 5 }]).ok).toBe(false);
    expect(
      parsePaymentMethodsInput([
        { type: 'cash', enabled: true, text: '' },
        { type: 'cash', enabled: false, text: '' },
      ]).ok
    ).toBe(false);
    expect(parsePaymentMethodsInput([{ type: 'cash', enabled: true, text: 'x'.repeat(201) }]).ok).toBe(false);
    expect(parsePaymentMethodsInput([{ type: 'bank', enabled: true, text: 'x'.repeat(501) }]).ok).toBe(false);
  });
});

describe('legacyColumnsFromMethods', () => {
  it('maps only usable bank/bit/paybox', () => {
    const methods = normalizePaymentMethods({
      payment_methods: [
        { type: 'bank', enabled: true, text: 'חשבון 123456' },
        { type: 'bit', enabled: false, text: 'https://www.bitpay.co.il/x' },
        { type: 'paybox', enabled: true, text: 'https://payboxapp.page.link/x' },
        { type: 'cash', enabled: true, text: '' },
      ],
    });
    expect(legacyColumnsFromMethods(methods)).toEqual({
      payment_bit_url: null,
      payment_paybox_url: 'https://payboxapp.page.link/x',
      payment_bank_details: 'חשבון 123456',
    });
  });
});

describe('parsePaymentChoice', () => {
  const available = normalizePaymentMethods({
    payment_methods: [
      { type: 'bank', enabled: true, text: 'חשבון 123456' },
      { type: 'cash', enabled: true, text: '' },
      { type: 'check', enabled: false, text: '' },
    ],
  });

  it('accepts an enabled method', () => {
    expect(parsePaymentChoice('cash', available)).toEqual({ ok: true, value: 'cash' });
  });

  it('rejects disabled, unknown or non-string values', () => {
    expect(parsePaymentChoice('check', available).ok).toBe(false);
    expect(parsePaymentChoice('crypto', available).ok).toBe(false);
    expect(parsePaymentChoice(undefined, available).ok).toBe(false);
    expect(parsePaymentChoice('bank', []).ok).toBe(false);
  });
});

describe('paymentMethodLabel', () => {
  it('labels known types and returns null otherwise', () => {
    expect(paymentMethodLabel('bank')).toBe('העברה בנקאית');
    expect(paymentMethodLabel('nope')).toBeNull();
    expect(paymentMethodLabel(null)).toBeNull();
  });
});
