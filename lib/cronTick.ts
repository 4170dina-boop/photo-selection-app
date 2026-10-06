import { timingSafeEqual } from 'crypto';
import { israelDateString, daysBetweenDateStrings } from '@/lib/israelTime';
import { isSelectionFinal } from '@/lib/galleryLifecycle';
import type { RowGuard } from '@/lib/rowGuard';
import { effectiveExpiryIso } from '@/lib/jewishCalendar';

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

// "תפיסה" של גלריה לניקוי *לפני* מחיקה כלשהי ב-R2: UPDATE מותנה שמסמן
// originals_cleaned_up_at רק אם השורה עדיין בדיוק במצב שעליו isOriginalsCleanupDue
// החליטה (עדיין completed, לא נפתחה מחדש, לא נוקתה, ואותם delivered_at/התראה).
// בלי זה: ה-cron שלף גלריה כזכאית, הצלמת פתחה בינתיים את הבחירה מחדש (או ביטלה
// "נמסר"), וה-cron מחק את המקור של גלריה שהלקוחה בוחרת בה שוב. מחיקה רק אם
// ה-UPDATE באמת החזיר את השורה. הצד השני (reopen-selection) מותנה ב-
// originals_cleaned_up_at is null - כך רק אחד מהשניים יכול לנצח.
export function originalsCleanupClaimGuard(gallery: OriginalsCleanupCandidate): RowGuard {
  return {
    status: 'completed',
    reopened_for_selection_at: null,
    originals_cleaned_up_at: null,
    delivered_at: gallery.delivered_at,
    originals_deletion_warning_sent_at: gallery.originals_deletion_warning_sent_at,
  };
}

// אחרי תפיסה, כישלון בניקוי: אם עוד לא נמחק אף קובץ - משחררים את התפיסה כדי
// שהריצה הבאה תנסה שוב (ותתפוס שוב רק אם הגלריה עדיין זכאית). אם כבר נמחק
// חלק מהמקור - משאירים "נוקה": המקור כבר לא שלם, ואסור לאפשר פתיחה מחדש של
// בחירה מתוכו (הקבצים שנשארו הם רק בזבוז אחסון).
export function shouldReleaseCleanupClaim(deletedCount: number): boolean {
  return deletedCount === 0;
}

// ---------- תפיסת שליחה של התראת מחיקת המקור (שלב 3) ----------

// originals_deletion_warning_sent_at נכתב רק אחרי שליחה מוצלחת (שלב 4 דורש
// אותו לפני מחיקה). התפיסה נגד שליחה כפולה היא בעמודה נפרדת,
// originals_deletion_warning_claimed_at: אם הריצה נהרגת בין התפיסה לשליחה
// (timeout וכו'), התפיסה מתיישנת והריצה הבאה מנסה שוב - ואף פעם לא נוצר מצב
// של "נשלחה" בלי שנשלחה. שעה = הרבה מעבר ל-maxDuration של ריצה אחת.
export const WARNING_CLAIM_STALE_MS = 60 * 60 * 1000;

export interface WarningClaimState {
  originals_deletion_warning_sent_at: string | null;
  originals_deletion_warning_claimed_at?: string | null;
}

// מותר לתפוס: ההתראה עוד לא נשלחה, ואין תפיסה פעילה (או שהקיימת התיישנה).
export function canClaimOriginalsWarning(gallery: WarningClaimState, now: Date): boolean {
  if (gallery.originals_deletion_warning_sent_at) return false;
  const claimed = gallery.originals_deletion_warning_claimed_at;
  if (!claimed) return true;
  const t = new Date(claimed).getTime();
  return Number.isNaN(t) || t <= now.getTime() - WARNING_CLAIM_STALE_MS;
}

// UPDATE מותנה של התפיסה: רק אם ההתראה עדיין לא נשלחה והתפיסה היא בדיוק זו
// שנקראה (null או תפיסה ישנה) - שתי ריצות מקבילות לא יכולות לתפוס שתיהן.
export function originalsWarningClaimGuard(gallery: WarningClaimState): RowGuard {
  return {
    originals_deletion_warning_sent_at: null,
    originals_deletion_warning_claimed_at: gallery.originals_deletion_warning_claimed_at ?? null,
  };
}

