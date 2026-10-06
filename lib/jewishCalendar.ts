import { hebrewDateParts } from '@/lib/hebrewDate';
import { addDaysToDateString, israelDateString, israelEndOfDayIso } from '@/lib/israelTime';

// שבת וימים טובים בישראל - לוגיקה טהורה (בלי DB), לשימוש ה-cron היומי
// (app/api/cron/tick/route.ts): מיילים אוטומטיים ללקוחות לא יוצאים בשבת/חג
// (photographers.respect_shabbat), ותפוגת גלריה שנופלת בשבת/חג נדחית לסוף
// יום החול הבא.
//
// הכל לפי התאריך האזרחי בישראל ("YYYY-MM-DD"), בלי שקיעה: ה-cron רץ ב-08:00 UTC
// (10:00/11:00 בישראל), כך ש"היום" תמיד באמצע היום - אין צורך בזמני כניסה/יציאה.

// ימים טובים בישראל (יום אחד, לא יום טוב שני של גלויות): ראש השנה (א׳-ב׳ תשרי),
// יום כיפור (י׳ תשרי), סוכות (ט״ו תשרי), שמיני עצרת/שמחת תורה (כ״ב תשרי),
// פסח ראשון ושביעי (ט״ו וכ״א ניסן), שבועות (ו׳ סיון). חודשים לפי
// HEBREW_MONTH_NAMES_HE ב-lib/hebrewDate.ts (8 = ניסן, 10 = סיון).
const ISRAEL_YOM_TOV: { month: number; day: number }[] = [
  { month: 1, day: 1 },
  { month: 1, day: 2 },
  { month: 1, day: 10 },
  { month: 1, day: 15 },
  { month: 1, day: 22 },
  { month: 8, day: 15 },
  { month: 8, day: 21 },
  { month: 10, day: 6 },
];

export function isShabbat(dateStr: string): boolean {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 6;
}

export function isYomTovIsrael(dateStr: string): boolean {
  const parts = hebrewDateParts(dateStr);
  if (!parts) return false;
  return ISRAEL_YOM_TOV.some((yt) => yt.month === parts.month && yt.day === parts.day);
}

export function isShabbatOrYomTovIsrael(dateStr: string): boolean {
  return isShabbat(dateStr) || isYomTovIsrael(dateStr);
}

// יום החול הראשון החל מ-dateStr (כולל). רצף ארוך ביותר אפשרי הוא 3 ימים (ראש
// השנה ביום ה׳-ו׳ + שבת), התקרה רק רשת ביטחון.
export function nextWeekdayIsrael(dateStr: string): string {
  let d = dateStr;
  for (let i = 0; i < 10 && isShabbatOrYomTovIsrael(d); i++) d = addDaysToDateString(d, 1);
  return d;
}

// האם מותר היום לשלוח מיילים אוטומטיים ללקוחות של צלמת. respectShabbat
// חסר (עמודה שעוד לא נוספה) = true, ברירת המחדל של photographers.respect_shabbat.
export function canSendClientEmailsToday(now: Date, respectShabbat: boolean | null | undefined): boolean {
  if (respectShabbat === false) return true;
  return !isShabbatOrYomTovIsrael(israelDateString(now));
}

// תפוגה "אפקטיבית": אם expires_at נופל (לפי התאריך בישראל) בשבת/חג, התוקף
// נמשך עד סוף יום החול הבא (23:59:59 בישראל) - כדי שלקוחה ששומרת שבת לא תאבד
// את היום האחרון לבחירה. אחרת - בדיוק expires_at. null = ערך לא תקין.
export function effectiveExpiryIso(expiresAt: string, respectShabbat: boolean | null | undefined = true): string | null {
  const t = new Date(expiresAt);
  if (Number.isNaN(t.getTime())) return null;
  if (respectShabbat === false) return t.toISOString();
  const day = israelDateString(t);
  if (!isShabbatOrYomTovIsrael(day)) return t.toISOString();
  return israelEndOfDayIso(nextWeekdayIsrael(day));
}
