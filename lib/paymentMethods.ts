// "אמצעי תשלום שאת מקבלת" - הגדרת הצלמת (app/dashboard/settings,
// components/PaymentMethodsSettings.tsx) ובורר "איך נוח לך לשלם?" ללקוחה
// (components/ClientPayButton.tsx). מחליף את קישורי התשלום הישנים
// (lib/paymentLinks.ts) - ביט/PayBox נשארו כאופציה, כבויים כברירת מחדל.
// אין כאן עיבוד תשלומים בכלל: רק פרטים להצגה; הצלמת רושמת תשלומים ידנית.
//
// עמודות: photographers.payment_methods jsonb - מערך {type, enabled, text}.
// null/חסרה (מיגרציה שלא רצה) = נגזר מהעמודות הישנות payment_bit_url /
// payment_paybox_url / payment_bank_details. בחירת הלקוחה נשמרת ב-
// galleries.client_payment_choice (+ client_payment_choice_at).
// לוגיקה טהורה - משותפת ל-API ולדפדפן, נבדקת ב-vitest.

import { isSafePaymentUrl, parseBankDetails } from '@/lib/paymentLinks';

export const PAYMENT_METHOD_TYPES = ['bank', 'cash', 'check', 'phone', 'bit', 'paybox'] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export interface PaymentMethod {
  type: PaymentMethodType;
  enabled: boolean;
  text: string;
}

// מגבלות אורך לשדה הטקסט - העברה בנקאית רב-שורתית, השאר שורה אחת
export const PAYMENT_METHOD_TEXT_MAX: Record<PaymentMethodType, number> = {
  bank: 500,
  cash: 200,
  check: 200,
  phone: 30,
  bit: 500,
  paybox: 500,
};

// תוויות לדשבורד של הצלמת (עברית בלבד - ללקוחה התוויות מגיעות מ-lib/i18n)
export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  bank: 'העברה בנקאית',
  cash: 'מזומן',
  check: "צ'ק",
  phone: 'תיאום טלפוני',
  bit: 'ביט',
  paybox: 'PayBox',
};

export const PAYMENT_METHOD_ICONS: Record<PaymentMethodType, string> = {
  bank: '🏦',
  cash: '💵',
  check: '📝',
  phone: '📞',
  bit: '📱',
  paybox: '📱',
};

// אמצעים שחייבים טקסט כדי שיהיה מה להציג ללקוחה (מזומן/צ'ק - הטקסט אופציונלי,
// למשל "בעת מסירת התמונות")
const TEXT_REQUIRED: Record<PaymentMethodType, boolean> = {
  bank: true,
  cash: false,
  check: false,
  phone: true,
  bit: true,
  paybox: true,
};

export function isPaymentMethodType(value: unknown): value is PaymentMethodType {
  return typeof value === 'string' && (PAYMENT_METHOD_TYPES as readonly string[]).includes(value);
}

export function paymentMethodLabel(type: unknown): string | null {
  return isPaymentMethodType(type) ? PAYMENT_METHOD_LABELS[type] : null;
}

// טלפון: ספרות, רווחים, מקפים, סוגריים ו-+ בהתחלה; 7-15 ספרות
export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

