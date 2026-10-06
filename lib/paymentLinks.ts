// קישורי תשלום של הצלמת (ביט / PayBox / פרטי העברה בנקאית) שמוצגים ללקוחה
// על התוספת (components/ClientPayButton.tsx). אין כאן עיבוד תשלומים בכלל -
// רק קישורים חיצוניים; הצלמת ממשיכה לרשום תשלומים ידנית (lib/payments.ts).
//
// עמודות: photographers.payment_bit_url / payment_paybox_url / payment_bank_details
// (ראו supabase/schema.sql). לוגיקה טהורה - משותפת ל-API ולדפדפן.
// הוחלף ע"י "אמצעי תשלום" (lib/paymentMethods.ts) - העמודות הישנות נשארו
// לתאימות לאחור (נקראות כש-payment_methods עוד null/חסרה), והאימות כאן
// (isSafePaymentUrl / parseBankDetails) וחישוב הסכום משמשים גם שם.

import { computePaymentSummary, type PackagePricing, type PaymentLike } from '@/lib/payments';

export const PAYMENT_URL_MAX_LENGTH = 500;
export const PAYMENT_BANK_DETAILS_MAX_LENGTH = 500;

export interface PaymentLinks {
  bitUrl: string | null;
  payboxUrl: string | null;
  bankDetails: string | null;
}

export const EMPTY_PAYMENT_LINKS: PaymentLinks = { bitUrl: null, payboxUrl: null, bankDetails: null };

// https בלבד (לא http, לא javascript:/data: וכו'), עם host אמיתי. קישורי ביט
// הם בדרך כלל https://www.bitpay.co.il/... אבל מקבלים כל כתובת https - הם
// מוצגים ללקוחה רק כקישור (rel="noopener noreferrer", target="_blank").
export function isSafePaymentUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > PAYMENT_URL_MAX_LENGTH || /\s/.test(trimmed)) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (!url.hostname || !url.hostname.includes('.')) return false;
  // בלי user:pass@ - טריק נפוץ להסוואת הדומיין האמיתי
  if (url.username || url.password) return false;
  return true;
}

// אימות קלט מטופס ההגדרות. ריק/null = מחיקת הקישור.
export function parsePaymentUrl(
  value: unknown,
  label: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${label}: קישור לא תקין` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > PAYMENT_URL_MAX_LENGTH) return { ok: false, error: `${label}: הקישור ארוך מדי` };
  if (!isSafePaymentUrl(trimmed)) return { ok: false, error: `${label}: הקישור צריך להתחיל ב-https://` };
  return { ok: true, value: trimmed };
}

export function parseBankDetails(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'פרטי העברה בנקאית לא תקינים' };
  // שורות ריקות מיותרות בסוף/התחלה נחתכות, שבירות שורה בפנים נשמרות
  const trimmed = value.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > PAYMENT_BANK_DETAILS_MAX_LENGTH) {
    return { ok: false, error: `פרטי ההעברה ארוכים מדי (מקסימום ${PAYMENT_BANK_DETAILS_MAX_LENGTH} תווים)` };
  }
  return { ok: true, value: trimmed };
}

// מה שנשלח ללקוחה: מאמתים שוב בקריאה (רשת ביטחון לערכים ישנים/ידניים ב-DB) -
// קישור לא תקין פשוט לא מוצג.
export function normalizePaymentLinks(row: {
  payment_bit_url?: unknown;
  payment_paybox_url?: unknown;
  payment_bank_details?: unknown;
} | null | undefined): PaymentLinks {
  if (!row) return EMPTY_PAYMENT_LINKS;
  const bank = parseBankDetails(row.payment_bank_details);
  return {
    bitUrl: isSafePaymentUrl(row.payment_bit_url) ? row.payment_bit_url.trim() : null,
    payboxUrl: isSafePaymentUrl(row.payment_paybox_url) ? row.payment_paybox_url.trim() : null,
    bankDetails: bank.ok ? bank.value : null,
  };
}

export function hasAnyPaymentLink(links: PaymentLinks | null | undefined): boolean {
  return !!links && !!(links.bitUrl || links.payboxUrl || links.bankDetails);
}

// הסכום שמוצג ללקוחה ב"תשלום על התוספת": עלות התמונות הנוספות בלבד (לא
// מחיר הבסיס של החבילה - שבדרך כלל כבר סוכם/שולם מחוץ לאפליקציה), אבל לא
// יותר ממה שבאמת נשאר לשלם לפי מעקב התשלומים של הצלמת - כך שגלריה שסומנה
// כשולמה (paid_at), או שנרשמו לה תשלומים שמכסים את התוספת, לא מציגה סכום.
export function computeClientPayAmount(input: {
  pkg: PackagePricing | null | undefined;
  billableSelectedCount: number;
  amountDueOverride: number | string | null | undefined;
  payments: PaymentLike[] | null | undefined;
  paidAt: string | null | undefined;
}): number {
  // סכום ידני שסוכם (amount_due_override, ראו lib/clientPricing.ts) - הוא הסכום
  // לתשלום, גם כשאין תמונות נוספות (אחרת הלקוחה הייתה רואה 0 ולא כפתור תשלום).
  // מוצג מה שנשאר ממנו אחרי תשלומים שנרשמו (0 כשסומן כשולם).
  const override = input.amountDueOverride;
  if (override != null && override !== '' && Number.isFinite(Number(override))) {
    const { outstanding } = computePaymentSummary({
      pkg: input.pkg,
      selectedCount: input.billableSelectedCount,
      amountDueOverride: override,
      payments: input.payments,
      paidAt: input.paidAt,
    });
    return Math.max(0, Math.round(outstanding * 100)) / 100;
  }
  if (!input.pkg) return 0;
  const extraPhotos = Math.max(0, input.billableSelectedCount - (input.pkg.included_photos ?? 0));
  const extraAgorot = extraPhotos * Math.round(Number(input.pkg.extra_photo_price ?? 0) * 100);
  if (!Number.isFinite(extraAgorot) || extraAgorot <= 0) return 0;
  const { outstanding } = computePaymentSummary({
    pkg: input.pkg,
    selectedCount: input.billableSelectedCount,
    amountDueOverride: input.amountDueOverride,
    payments: input.payments,
    paidAt: input.paidAt,
  });
  const outstandingAgorot = Math.round(outstanding * 100);
  return Math.max(0, Math.min(extraAgorot, outstandingAgorot)) / 100;
}
