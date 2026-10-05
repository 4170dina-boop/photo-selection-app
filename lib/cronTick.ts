import { timingSafeEqual } from 'crypto';
import { israelDateString, daysBetweenDateStrings } from '@/lib/israelTime';
import { isSelectionFinal } from '@/lib/galleryLifecycle';

// לוגיקה טהורה של app/api/cron/tick/route.ts (בלי DB ובלי שליחת מיילים) -
// כדי שההחלטות "האם מותר/צריך עכשיו" ייבדקו ב-vitest.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------- הרשאה ----------

// רק Authorization: Bearer <CRON_SECRET> (כך Vercel Cron שולח את הבקשה) - לא
// ?secret= ב-query, שנרשם בלוגים של שרתים/פרוקסים. השוואה ב-timingSafeEqual
// כדי לא לחשוף את הסוד דרך זמני תגובה.
export function isCronAuthorized(authHeader: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(authHeader, 'utf8');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// ---------- תזכורת תפוגה (שלב 2) ----------

// תקרה לחלון התזכורת - גם מגבילה את השאילתה ב-SQL (expires_at <= now + תקרה)
// כדי לא לשלוף כל גלריה פתוחה בכל ריצה. ערך גדול יותר שהוגדר נחתך לתקרה.
export const MAX_EXPIRY_REMINDER_DAYS = 60;
export const DEFAULT_EXPIRY_REMINDER_DAYS = 5;

export function resolveExpiryReminderDays(
  galleryValue: number | null | undefined,
  photographerDefault: number | null | undefined
): number {
  const raw = galleryValue ?? photographerDefault ?? DEFAULT_EXPIRY_REMINDER_DAYS;
  if (!Number.isFinite(raw)) return DEFAULT_EXPIRY_REMINDER_DAYS;
  return Math.max(0, Math.min(MAX_EXPIRY_REMINDER_DAYS, Math.floor(raw)));
}

// משווים תאריכים אזרחיים בזמן ישראל (לא הפרש מדויק במילישניות) - expires_at
// נשמר כסוף היום בזמן ישראל, אז השוואת timestamp מול "עכשיו" הייתה תלויה
// בשעה שבה ה-cron רץ. גלריה שכבר פג תוקפה לא מקבלת "עומדת לפוג".
export function isExpiryReminderDue(expiresAt: string, reminderDays: number, now: Date): boolean {
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime()) || expires.getTime() < now.getTime()) return false;
  const daysUntilExpiry = daysBetweenDateStrings(israelDateString(now), israelDateString(expires));
  return daysUntilExpiry <= reminderDays;
}

export function expiryReminderQueryUpperBound(now: Date): string {
  return new Date(now.getTime() + (MAX_EXPIRY_REMINDER_DAYS + 1) * MS_PER_DAY).toISOString();
}

// ---------- מחיקת קבצי מקור (שלבים 3-4) ----------

export const ORIGINALS_GRACE_DAYS = 30;
export const ORIGINALS_WARNING_DAYS_BEFORE = 5;

export function originalsWarningThreshold(now: Date): string {
  return new Date(now.getTime() - (ORIGINALS_GRACE_DAYS - ORIGINALS_WARNING_DAYS_BEFORE) * MS_PER_DAY).toISOString();
}

export function originalsCleanupThreshold(now: Date): string {
  return new Date(now.getTime() - ORIGINALS_GRACE_DAYS * MS_PER_DAY).toISOString();
}

// סף ל-SQL על originals_deletion_warning_sent_at: יום אחד של מרווח מעבר
// לבדיקה הלוחית המדויקת ב-isOriginalsCleanupDue (הבדיקה הסופית היא שם).
export function originalsWarningSentQueryUpperBound(now: Date): string {
  return new Date(now.getTime() - (ORIGINALS_WARNING_DAYS_BEFORE - 1) * MS_PER_DAY).toISOString();
}

export interface OriginalsCleanupCandidate {
  status: string | null;
  reopened_for_selection_at: string | null;
  delivered_at: string | null;
  originals_cleaned_up_at: string | null;
  originals_deletion_warning_sent_at: string | null;
}

// מותר למחוק רק אם: נמסרה לפני 30+ יום, עוד לא נוקתה, וגם הצלמת קיבלה את
// התראת 5 הימים לפחות 5 ימים לוחיים (בזמן ישראל) קודם - כך המחיקה הבלתי-הפיכה
// אף פעם לא קורית בלי התראה מוקדמת, גם אם ההתראה נשלחה באיחור (למשל כי שליחת
// המייל נכשלה כמה ימים ברצף). ימים לוחיים ולא 5×24 שעות מדויקות, כי ה-cron
// היומי רץ כל פעם בשעה קצת אחרת.
export function isOriginalsCleanupDue(gallery: OriginalsCleanupCandidate, now: Date): boolean {
  // רק אחרי שהלקוחה סיימה לבחור והבחירה לא פתוחה מחדש - אחרת היא עדיין
  // בוחרת מתוך המקור (ראו isSelectionFinal ב-lib/galleryLifecycle.ts).
  if (!isSelectionFinal(gallery)) return false;
  if (!gallery.delivered_at || gallery.originals_cleaned_up_at || !gallery.originals_deletion_warning_sent_at) return false;
  const delivered = new Date(gallery.delivered_at).getTime();
  if (Number.isNaN(delivered) || delivered > now.getTime() - ORIGINALS_GRACE_DAYS * MS_PER_DAY) return false;
  const warnedOn = israelDateString(new Date(gallery.originals_deletion_warning_sent_at));
  return daysBetweenDateStrings(warnedOn, israelDateString(now)) >= ORIGINALS_WARNING_DAYS_BEFORE;
}

// התאריך שמוצג לצלמת בהתראה: 30 יום אחרי המסירה, אבל לא לפני 5 ימים מהיום
// (אם ההתראה יוצאת באיחור, המחיקה נדחית בהתאם - ראו isOriginalsCleanupDue).
export function originalsDeletionDate(deliveredAt: string, now: Date): Date {
  const byGrace = new Date(deliveredAt).getTime() + ORIGINALS_GRACE_DAYS * MS_PER_DAY;
  const byWarning = now.getTime() + ORIGINALS_WARNING_DAYS_BEFORE * MS_PER_DAY;
  return new Date(Math.max(byGrace, byWarning));
}

// מוחקים רק תמונות שבהן יש עותק שני עצמאי (thumbnail בנתיב אחר מהמקור) -
// אם עיבוד סימן המים נכשל בזמנו (thumbnail_path == file_path, ראו
// .../photos/[photoId]/process/route.ts), זה העותק היחיד של התמונה ואסור למחוק אותו.
export function deletableOriginalPaths(photos: { file_path: string | null; thumbnail_path: string | null }[]): string[] {
  return photos
    .filter((p) => p.file_path && p.thumbnail_path && p.thumbnail_path !== p.file_path)
    .map((p) => p.file_path as string);
}

// ---------- עזרי ריצה ----------

// שולף את כל העמודים של שאילתה (PostgREST מחזיר עד 1000 שורות כברירת מחדל).
// שולפים הכול לפני העיבוד, כי העיבוד עצמו משנה שורות שמסוננות בשאילתה (למשל
// last_reminder_sent_at) - פגינציה ב-offset תוך כדי עדכון הייתה מדלגת על שורות.
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 500,
  maxRows = 50_000
): Promise<{ rows: T[]; error: unknown | null }> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { rows, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows, error: null };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}