// tel: ללחיצה בטלפון - רק ספרות (ו-+ בהתחלה), null אם המספר לא תקין
export function phoneTelHref(value: string | null | undefined): string | null {
  if (!value || !isValidPhone(value)) return null;
  const trimmed = value.trim();
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${trimmed.replace(/\D/g, '')}`;
}

// מספר החשבון מתוך פרטי ההעברה (לכפתור "העתקת מספר החשבון"): קודם מספר
// שמופיע אחרי "חשבון"/"ח-ן"/"account", אחרת רצף הספרות הארוך ביותר (5+).
// null = לא זוהה - מציגים רק "העתקת כל הפרטים".
export function extractAccountNumber(text: string | null | undefined): string | null {
  if (!text) return null;
  const labeled = text.match(/(?:חשבון|ח-?ן|ח"ן|account|acc\.?)\D{0,12}?(\d[\d\- ]{2,}\d)/i);
  if (labeled) {
    const digits = labeled[1].replace(/\D/g, '');
    if (digits.length >= 4) return digits;
  }
  const runs = text.match(/\d[\d\-]*\d/g) ?? [];
  let best: string | null = null;
  for (const run of runs) {
    const digits = run.replace(/\D/g, '');
    if (digits.length >= 5 && (!best || digits.length > best.length)) best = digits;
  }
  return best;
}

function cleanText(type: PaymentMethodType, value: unknown): string {
  if (typeof value !== 'string') return '';
  if (type === 'bank') {
    const r = parseBankDetails(value);
    return r.ok ? r.value ?? '' : '';
  }
  // שורה אחת - שבירות שורה הופכות לרווח
  const trimmed = value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  return trimmed.length > PAYMENT_METHOD_TEXT_MAX[type] ? '' : trimmed;
}

// אמצעי מאופשר שאפשר באמת להציג ללקוחה (קישור https תקין, טלפון תקין, טקסט חובה)
export function isUsableMethod(m: PaymentMethod): boolean {
  if (!m.enabled) return false;
  if (m.type === 'bit' || m.type === 'paybox') return isSafePaymentUrl(m.text);
  if (m.type === 'phone') return isValidPhone(m.text);
  if (TEXT_REQUIRED[m.type]) return m.text.trim().length > 0;
  return true;
}

export function emptyPaymentMethods(): PaymentMethod[] {
  return PAYMENT_METHOD_TYPES.map((type) => ({ type, enabled: false, text: '' }));
}

// קריאה מה-DB: תמיד מחזיר את כל 6 האמצעים בסדר הקבוע. payment_methods תקין
// (מערך) = מקור האמת; אחרת (null/חסר/פגום) נגזר מהעמודות הישנות - קישור/פרטים
// שהוגדרו = אמצעי מאופשר. ערכים לא תקינים (קישור לא https וכו') פשוט מנוטרלים.
export function normalizePaymentMethods(row: {
  payment_methods?: unknown;
  payment_bit_url?: unknown;
  payment_paybox_url?: unknown;
  payment_bank_details?: unknown;
} | null | undefined): PaymentMethod[] {
  const result = emptyPaymentMethods();
  if (!row) return result;
  const byType = new Map(result.map((m) => [m.type, m]));

  if (Array.isArray(row.payment_methods)) {
    for (const raw of row.payment_methods) {
      if (!raw || typeof raw !== 'object') continue;
      const { type, enabled, text } = raw as { type?: unknown; enabled?: unknown; text?: unknown };
      if (!isPaymentMethodType(type)) continue;
      const target = byType.get(type)!;
      target.text = cleanText(type, text);
      target.enabled = enabled === true;
      if (target.enabled && !isUsableMethod(target)) target.enabled = false;
    }
    return result;
  }

  const bank = cleanText('bank', row.payment_bank_details);
  if (bank) Object.assign(byType.get('bank')!, { enabled: true, text: bank });
  if (isSafePaymentUrl(row.payment_bit_url)) Object.assign(byType.get('bit')!, { enabled: true, text: row.payment_bit_url.trim() });
  if (isSafePaymentUrl(row.payment_paybox_url)) Object.assign(byType.get('paybox')!, { enabled: true, text: row.payment_paybox_url.trim() });
  return result;
}

// מה שנשלח ללקוחה - רק אמצעים מאופשרים ושמישים, בסדר הקבוע
export function clientPaymentMethods(methods: PaymentMethod[] | null | undefined): PaymentMethod[] {
  return (methods ?? []).filter(isUsableMethod).map((m) => ({ type: m.type, enabled: true, text: m.text }));
}

const ERROR_LABELS: Record<PaymentMethodType, string> = {
  bank: 'פרטי ההעברה הבנקאית',
  cash: 'מזומן',
  check: "צ'ק",
  phone: 'תיאום טלפוני',
  bit: 'ביט',
  paybox: 'PayBox',
};

// אימות קלט מטופס ההגדרות (app/api/photographer PATCH). מחזיר תמיד את כל 6
// האמצעים בסדר הקבוע (אמצעי שלא נשלח = כבוי). אמצעי כבוי שומר את הטקסט שלו
// (כדי שהצלמת לא תאבד פרטים כשהיא מכבה ומדליקה), אבל גם אז הוא חייב להיות תקין.
export function parsePaymentMethodsInput(
  value: unknown
): { ok: true; value: PaymentMethod[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'אמצעי התשלום לא תקינים' };
  if (value.length > PAYMENT_METHOD_TYPES.length) return { ok: false, error: 'אמצעי התשלום לא תקינים' };
  const result = emptyPaymentMethods();
  const byType = new Map(result.map((m) => [m.type, m]));
  const seen = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'אמצעי התשלום לא תקינים' };
    const { type, enabled, text } = raw as { type?: unknown; enabled?: unknown; text?: unknown };
    if (!isPaymentMethodType(type)) return { ok: false, error: 'אמצעי תשלום לא מוכר' };
    if (seen.has(type)) return { ok: false, error: 'אמצעי תשלום כפול' };
    seen.add(type);
    if (typeof enabled !== 'boolean') return { ok: false, error: 'אמצעי התשלום לא תקינים' };
    if (text != null && typeof text !== 'string') return { ok: false, error: `${ERROR_LABELS[type]}: טקסט לא תקין` };

    const label = ERROR_LABELS[type];
    const rawText = typeof text === 'string' ? text : '';
    const max = PAYMENT_METHOD_TEXT_MAX[type];
    let clean: string;
    if (type === 'bank') {
      const r = parseBankDetails(rawText);
      if (!r.ok) return { ok: false, error: r.error };
      clean = r.value ?? '';
    } else {
      clean = rawText.replace(/\s*[\r\n]+\s*/g, ' ').trim();
      if (clean.length > max) return { ok: false, error: `${label}: הטקסט ארוך מדי (מקסימום ${max} תווים)` };
    }

    if (clean) {
      if ((type === 'bit' || type === 'paybox') && !isSafePaymentUrl(clean)) {
        return { ok: false, error: `${label}: הקישור צריך להתחיל ב-https://` };
      }
      if (type === 'phone' && !isValidPhone(clean)) {
        return { ok: false, error: 'תיאום טלפוני: מספר הטלפון לא תקין' };
      }
    } else if (enabled && TEXT_REQUIRED[type]) {
      const what = type === 'bank' ? 'פרטי חשבון' : type === 'phone' ? 'מספר טלפון' : 'קישור';
      return { ok: false, error: `${label}: כדי להפעיל צריך למלא ${what}` };
    }

    Object.assign(byType.get(type)!, { enabled, text: clean });
  }

  return { ok: true, value: result };
}