// מה לכתוב אחרי ניסיון השליחה. רק שליחה מוצלחת מסמנת "נשלחה" (ומתחילה את
// ספירת 5 הימים עד המחיקה). כישלון רק משחרר את התפיסה.
export function originalsWarningAfterSendPatch(
  sent: boolean,
  sentAt: string,
  claimSupported: boolean
): { originals_deletion_warning_sent_at?: string; originals_deletion_warning_claimed_at?: null } | null {
  if (sent) {
    return claimSupported
      ? { originals_deletion_warning_sent_at: sentAt, originals_deletion_warning_claimed_at: null }
      : { originals_deletion_warning_sent_at: sentAt };
  }
  return claimSupported ? { originals_deletion_warning_claimed_at: null } : null;
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

// ---------- תפוגה בשבת/חג (שלב 1) ----------

export interface ExpiryCandidate {
  id: string;
  expires_at: string | null;
  photographer_id: string;
}

// כמה ימים קדימה מחפשים גלריות שתוקפן נופל בשבת/חג כדי לדחות אותו מראש
// (לפני שהלקוחה ננעלת בחוץ במוצאי שבת) - רצף שבת/חג הוא עד 3 ימים, +1 מרווח
// לריצה יומית שהתפספסה.
export const SHABBAT_EXTENSION_LOOKAHEAD_DAYS = 4;

export function shabbatExtensionQueryUpperBound(now: Date): string {
  return new Date(now.getTime() + SHABBAT_EXTENSION_LOOKAHEAD_DAYS * MS_PER_DAY).toISOString();
}

// מה לעשות עם כל גלריה פעילה שתוקפה עבר / מתקרב: תפוגה שנופלת (לפי התאריך
// בישראל) בשבת/חג נדחית לסוף יום החול הבא (effectiveExpiryIso) - "extend"
// מעדכן את expires_at בפועל, כדי שגם בדיקות הגישה של הלקוחה (isGalleryExpired)
// יכבדו את הדחייה. "expire" רק לגלריות שגם התפוגה האפקטיבית שלהן כבר עברה.
// respectFor(photographerId) - photographers.respect_shabbat (חסר = true).
export function planExpiryActions(
  rows: ExpiryCandidate[],
  respectFor: (photographerId: string) => boolean,
  now: Date
): { extend: { id: string; from: string; to: string }[]; expire: string[] } {
  const extend: { id: string; from: string; to: string }[] = [];
  const expire: string[] = [];
  for (const row of rows) {
    if (!row.expires_at) continue;
    const original = new Date(row.expires_at);
    if (Number.isNaN(original.getTime())) continue;
    const effective = effectiveExpiryIso(row.expires_at, respectFor(row.photographer_id));
    if (effective && effective !== original.toISOString() && new Date(effective).getTime() > now.getTime()) {
      extend.push({ id: row.id, from: row.expires_at, to: effective });
    } else if (original.getTime() < now.getTime()) {
      expire.push(row.id);
    }
  }
  return { extend, expire };
}

// ---------- מייל "לפני שנה צילמנו" (שלב 7) ----------

// כ-11 חודשים אחרי המסירה, עם חלון של חודש: ריצות שנדחו (שבת/חג, כישלון
// שליחה) עדיין מספיקות לשלוח, אבל גלריה ותיקה (שנמסרה לפני יותר משנה, למשל
// כשהצלמת רק עכשיו הפעילה את האפשרות) לא מקבלת מייל "לפני שנה" באיחור.
export const ANNIVERSARY_MIN_DAYS = 335;
export const ANNIVERSARY_MAX_DAYS = 365;

export function isAnniversaryEmailDue(deliveredAt: string | null, sentAt: string | null, now: Date): boolean {
  if (!deliveredAt || sentAt) return false;
  const delivered = new Date(deliveredAt);
  if (Number.isNaN(delivered.getTime())) return false;
  const days = daysBetweenDateStrings(israelDateString(delivered), israelDateString(now));
  return days >= ANNIVERSARY_MIN_DAYS && days <= ANNIVERSARY_MAX_DAYS;
}

// גבולות ל-SQL על delivered_at (יום מרווח לכל צד - הבדיקה המדויקת למעלה)
export function anniversaryQueryBounds(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - (ANNIVERSARY_MAX_DAYS + 1) * MS_PER_DAY).toISOString(),
    to: new Date(now.getTime() - (ANNIVERSARY_MIN_DAYS - 1) * MS_PER_DAY).toISOString(),
  };
}

// טבלה חסרה (client_dates לפני המיגרציה): 42P01 מ-Postgres, PGRST205 מ-PostgREST
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '');
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
