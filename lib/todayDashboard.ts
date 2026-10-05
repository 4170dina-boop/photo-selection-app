// לוגיקה טהורה של מסך "היום" בדשבורד (app/dashboard/today/page.tsx) - בלי DB,
// כדי שההחלטות "מה דורש פעולה עכשיו ובאיזה סדר" ייבדקו ב-vitest. הנתונים
// עצמם מגיעים מ-app/api/dashboard/today.
//
// כל גלריה מופיעה במקטע אחד בלבד - הדחוף ביותר לפי TODAY_SECTION_ORDER. שאר
// המצבים שחלים עליה מוצגים כתגיות קטנות על אותה שורה (tags).

import { daysBetweenDateStrings, israelDateString, addDaysToDateString } from '@/lib/israelTime';

export type TodaySection = 'extension' | 'expiring' | 'finished' | 'editing' | 'stalled' | 'payment';

// הסדר הוא גם סדר הדחיפות: בקשה שממתינה להחלטה של הצלמת קודמת לכול, אחריה
// גלריה שעומדת לפוג (זמן אוזל), וכו'.
export const TODAY_SECTION_ORDER: readonly TodaySection[] = ['extension', 'expiring', 'finished', 'editing', 'stalled', 'payment'];

// "עומדות לפוג" = עד 3 ימים לסוף התוקף - אותו חלון כמו באנר "דורש תשומת לב"
// שהיה ברשימת הגלריות, וכמו EXTENSION_WARNING_DAYS אצל הלקוחה.
export const EXPIRING_WINDOW_DAYS = 3;
// "נעצרו באמצע" = הלקוחה התחילה לבחור, ולא הייתה פעילה לפחות 4 ימים.
export const STALLED_AFTER_DAYS = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TodayGallery {
  id: string;
  status: string;
  created_at: string | null;
  sent_at: string | null;
  expires_at: string | null;
  // מתעדכן ע"י טריגר על selections (בחירה/ביטול/הערה של הלקוחה) ובסיום הבחירה
  last_activity_at: string | null;
  // כל טעינה של הגלריה ע"י הלקוחה (increment_gallery_view_count)
  last_viewed_at: string | null;
  editing_started_at: string | null;
  delivered_at: string | null;
  reopened_for_selection_at: string | null;
  // בחירות רשמיות (של הבעלים, בלי מתנות) - כמו ברשימת הגלריות
  selectedCount: number;
  // יתרה לגבייה (computePaymentSummary.outstanding) - 0 כשסומן כשולם
  outstanding: number;
  // בקשת הארכה ממתינה (gallery_extension_requests.status = 'pending'), אם יש
  pendingExtension: { id: string; days: number; createdAt: string | null } | null;
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

// הלקוחה עדיין בוחרת: sent/in_progress, או completed שהצלמת פתחה מחדש -
// אותו תנאי כמו isReminderEligible ב-lib/galleryLifecycle.ts (בלי התוקף).
export function isInSelection(g: Pick<TodayGallery, 'status' | 'reopened_for_selection_at'>): boolean {
  return g.status === 'sent' || g.status === 'in_progress' || (g.status === 'completed' && !!g.reopened_for_selection_at);
}

// ה-cron מסמן expired רק פעם ביום - כאן מחשבים גם לפי expires_at בפועל.
export function isPastExpiry(g: Pick<TodayGallery, 'status' | 'expires_at'>, now: Date): boolean {
  if (g.status === 'expired') return true;
  const expires = timeOf(g.expires_at);
  return expires !== null && expires <= now.getTime();
}

// "לקוחות בוחרות עכשיו": התחילו לבחור (in_progress או נפתחה מחדש) ועוד בתוקף.
// sent לא נספרת - הלקוחה עוד לא בחרה אף תמונה.
export function isSelectingNow(g: TodayGallery, now: Date): boolean {
  const started = g.status === 'in_progress' || (g.status === 'completed' && !!g.reopened_for_selection_at);
  return started && !isPastExpiry(g, now);
}

// כמה ימים (שבר) נשארו עד סוף התוקף, או null כשאין תוקף
export function daysUntilExpiry(g: Pick<TodayGallery, 'expires_at'>, now: Date): number | null {
  const expires = timeOf(g.expires_at);
  return expires === null ? null : (expires - now.getTime()) / DAY_MS;
}

export function isExpiringSoon(g: TodayGallery, now: Date): boolean {
  if (!isInSelection(g) || isPastExpiry(g, now)) return false;
  const left = daysUntilExpiry(g, now);
  return left !== null && left <= EXPIRING_WINDOW_DAYS;
}

// הלקוחה סימנה "סיימתי לבחור" והצלמת עוד לא התחילה לערוך (ולא מסרה)
export function isFinishedAwaitingEdit(g: TodayGallery): boolean {
  return g.status === 'completed' && !g.reopened_for_selection_at && !g.editing_started_at && !g.delivered_at;
}

export function isInEditing(g: TodayGallery): boolean {
  return !!g.editing_started_at && !g.delivered_at;
}

// הפעילות האחרונה של הלקוחה בגלריה. אין טבלת "נראתה לאחרונה" למשתתפים, אבל
// יש שני סימנים קיימים: last_activity_at (טריגר על כל שינוי ב-selections -
// בפועל זמן הבחירה האחרונה) ו-last_viewed_at (כל פתיחה של הגלריה). לוקחים את
// המאוחר מביניהם - לקוחה שנכנסת ומתלבטת בלי לסמן עדיין "פעילה". בלי אף אחד
// מהם (נתונים ישנים) נופלים לזמן השליחה/היצירה.
export function lastClientActivityAt(g: TodayGallery): string | null {
  const candidates = [g.last_activity_at, g.last_viewed_at]
    .map((iso) => ({ iso, t: timeOf(iso) }))
    .filter((c): c is { iso: string; t: number } => c.t !== null);
  if (candidates.length === 0) return g.sent_at ?? g.created_at ?? null;
  return candidates.sort((a, b) => b.t - a.t)[0].iso;
}

// ימים לוחיים (בזמן ישראל) שעברו מרגע נתון ועד עכשיו - "אתמול" = 1 גם אם
// עברו רק כמה שעות מעבר לחצות. null כשאין תאריך.
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  const t = timeOf(iso);
  if (t === null) return null;
  return Math.max(0, daysBetweenDateStrings(israelDateString(new Date(t)), israelDateString(now)));
}

