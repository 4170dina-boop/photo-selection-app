// לוגיקה טהורה של מעקב תשלומים לגלריה (בלי DB/רשת) - משותפת ל-API
// (app/api/galleries/[id]/payments/*) ולמסכי הדשבורד (רשימת גלריות, דוחות,
// עריכת גלריה), כדי שכולם יחשבו "כמה נשאר לשלם" בדיוק אותו דבר.
//
// כל החישובים באגורות שלמות (×100) ורק בסוף חזרה לשקלים - numeric(10,2)
// ב-DB, אבל חיבור floats ב-JS (0.1 + 0.2) היה משאיר יתרה של 0.0000001
// שנראית כמו "עדיין חייבת".

export interface PackagePricing {
  included_photos: number | null;
  base_price: number | string | null;
  extra_photo_price: number | string | null;
}

export interface PaymentLike {
  amount: number | string;
}

export interface PaymentSummary {
  // הסכום שהיה מחושב מהחבילה לבד (גם כשיש דריסה ידנית - כדי להציג אותו לצלמת)
  packageAmount: number;
  // הסכום הכולל לתשלום בפועל: הדריסה הידנית אם יש, אחרת packageAmount
  total: number;
  isOverridden: boolean;
  paid: number;
  // total פחות paid - שלילי כשהלקוחה שילמה יותר מהנדרש
  balance: number;
  // כמה הלקוחה עדיין "חייבת" לצורך סיכומים (רשימת חובות, סה"כ לגבייה):
  // 0 אם הגלריה סומנה כשולמה (paid_at) - גם ידנית, למשל כשהצלמת ויתרה על
  // היתרה - אחרת max(0, balance).
  outstanding: number;
  paymentCount: number;
}

function toAgorot(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromAgorot(agorot: number): number {
  return agorot / 100;
}

// מחיר החבילה + חריגה: אותה נוסחה שרשימת הגלריות ודוח ההכנסות כבר מציגים
// (בסיס + תמונות שנבחרו מעבר לכלולות × מחיר לתמונה נוספת).
export function packageAmount(pkg: PackagePricing | null | undefined, selectedCount: number): number {
  if (!pkg) return 0;
  const extraPhotos = Math.max(0, selectedCount - (pkg.included_photos ?? 0));
  return fromAgorot(toAgorot(pkg.base_price) + extraPhotos * toAgorot(pkg.extra_photo_price));
}

export function computePaymentSummary(input: {
  pkg: PackagePricing | null | undefined;
  selectedCount: number;
  amountDueOverride: number | string | null | undefined;
  payments: PaymentLike[] | null | undefined;
  paidAt: string | null | undefined;
}): PaymentSummary {
  const pkgAgorot = toAgorot(packageAmount(input.pkg, input.selectedCount));
  const isOverridden = input.amountDueOverride != null && input.amountDueOverride !== '';
  const totalAgorot = isOverridden ? toAgorot(input.amountDueOverride) : pkgAgorot;
  const payments = input.payments ?? [];
  const paidAgorot = payments.reduce((sum, p) => sum + toAgorot(p.amount), 0);
  const balanceAgorot = totalAgorot - paidAgorot;

  return {
    packageAmount: fromAgorot(pkgAgorot),
    total: fromAgorot(totalAgorot),
    isOverridden,
    paid: fromAgorot(paidAgorot),
    balance: fromAgorot(balanceAgorot),
    outstanding: input.paidAt ? 0 : fromAgorot(Math.max(0, balanceAgorot)),
    paymentCount: payments.length,
  };
}

// total_changed = הסכום מהחבילה השתנה בעקיפין (בחירה של הלקוחה, סימון מתנה,
// עריכת החבילה) - לא דרך מסך התשלומים. מתנהג כמו amount_changed.
export type PaymentChange = 'payment_added' | 'payment_deleted' | 'amount_changed' | 'total_changed';

// הערך החדש של galleries.paid_at אחרי שינוי בתשלומים/בסכום לתשלום.
//
// הכלל (הכי פחות מפתיע לצלמת שכבר התרגלה לכפתור "סימון כשולם"):
// - ברגע שיש רישום תשלומים, paid_at נגזר מהיתרה: מסומן כשהתשלומים מכסים
//   את הסכום (שומר את התאריך המקורי אם כבר היה מסומן), ומתבטל כשלא.
// - שינוי הסכום לתשלום בגלריה *בלי אף תשלום רשום* לא נוגע ב-paid_at - כדי
//   לא למחוק סימון ידני ישן של צלמת שלא משתמשת ברישום תשלומים בכלל.
// - מחיקת התשלום האחרון (לא נשאר אף תשלום) גם היא לא נוגעת ב-paid_at - אין
//   יותר ממה לגזור, וסימון ידני שקדם לרישום התשלומים לא אמור להימחק איתו.
// - הכפתור הידני (toggle-paid) ממשיך לעבוד כמו קודם ולא עובר דרך כאן; הוא
//   "דורס" עד השינוי הבא ברשימת התשלומים.
export function nextPaidAt(
  currentPaidAt: string | null,
  summary: Pick<PaymentSummary, 'total' | 'paid' | 'paymentCount'>,
  change: PaymentChange,
  nowIso: string
): string | null {
  if (summary.paymentCount === 0 && change !== 'payment_added') return currentPaidAt;
  const fullyPaid = summary.paid > 0 && summary.paid >= summary.total;
  return fullyPaid ? currentPaidAt ?? nowIso : null;
}

export interface PaymentInput {
  amount: number;
  paidOn: string;
  method: string | null;
  note: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 99_999_999.99; // numeric(10,2)

function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// אימות גוף בקשה להוספת תשלום. todayDate = "YYYY-MM-DD" (בזמן ישראל) לברירת
// מחדל כשלא נשלח תאריך.
export function parsePaymentInput(
  body: unknown,
  todayDate: string
): { ok: true; value: PaymentInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const amount = typeof b.amount === 'string' && b.amount.trim() !== '' ? Number(b.amount) : b.amount;

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'סכום התשלום חייב להיות מספר גדול מ-0' };
  }
  if (amount > MAX_AMOUNT) {
    return { ok: false, error: 'סכום התשלום גדול מדי' };
  }

  const paidOn = typeof b.paidOn === 'string' && b.paidOn.trim() ? b.paidOn.trim() : todayDate;
  if (!isValidDateString(paidOn)) {
    return { ok: false, error: 'תאריך התשלום לא תקין' };
  }

  const method = typeof b.method === 'string' && b.method.trim() ? b.method.trim().slice(0, 50) : null;
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null;

  return { ok: true, value: { amount: Math.round(amount * 100) / 100, paidOn, method, note } };
}

// אימות הסכום לתשלום שהצלמת דורסת ידנית. null/"" = חזרה לחישוב האוטומטי מהחבילה.
export function parseAmountDueOverride(
  value: unknown
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return { ok: true, value: null };
  }
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) {
    return { ok: false, error: 'הסכום לתשלום חייב להיות מספר אי-שלילי' };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

// תצוגת סכום בשקלים - בלי ".00" לסכומים שלמים (רוב המקרים), עם אגורות כשיש.
export function formatShekels(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const abs = Math.abs(rounded);
  const text = Number.isInteger(abs)
    ? abs.toLocaleString('en-US')
    : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${rounded < 0 ? '-' : ''}₪${text}`;
}