// העמודות הישנות כשהעמודה החדשה עוד לא קיימת (מיגרציה שלא רצה) - כדי שבנק/
// ביט/PayBox עדיין יישמרו. מזומן/צ'ק/טלפון אין להם מקום בעמודות הישנות.
export function legacyColumnsFromMethods(methods: PaymentMethod[]): {
  payment_bit_url: string | null;
  payment_paybox_url: string | null;
  payment_bank_details: string | null;
} {
  const find = (type: PaymentMethodType) => {
    const m = methods.find((x) => x.type === type);
    return m && isUsableMethod(m) ? m.text : null;
  };
  return { payment_bit_url: find('bit'), payment_paybox_url: find('paybox'), payment_bank_details: find('bank') };
}

// בחירת הלקוחה (app/api/gallery/[id]/payment-choice) - חייבת להיות אחד
// האמצעים שהצלמת מאפשרת כרגע
export function parsePaymentChoice(
  value: unknown,
  available: PaymentMethod[]
): { ok: true; value: PaymentMethodType } | { ok: false; error: string } {
  if (!isPaymentMethodType(value)) return { ok: false, error: 'אמצעי תשלום לא מוכר' };
  if (!clientPaymentMethods(available).some((m) => m.type === value)) {
    return { ok: false, error: 'אמצעי התשלום הזה לא זמין' };
  }
  return { ok: true, value };
}