// נעצרה באמצע: in_progress, כבר בחרה משהו, עוד בתוקף, ולא הייתה פעילה
// STALLED_AFTER_DAYS ימים לפחות.
export function isStalled(g: TodayGallery, now: Date, afterDays: number = STALLED_AFTER_DAYS): boolean {
  if (g.status !== 'in_progress' || g.selectedCount <= 0 || isPastExpiry(g, now)) return false;
  const idle = daysSince(lastClientActivityAt(g), now);
  return idle !== null && idle >= afterDays;
}

export interface EditingProgress {
  daysInEditing: number;
  // רק כשיש לצלמת ברירת מחדל של ימי מסירה: תאריך יעד (YYYY-MM-DD) וכמה ימים
  // נשארו עד אליו (שלילי = באיחור)
  dueDate: string | null;
  daysLeft: number | null;
}

// כמה זמן הגלריה בעריכה, ואופציונלית תאריך יעד = תחילת העריכה + ימי מסירה.
// כרגע אין בהגדרות הצלמת "ימי מסירה" - הפונקציה מוכנה לכך (deliveryDays
// null = רק ימים בעריכה).
export function editingProgress(editingStartedAt: string, now: Date, deliveryDays: number | null = null): EditingProgress {
  const daysInEditing = daysSince(editingStartedAt, now) ?? 0;
  if (deliveryDays == null || !Number.isFinite(deliveryDays) || deliveryDays <= 0) {
    return { daysInEditing, dueDate: null, daysLeft: null };
  }
  const t = timeOf(editingStartedAt);
  if (t === null) return { daysInEditing, dueDate: null, daysLeft: null };
  const dueDate = addDaysToDateString(israelDateString(new Date(t)), Math.floor(deliveryDays));
  return { daysInEditing, dueDate, daysLeft: daysBetweenDateStrings(israelDateString(now), dueDate) };
}

