// "תמונת מתנה" - תמונה שהצלמת מסמנת כבונוס ללקוחה (photos.is_gift, ראו
// supabase/schema.sql). כלולה אוטומטית במסירה, ולא נספרת לא במכסת החבילה
// (included_photos) ולא בחיוב על תמונות נוספות (extra_photo_price).
//
// כל הלוגיקה הטהורה כאן (בלי Supabase) כדי שאפשר יהיה לבדוק אותה ב-vitest
// ולהשתמש באותו חישוב גם בצד השרת, גם בדשבורד וגם בגלריית הלקוחה.

export const GIFT_MESSAGE_MAX_LENGTH = 200;

export type GiftMessageResult = { ok: true; value: string | null } | { ok: false; error: string };

// הודעה אישית קצרה לתמונת המתנה - אופציונלית. רווחים בלבד = אין הודעה.
export function normalizeGiftMessage(raw: unknown): GiftMessageResult {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'הודעה לא תקינה' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > GIFT_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `ההודעה ארוכה מדי (עד ${GIFT_MESSAGE_MAX_LENGTH} תווים)` };
  }
  return { ok: true, value: trimmed };
}

// כמה מהבחירות 'selected' נספרות בפועל לחבילה/לחיוב - בלי תמונות מתנה.
// בחירה על תמונת מתנה יכולה להתקיים אם הלקוחה סימנה את התמונה לפני שהצלמת
// הפכה אותה למתנה (route הבחירה חוסם סימון חדש של מתנה) - לא מוחקים אותה
// (כדי שביטול המתנה יחזיר את המצב הקודם), פשוט לא סופרים.
export function countBillableSelected(
  selections: { photo_id: string; status: string | null }[],
  giftPhotoIds: Iterable<string>
): number {
  const gifts = giftPhotoIds instanceof Set ? (giftPhotoIds as Set<string>) : new Set(giftPhotoIds);
  return selections.filter((s) => s.status === 'selected' && !gifts.has(s.photo_id)).length;
}

export interface PackageUsage {
  // כמה עוד אפשר לבחור בלי תוספת תשלום
  remaining: number;
  // תמונות מעבר למכסה - אלה בלבד מחויבות ב-extraPrice
  extraCount: number;
  extraCost: number;
  // מחיר החבילה + תוספות. תמונות מתנה תמיד 0 ₪.
  totalEstimate: number;
  // אחוז מילוי המכסה (0-100), לפס ההתקדמות
  progressPct: number;
}

// billableSelectedCount חייב להיות כבר בלי מתנות (ראו countBillableSelected) -
// אין כאן פרמטר של מספר מתנות בכוונה, כדי שלא יהיה אפשר "בטעות" לחייב עליהן.
export function computePackageUsage(params: {
  billableSelectedCount: number;
  included: number;
  extraPrice: number;
  basePrice: number;
}): PackageUsage {
  const selected = Math.max(0, params.billableSelectedCount);
  const included = Math.max(0, params.included);
  const extraPrice = Number(params.extraPrice) || 0;
  const basePrice = Number(params.basePrice) || 0;

  const extraCount = Math.max(0, selected - included);
  const extraCost = extraCount * extraPrice;
  return {
    remaining: Math.max(0, included - selected),
    extraCount,
    extraCost,
    totalEstimate: basePrice + extraCost,
    progressPct: included > 0 ? Math.min(100, Math.round((selected / included) * 100)) : 0,
  };
}

// החריגה בלבד (דשבורד/דוחות) - אותו חישוב בדיוק כמו computePackageUsage.
export function computeOverage(billableSelectedCount: number, included: number, extraPrice: number) {
  const usage = computePackageUsage({ billableSelectedCount, included, extraPrice, basePrice: 0 });
  return { count: usage.extraCount, cost: usage.extraCost };
}

// רשימת הייצוא/המסירה לצלמת: הבחירות הרשמיות + כל תמונות המתנה (גם אם הלקוחה
// לא סימנה אותן - הן כלולות אוטומטית, והצלמת צריכה לערוך גם אותן). בלי
// כפילויות: תמונת מתנה שגם סומנה מופיעה פעם אחת, מסומנת isGift.
// סדר: הבחירות קודם (בסדר המקורי), ואחריהן המתנות שלא נבחרו.
export function mergeGiftPhotosIntoExport<S extends { photoId: string }, G extends { photoId: string }>(
  selected: S[],
  gifts: G[]
): ((S & { isGift: boolean }) | (G & { isGift: true }))[] {
  const giftIds = new Set(gifts.map((g) => g.photoId));
  const seen = new Set<string>();
  const result: ((S & { isGift: boolean }) | (G & { isGift: true }))[] = [];

  for (const s of selected) {
    if (seen.has(s.photoId)) continue;
    seen.add(s.photoId);
    result.push({ ...s, isGift: giftIds.has(s.photoId) });
  }
  for (const g of gifts) {
    if (seen.has(g.photoId)) continue;
    seen.add(g.photoId);
    result.push({ ...g, isGift: true });
  }
  return result;
}

// ערך ל-PostgREST "photo_id not in (...)" - כדי להוציא תמונות מתנה מספירת
// count של selections בלי למשוך את כל השורות. null = אין מתנות, אין מה לסנן.
// רק מזהים בפורמט uuid (בלי פסיקים/סוגריים) נכנסים למחרוזת.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function giftExclusionFilter(giftPhotoIds: string[]): string | null {
  const ids = giftPhotoIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return null;
  return `(${ids.join(',')})`;
}

// מקבץ שורות {id, gallery_id} של תמונות מתנה לפי גלריה (לדשבורד, שאילתה אחת
// לכל הגלריות במקום שאילתה לכל גלריה).
export function groupGiftIdsByGallery(rows: { id: string; gallery_id: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.gallery_id);
    if (list) list.push(row.id);
    else map.set(row.gallery_id, [row.id]);
  }
  return map;
}
