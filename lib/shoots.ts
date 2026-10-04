import { israelDateString, daysBetweenDateStrings, israelLocalToUtcIso, addDaysToDateString } from '@/lib/israelTime';

// לוגיקה טהורה של יומן הצילומים (טבלת shoots, ראו supabase/schema.sql) - בלי
// גישה ל-DB ובלי שליחת מיילים, כדי שאפשר יהיה לבדוק אותה ב-vitest. ה-cron
// (app/api/cron/tick/route.ts) והדשבורד (app/dashboard/calendar/page.tsx)
// משתמשים בה. כל התאריכים כאן הם "YYYY-MM-DD" ושעות "HH:MM" לפי השעון האזרחי
// בישראל (Asia/Jerusalem) - כך הצלמת מזינה אותם וכך הם נשמרים
// (shoot_date date + start_time time, בלי אזור זמן).

export const DEFAULT_SHOOT_REMINDER_DAYS = 1;
// תקרה לערך ההגדרה - גם מגבילה כמה רחוק קדימה ה-cron צריך לשלוף צילומים.
export const MAX_SHOOT_REMINDER_DAYS = 30;

export interface ShootTiming {
  shoot_date: string;
  start_time: string;
  reminder_sent_at: string | null;
}

// האם צריך לשלוח עכשיו תזכורת על הצילום הזה ללקוחה:
// - טרם נשלחה תזכורת (reminder_sent_at null - זה מה שהופך את ה-cron ל-idempotent)
// - התזכורת מופעלת (reminderDays > 0; 0 = הצלמת כיבתה תזכורות אוטומטיות)
// - הצילום עוד לא התחיל (אין טעם להזכיר על צילום שכבר קרה)
// - נשארו reminderDays ימים לוחיים או פחות (בזמן ישראל) - השוואה לוחנית ולא
//   הפרש מדויק בשעות, אותה סיבה כמו בתזכורות התפוגה ב-cron: התוצאה לא תלויה
//   בשעה שבה ה-cron היומי רץ בפועל.
export function isShootReminderDue(shoot: ShootTiming, reminderDays: number, now: Date): boolean {
  if (shoot.reminder_sent_at) return false;
  if (!(reminderDays > 0)) return false;

  const startsAt = new Date(israelLocalToUtcIso(shoot.shoot_date, shoot.start_time));
  if (startsAt.getTime() <= now.getTime()) return false;

  const daysUntil = daysBetweenDateStrings(israelDateString(now), shoot.shoot_date);
  return daysUntil <= reminderDays;
}

// ערך ימי התזכורת בפועל לצלמת - null/undefined (עמודה שעוד לא קיימת/ריקה)
// נופל לברירת המחדל, וערכים מחוץ לטווח נחתכים.
export function resolveShootReminderDays(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return DEFAULT_SHOOT_REMINDER_DAYS;
  return Math.max(0, Math.min(MAX_SHOOT_REMINDER_DAYS, Math.floor(value)));
}

export function selectShootsNeedingReminder<T extends ShootTiming>(
  shoots: T[],
  getReminderDays: (shoot: T) => number | null | undefined,
  now: Date
): T[] {
  return shoots.filter((shoot) => isShootReminderDue(shoot, resolveShootReminderDays(getReminderDays(shoot)), now));
}

// התאריך של "מחר" בישראל, עבור רגע נתון.
export function israelTomorrowDateString(now: Date): string {
  return addDaysToDateString(israelDateString(now), 1);
}

// האם לשלוח היום לצלמת את סיכום הצילומים של מחר - idempotent ליום: אם
// shoot_summary_sent_on כבר שווה לתאריך של היום בישראל, לא שולחים שוב גם אם
// ה-cron רץ כמה פעמים באותו יום.
export function shouldSendDailySummary(enabled: boolean | null | undefined, lastSentOn: string | null | undefined, now: Date): boolean {
  if (enabled === false) return false;
  return lastSentOn !== israelDateString(now);
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
}

