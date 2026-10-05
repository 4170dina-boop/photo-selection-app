// סיכומי הכנסות לדשבורד (רשימת גלריות, דוחות, אנליטיקס) - מעל
// computePaymentSummary ב-lib/payments.ts, כדי שכל המסכים יסכימו עם "הסכום
// לתשלום" של הגלריה עצמה: כולל דריסה ידנית (amount_due_override), וחיבור
// באגורות שלמות במקום floats (0.1 + 0.2).
import { computePaymentSummary, packageAmount, type PackagePricing } from './payments';
import { israelDateString } from './israelTime';

export interface RevenueInput {
  pkg: PackagePricing | null | undefined;
  selectedCount: number;
  amountDueOverride: number | string | null | undefined;
}

export interface GalleryRevenue {
  // הסכום לתשלום בפועל (הדריסה הידנית אם יש, אחרת חבילה + חריגה)
  total: number;
  // החלק של חריגה מהחבילה בתוך total - 0 כשיש דריסה ידנית (אז הסכום נקבע
  // ידנית ואין "חריגה" אוטומטית שנגבית)
  overage: number;
}

export function galleryRevenue(input: RevenueInput): GalleryRevenue {
  const summary = computePaymentSummary({
    pkg: input.pkg,
    selectedCount: input.selectedCount,
    amountDueOverride: input.amountDueOverride,
    payments: [],
    paidAt: null,
  });
  const overage = summary.isOverridden
    ? 0
    : (Math.round(packageAmount(input.pkg, input.selectedCount) * 100) - Math.round(packageAmount(input.pkg, 0) * 100)) / 100;
  return { total: summary.total, overage };
}

// חיבור סכומים בשקלים דרך אגורות שלמות.
export function sumShekels(values: Iterable<number>): number {
  let agorot = 0;
  for (const v of values) agorot += Number.isFinite(v) ? Math.round(v * 100) : 0;
  return agorot / 100;
}

// מפתח חודש "YYYY-MM" לפי הלוח בישראל (לא אזור הזמן של הדפדפן) - גלריה
// שנוצרה ב-1 לחודש בחצות ורבע בישראל שייכת לחודש החדש גם אם הצלמת בחו"ל.
export function israelMonthKey(iso: string): string {
  return israelDateString(new Date(iso)).slice(0, 7);
}
