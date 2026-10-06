// המרה לתאריך עברי מלא (עם גימטריה, למשל "כ״ו באלול תשפ״ו") להצגה ללקוחה -
// בכוונה לא כתובים בקוד רגיל, במקום תאריך לועזי. Intl עם ('he-IL-u-ca-hebrew')
// כבר נותן לנו את שם החודש העברי ואת המספרים (יום/שנה) בלוח השנה העברי, אבל
// לא ממיר אותם לאותיות גימטריה בעצמו (בדקנו: numberingSystem: 'hebr' לא עובד
// על Intl.DateTimeFormat) - לכן ההמרה למספרים עבריים כתובה כאן ידנית.
export function numberToHebrewLetters(num: number): string {
  const values: [number, string][] = [
    [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'],
    [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'],
    [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א'],
  ];

  let n = num;
  let letters = '';

  // מאות קודם, כדי ש-715 ייכתב תשט״ו ולא טות״ש.
  for (const [value, letter] of values) {
    if (value < 100) break;
    while (n >= value) {
      letters += letter;
      n -= value;
    }
  }

  // 15/16 נכתבים ט״ו/ט״ז ולא י״ה/י״ו, כדי לא לאיית את שם ה'.
  if (n === 15) {
    letters += 'טו';
    n = 0;
  } else if (n === 16) {
    letters += 'טז';
    n = 0;
  }

  for (const [value, letter] of values) {
    if (value >= 100) continue;
    while (n >= value) {
      letters += letter;
      n -= value;
    }
  }

  if (letters.length <= 1) return letters + '׳';
  return letters.slice(0, -1) + '״' + letters.slice(-1);
}

// היום האזרחי נקבע תמיד לפי שעון ישראל (Asia/Jerusalem) - לא לפי אזור הזמן של
// השרת (UTC ב-Vercel): רגע כמו 22:30 UTC הוא כבר היום הבא בישראל, ובלי זה
// מייל שנשלח מה-cron היה מציג תאריך של יום קודם.
export function toHebrewDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).formatToParts(date);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = Number(parts.find((p) => p.type === 'year')?.value);

  return `${numberToHebrewLetters(day)} ב${month} ${numberToHebrewLetters(year % 1000)}`;
}

// ---------- רכיבי תאריך עברי כמספרים (לחישובי חגים/תאריכים חוזרים) ----------

// מספור חודשים קבוע שלא תלוי בשנה מעוברת: 1 = תשרי ... 13 = אלול, כאשר
// 6 = אדר א׳ (קיים רק בשנה מעוברת) ו-7 = אדר (בשנה רגילה) / אדר ב׳ (במעוברת).
// כך "ניסן" הוא תמיד 8, בניגוד למספור של Intl/ICU שזז לפי השנה.
export const HEBREW_MONTH_NAMES_HE: Record<number, string> = {
  1: 'תשרי',
  2: 'חשון',
  3: 'כסלו',
  4: 'טבת',
  5: 'שבט',
  6: 'אדר א׳',
  7: 'אדר',
  8: 'ניסן',
  9: 'אייר',
  10: 'סיון',
  11: 'תמוז',
  12: 'אב',
  13: 'אלול',
};

// שמות החודשים כפי ש-Intl מחזיר ב-'en-u-ca-hebrew' (בדקנו בפועל ב-Node/ICU)
const INTL_MONTH_TO_NUMBER: Record<string, number> = {
  Tishri: 1,
  Heshvan: 2,
  Kislev: 3,
  Tevet: 4,
  Shevat: 5,
  'Adar I': 6,
  Adar: 7,
  'Adar II': 7,
  Nisan: 8,
  Iyar: 9,
  Sivan: 10,
  Tamuz: 11,
  Av: 12,
  Elul: 13,
};

export interface HebrewDateParts {
  day: number;
  month: number; // ראו HEBREW_MONTH_NAMES_HE
  year: number;
  // שנה מעוברת (יש בה אדר א׳ ואדר ב׳)
  isLeapYear: boolean;
}

// cache ברמת המודול - ריצת cron/חישוב "המופע הבא" ממירים את אותם ימים שוב ושוב
const partsCache = new Map<string, HebrewDateParts | null>();

// התאריך העברי של יום אזרחי "YYYY-MM-DD" (היום עצמו, לא הערב שלפניו - כלומר
// בלי להתחשב בכך שהיום העברי מתחיל בשקיעה). צהריים UTC + timeZone UTC כדי
// שאזור הזמן של השרת לא יזיז את היום. null = מחרוזת לא תקינה.
export function hebrewDateParts(dateStr: string): HebrewDateParts | null {
  if (partsCache.has(dateStr)) return partsCache.get(dateStr) ?? null;
  let result: HebrewDateParts | null = null;
  const probe = new Date(`${dateStr}T12:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(probe.getTime())) {
    const parts = new Intl.DateTimeFormat('en-u-ca-hebrew', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).formatToParts(probe);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const monthName = parts.find((p) => p.type === 'month')?.value ?? '';
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = INTL_MONTH_TO_NUMBER[monthName];
    if (month && Number.isFinite(day) && Number.isFinite(year)) {
      result = { day, month, year, isLeapYear: isHebrewLeapYear(year) };
    }
  }
  if (partsCache.size > 5000) partsCache.clear();
  partsCache.set(dateStr, result);
  return result;
}

// מחזור 19 השנים: שנים 3, 6, 8, 11, 14, 17, 19 במחזור מעוברות
export function isHebrewLeapYear(year: number): boolean {
  return (7 * year + 1) % 19 < 7;
}
