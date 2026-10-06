// תמחור החבילה כפי שהלקוח/ה רואה אותו בגלריה (app/gallery/[id]/page.tsx),
// כולל סכום ידני שהצלמת קבעה (galleries.amount_due_override, ראו lib/payments.ts).
// לוגיקה טהורה - בלי DB/רשת - כדי שאפשר יהיה לבדוק ב-vitest.
//
// כשיש סכום ידני הוא *הסכום לתשלום* - החישוב "N × מחיר" כבר לא רלוונטי, ולכן
// לא מציגים אותו (לא בקופסת החבילה, לא בבאנר החריגה, לא בתצוגה המוגדלת ולא
// בחלון הסיכום), אחרת הלקוחה רואה שני סכומים סותרים. את הסכום עצמו רק הבעלים
// מקבלת מהשרת (זה החשבון שלה); אורחים מקבלים רק את הדגל priceOverridden, כדי
// להסתיר את החישוב בלי לחשוף סכום.

export interface ClientPackageInfo {
  included: number;
  extraPrice: number;
  basePrice: number;
  // true = הצלמת קבעה סכום ידני (גם כשהצופה אורח/ת ולא מקבל/ת את הסכום)
  priceOverridden?: boolean;
  // הסכום הידני - רק לבעלים; null לאורחים/בלי סכום ידני
  agreedTotal?: number | null;
}

interface PackageRow {
  included_photos: number | null;
  extra_photo_price: number | string | null;
  base_price: number | string | null;
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// הצד של השרת (app/api/gallery/[id]/route.ts): מה נשלח ללקוח/ה על החבילה.
export function clientPackagePricing(
  pkg: PackageRow | null | undefined,
  amountDueOverride: number | string | null | undefined,
  isOwner: boolean
): ClientPackageInfo | null {
  if (!pkg) return null;
  const overridden = amountDueOverride != null && amountDueOverride !== '' && Number.isFinite(Number(amountDueOverride));
  return {
    included: toNumber(pkg.included_photos),
    extraPrice: toNumber(pkg.extra_photo_price),
    basePrice: toNumber(pkg.base_price),
    priceOverridden: overridden,
    agreedTotal: overridden && isOwner ? Math.round(Number(amountDueOverride) * 100) / 100 : null,
  };
}

export interface ClientPriceDisplay {
  // computed = חישוב מהחבילה כמו קודם; agreed = סכום ידני (בעלים);
  // hidden = יש סכום ידני אבל הצופה אורח/ת - לא מציגים מחירים בכלל
  mode: 'computed' | 'agreed' | 'hidden';
  // הסה"כ להצגה בקופסת החבילה, או null = לא מציגים שורת סה"כ
  total: number | null;
  // "(X חבילה + Y תוספת)" ליד הסה"כ
  showBreakdown: boolean;
  // עלויות התוספת המחושבות (באנר חריגה, תצוגה מוגדלת, "N × מחיר" בחלון הסיכום,
  // מחיר לתמונה נוספת)
  showExtraCosts: boolean;
}

export function resolveClientPriceDisplay(
  pkg: ClientPackageInfo | null | undefined,
  usage: { extraCount: number; totalEstimate: number }
): ClientPriceDisplay {
  if (!pkg) return { mode: 'computed', total: null, showBreakdown: false, showExtraCosts: false };
  if (pkg.agreedTotal != null) {
    return { mode: 'agreed', total: pkg.agreedTotal, showBreakdown: false, showExtraCosts: false };
  }
  if (pkg.priceOverridden) {
    return { mode: 'hidden', total: null, showBreakdown: false, showExtraCosts: false };
  }
  return {
    mode: 'computed',
    // כמו קודם: סה"כ משוער רק כשיש מחיר בסיס לחבילה
    total: pkg.basePrice > 0 ? usage.totalEstimate : null,
    showBreakdown: pkg.basePrice > 0 && usage.extraCount > 0,
    showExtraCosts: true,
  };
}