// כל המקטעים שחלים על גלריה, בסדר הדחיפות
export function gallerySections(g: TodayGallery, now: Date): TodaySection[] {
  const checks: Record<TodaySection, boolean> = {
    extension: !!g.pendingExtension,
    expiring: isExpiringSoon(g, now),
    finished: isFinishedAwaitingEdit(g),
    editing: isInEditing(g),
    stalled: isStalled(g, now),
    payment: g.outstanding > 0,
  };
  return TODAY_SECTION_ORDER.filter((s) => checks[s]);
}

export interface TodayItem {
  gallery: TodayGallery;
  section: TodaySection;
  // שאר המצבים שחלים על הגלריה (תגיות על השורה)
  tags: TodaySection[];
}

export interface TodayView {
  sections: Record<TodaySection, TodayItem[]>;
  totalItems: number;
  outstandingTotal: number;
  outstandingCount: number;
  selectingCount: number;
}

function ascBy(get: (g: TodayGallery) => number | null) {
  return (a: TodayItem, b: TodayItem) => {
    const x = get(a.gallery);
    const y = get(b.gallery);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  };
}

// מיון בתוך כל מקטע - "מי ראשונה בתור": הבקשה/ההמתנה הוותיקה ביותר קודם,
// התוקף הקרוב ביותר קודם, החוב הגדול ביותר קודם.
const SECTION_SORT: Record<TodaySection, (a: TodayItem, b: TodayItem) => number> = {
  extension: ascBy((g) => timeOf(g.pendingExtension?.createdAt)),
  expiring: ascBy((g) => timeOf(g.expires_at)),
  finished: ascBy((g) => timeOf(g.last_activity_at)),
  editing: ascBy((g) => timeOf(g.editing_started_at)),
  stalled: ascBy((g) => timeOf(lastClientActivityAt(g))),
  payment: (a, b) => b.gallery.outstanding - a.gallery.outstanding,
};

export function buildTodayView(galleries: TodayGallery[], now: Date): TodayView {
  const sections = Object.fromEntries(TODAY_SECTION_ORDER.map((s) => [s, [] as TodayItem[]])) as Record<TodaySection, TodayItem[]>;
  let totalItems = 0;
  // סכומים באגורות שלמות, כמו lib/payments.ts
  let outstandingAgorot = 0;
  let outstandingCount = 0;
  let selectingCount = 0;

  for (const g of galleries) {
    if (g.outstanding > 0) {
      outstandingAgorot += Math.round(g.outstanding * 100);
      outstandingCount++;
    }
    if (isSelectingNow(g, now)) selectingCount++;

    const applicable = gallerySections(g, now);
    if (applicable.length === 0) continue;
    const [section, ...tags] = applicable;
    sections[section].push({ gallery: g, section, tags });
    totalItems++;
  }

  for (const s of TODAY_SECTION_ORDER) sections[s].sort(SECTION_SORT[s]);

  return { sections, totalItems, outstandingTotal: outstandingAgorot / 100, outstandingCount, selectingCount };
}

// ---------- צילומים היום ומחר ----------

export interface TodayShootLike {
  shoot_date: string;
  start_time: string;
}

// [היום, מחר] בזמן ישראל - טווח השליפה של app/api/dashboard/today
export function todayAndTomorrow(now: Date): [string, string] {
  const today = israelDateString(now);
  return [today, addDaysToDateString(today, 1)];
}

export function sortShoots<T extends TodayShootLike>(shoots: T[]): T[] {
  return [...shoots].sort((a, b) =>
    a.shoot_date === b.shoot_date ? a.start_time.localeCompare(b.start_time) : a.shoot_date.localeCompare(b.shoot_date)
  );
}

export function wazeUrl(location: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(location.trim())}&navigate=yes`;
}