// העמודות שהדשבורד מקבל עבור כל צילום (app/api/shoots/*).
export const SHOOT_SELECT =
  'id, shoot_date, start_time, location, notes, client_id, gallery_id, confirmation_sent_at, reminder_sent_at, created_at, clients(full_name, email)';

export const SHOOT_LOCATION_MAX_LENGTH = 200;
export const SHOOT_NOTES_MAX_LENGTH = 2000;

export interface ShootFields {
  shoot_date: string;
  start_time: string;
  location: string;
  notes: string | null;
}

// אימות שדות הצילום מגוף בקשה (app/api/shoots, יצירה ועריכה) - מחזיר את
// הערכים המנורמלים לכתיבה ל-DB, או הודעת שגיאה בעברית להצגה לצלמת.
export function validateShootFields(input: {
  shootDate?: unknown;
  startTime?: unknown;
  location?: unknown;
  notes?: unknown;
}): { ok: true; value: ShootFields } | { ok: false; error: string } {
  if (!isValidDateString(input.shootDate)) return { ok: false, error: 'תאריך הצילום לא תקין' };
  if (!isValidTimeString(input.startTime)) return { ok: false, error: 'שעת הצילום לא תקינה' };

  const location = typeof input.location === 'string' ? input.location.trim() : '';
  if (!location) return { ok: false, error: 'חסר מיקום לצילום' };
  if (location.length > SHOOT_LOCATION_MAX_LENGTH) {
    return { ok: false, error: `המיקום ארוך מדי (מקסימום ${SHOOT_LOCATION_MAX_LENGTH} תווים)` };
  }

  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (notes.length > SHOOT_NOTES_MAX_LENGTH) {
    return { ok: false, error: `ההערות ארוכות מדי (מקסימום ${SHOOT_NOTES_MAX_LENGTH} תווים)` };
  }

  return {
    ok: true,
    value: { shoot_date: input.shootDate, start_time: formatShootTime(input.startTime), location, notes: notes || null },
  };
}

// "14:30:00" (כפי ש-Postgres מחזיר time) -> "14:30"
export function formatShootTime(time: string): string {
  return time.slice(0, 5);
}

const HEBREW_WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// יום בשבוע (0 = ראשון) של תאריך לוחני - צהריים UTC כדי שאזור הזמן של
// השרת/הדפדפן לא יזיז את היום.
export function weekdayOfDateString(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

// "יום ראשון, 12.10.2026" - לתצוגה במיילים ובדשבורד.
export function formatShootDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `יום ${HEBREW_WEEKDAYS[weekdayOfDateString(dateStr)]}, ${Number(d)}.${Number(m)}.${y}`;
}

export function daysUntilLabel(days: number): string {
  if (days <= 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === 2) return 'מחרתיים';
  return `בעוד ${days} ימים`;
}

// רשת חודשית לתצוגת לוח שנה: מערך שבועות, כל שבוע 7 תאים (ראשון עד שבת,
// כמקובל בישראל), תא ריק = null (ימים מהחודש הקודם/הבא). month הוא 1-12.
export function buildMonthGrid(year: number, month: number): (string | null)[][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array(weekdayOfDateString(first)).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// טווח התאריכים (כולל) של חודש - לשליפת הצילומים של תצוגת החודש.
export function monthRange(year: number, month: number): { from: string; to: string } {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}` };
}

// מיון כרונולוגי לפי תאריך ואז שעה (מחרוזות ISO ממוינות לקסיקוגרפית נכון).
export function compareShoots(a: { shoot_date: string; start_time: string }, b: { shoot_date: string; start_time: string }): number {
  if (a.shoot_date !== b.shoot_date) return a.shoot_date < b.shoot_date ? -1 : 1;
  const at = formatShootTime(a.start_time);
  const bt = formatShootTime(b.start_time);
  return at === bt ? 0 : at < bt ? -1 : 1;
}
