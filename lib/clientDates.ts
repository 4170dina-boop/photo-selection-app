import { hebrewDateParts, numberToHebrewLetters, HEBREW_MONTH_NAMES_HE } from '@/lib/hebrewDate';
import { addDaysToDateString } from '@/lib/israelTime';

// תאריכים חשובים של לקוחות (טבלת client_dates): יום הולדת, יום נישואין וכו' -
// לועזי או עברי, חוזר כל שנה. הצלמת מקבלת בסיכום היומי (app/api/cron/tick)
// תזכורת 30 יום לפני, עם הצעה לברכה. לוגיקה טהורה - גם לדפדפן וגם ל-vitest.

export const CLIENT_DATE_LABEL_MAX_LENGTH = 80;
export const CLIENT_DATE_REMINDER_DAYS = 30;
// כמה ימים קדימה מחפשים "מופע הבא" - שנה עברית מעוברת היא עד 385 יום
const MAX_SEARCH_DAYS = 400;

export interface ClientDateRule {
  date_greg: string | null; // "YYYY-MM-DD" - לועזי, חוזר כל שנה באותו יום וחודש
  hebrew_month: number | null; // 1-13, ראו HEBREW_MONTH_NAMES_HE ב-lib/hebrewDate.ts
  hebrew_day: number | null; // 1-30
}

export interface ClientDateRow extends ClientDateRule {
  id: string;
  client_id: string;
  label: string;
  created_at?: string | null;
}

function isValidGregorian(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// אימות קלט מהטופס בדף הלקוחות: תווית + בדיוק אחד מהשניים (לועזי / עברי).
export function parseClientDateInput(input: {
  label?: unknown;
  dateGreg?: unknown;
  hebrewMonth?: unknown;
  hebrewDay?: unknown;
}): { ok: true; value: { label: string } & ClientDateRule } | { ok: false; error: string } {
  const label = typeof input.label === 'string' ? input.label.trim().replace(/\s+/g, ' ') : '';
  if (!label) return { ok: false, error: 'צריך לכתוב מה התאריך (למשל "יום ההולדת של יוסי")' };
  if (label.length > CLIENT_DATE_LABEL_MAX_LENGTH) {
    return { ok: false, error: `התיאור ארוך מדי (עד ${CLIENT_DATE_LABEL_MAX_LENGTH} תווים)` };
  }

  const dateGreg = typeof input.dateGreg === 'string' ? input.dateGreg.trim() : '';
  const hasHebrew = input.hebrewMonth != null && input.hebrewMonth !== '' && input.hebrewDay != null && input.hebrewDay !== '';
  if (dateGreg && hasHebrew) return { ok: false, error: 'בוחרים תאריך לועזי או עברי - לא את שניהם' };

  if (dateGreg) {
    if (!isValidGregorian(dateGreg)) return { ok: false, error: 'התאריך הלועזי לא תקין' };
    return { ok: true, value: { label, date_greg: dateGreg, hebrew_month: null, hebrew_day: null } };
  }
  if (hasHebrew) {
    const month = Number(input.hebrewMonth);
    const day = Number(input.hebrewDay);
    if (!Number.isInteger(month) || month < 1 || month > 13) return { ok: false, error: 'החודש העברי לא תקין' };
    if (!Number.isInteger(day) || day < 1 || day > 30) return { ok: false, error: 'היום בחודש העברי צריך להיות בין 1 ל-30' };
    return { ok: true, value: { label, date_greg: null, hebrew_month: month, hebrew_day: day } };
  }
  return { ok: false, error: 'צריך לבחור תאריך (לועזי או עברי)' };
}

function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// האם התאריך החוזר "חל" ביום האזרחי dateStr.
// לועזי: אותו יום וחודש; 29 בפברואר חל ב-28 בפברואר בשנה לא מעוברת.
// עברי: אדר א׳ (6) בשנה רגילה = אדר; אדר (7) בשנה מעוברת = אדר ב׳ (המנהג
// הנפוץ לימי הולדת). ל׳ בחודש שאין בו ל׳ באותה שנה (חשון/כסלו/אדר א׳) חל בכ״ט.
export function isClientDateOn(rule: ClientDateRule, dateStr: string): boolean {
  if (rule.date_greg) {
    const ruleMd = rule.date_greg.slice(5);
    const targetMd = dateStr.slice(5);
    if (ruleMd === targetMd) return true;
    if (ruleMd === '02-29' && targetMd === '02-28') return !isGregorianLeapYear(Number(dateStr.slice(0, 4)));
    return false;
  }
  if (rule.hebrew_month == null || rule.hebrew_day == null) return false;
  const parts = hebrewDateParts(dateStr);
  if (!parts) return false;
  const month = rule.hebrew_month === 6 && !parts.isLeapYear ? 7 : rule.hebrew_month;
  if (parts.month !== month) return false;
  if (parts.day === rule.hebrew_day) return true;
  if (rule.hebrew_day === 30 && parts.day === 29) {
    // אין ל׳ בחודש הזה השנה - מחר כבר החודש הבא
    const tomorrow = hebrewDateParts(addDaysToDateString(dateStr, 1));
    return !!tomorrow && tomorrow.month !== parts.month;
  }
  return false;
}

// המופע הבא (כולל היום עצמו) כ-"YYYY-MM-DD". null = כלל לא תקין.
export function nextClientDateOccurrence(rule: ClientDateRule, fromDateStr: string): string | null {
  let d = fromDateStr;
  for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
    if (isClientDateOn(rule, d)) return d;
    d = addDaysToDateString(d, 1);
  }
  return null;
}

// התאריכים שחלים בדיוק בעוד daysAhead ימים - לסיכום היומי לצלמת.
export function clientDatesDueIn<T extends ClientDateRule>(rows: T[], todayStr: string, daysAhead = CLIENT_DATE_REMINDER_DAYS): T[] {
  const target = addDaysToDateString(todayStr, daysAhead);
  return rows.filter((row) => isClientDateOn(row, target));
}

// "ט״ו בשבט (עברי)" / "12.3 (לועזי)" - לתצוגה ברשימה בדף הלקוחות.
export function describeClientDateRule(rule: ClientDateRule): string {
  if (rule.date_greg) {
    const [, m, d] = rule.date_greg.split('-');
    return `${Number(d)}.${Number(m)} (לועזי, כל שנה)`;
  }
  if (rule.hebrew_month != null && rule.hebrew_day != null) {
    const month = HEBREW_MONTH_NAMES_HE[rule.hebrew_month] ?? '';
    return `${numberToHebrewLetters(rule.hebrew_day)} ב${month} (עברי, כל שנה)`;
  }
  return '';
}

// שם המשפחה מתוך השם המלא ("יוסי כהן" -> "משפחת כהן"); שם של מילה אחת - כמו שהוא.
export function familyLabel(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return fullName.trim();
  return `משפחת ${words[words.length - 1]}`;
}

// הצעה לברכה (לצלמת - בלשון נקבה) לפי סוג התאריך.
export function greetingSuggestion(label: string): string {
  if (/הולדת/.test(label)) return 'אולי לשלוח ברכת יום הולדת קטנה - ולהציע צילום לכבוד היום 🎂';
  if (/נישואי|חתונה/.test(label)) return 'אולי לשלוח ברכה ליום הנישואין - ולהציע צילום זוגי לכבוד השנה החדשה 💍';
  if (/בר מצו|בת מצו|בר-מצו|בת-מצו/.test(label)) return 'זה הזמן להציע צילום לכבוד המצווה ✨';
  return 'אולי לשלוח ברכה קצרה ואישית - לקוחות זוכרות מי זכרה אותן 💛';
}
