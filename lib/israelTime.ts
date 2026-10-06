// עזרי אזור-זמן ישראל (Asia/Jerusalem) בלי ספריית טיימזון חיצונית (ראו
// lib/hebrewDate.ts לאותה גישה) - Intl.DateTimeFormat עם timeZone כבר יודע
// את ההיסט בפועל לכל תאריך נתון, כולל המעבר בין שעון קיץ (+3) לשעון חורף
// (+2), בלי שנצטרך לשמור בעצמנו טבלת תאריכי מעבר.

// היסט ה-UTC (בשעות, +2 או +3) שישראל נמצאת בו בפועל ברגע נתון.
function israelUtcOffsetAt(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    timeZoneName: 'shortOffset',
  }).formatToParts(instant);
  const label = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+3';
  const match = label.match(/GMT([+-]\d+)/);
  return match ? Number(match[1]) : 3;
}

// רגע UTC של תאריך+שעה מקומיים בישראל. ההיסט נבדק לשעה המקומית עצמה (לא
// לצהריים): ניחוש ראשון לפי ההיסט בצהריים, ואז בדיקה חוזרת ברגע שיצא - כך
// שביום המעבר (המעבר קורה לפנות בוקר) שעה שלפני המעבר מקבלת את ההיסט הישן.
function israelLocalToDate(dateStr: string, time: string): Date {
  const asUtcMs = Date.parse(`${dateStr}T${time}Z`);
  const noonOffset = israelUtcOffsetAt(new Date(`${dateStr}T12:00:00Z`));
  const guess = new Date(asUtcMs - noonOffset * 3600 * 1000);
  const actualOffset = israelUtcOffsetAt(guess);
  return actualOffset === noonOffset ? guess : new Date(asUtcMs - actualOffset * 3600 * 1000);
}

// סוף היום (23:59:59) בזמן ישראל האמיתי עבור תאריך "YYYY-MM-DD" (כפי שמגיע
// מ-<input type="date">), כ-ISO string ב-UTC - במקום היסט קבוע (+03:00) שמניח
// שעון קיץ כל השנה ומקצר את התוקף בשעה אחת בחצי מהשנה (שעון חורף, +02:00).
export function israelEndOfDayIso(dateStr: string): string {
  return israelLocalToDate(dateStr, '23:59:59').toISOString();
}

// תאריך "YYYY-MM-DD" לפי הלוח האזרחי בישראל, עבור רגע נתון - לשימוש בהשוואות
// "כמה ימים נשארו עד..." בלי תלות בשעה שבה תהליך רקע (כמו ה-cron) רץ בפועל.
export function israelDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(date);
}

// הפרש בימים שלמים בין שני תאריכי "YYYY-MM-DD" (b פחות a) - חישוב לוחני טהור.
// הפירוש כ-UTC חצות כאן הוא רק כלי עזר לחישוב ההפרש (שני הצדדים מחושבים
// באותו אופן), לא קשור לאזור הזמן שממנו הגיעו התאריכים עצמם.
export function daysBetweenDateStrings(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / msPerDay);
}

// רגע מדויק (ISO ב-UTC) של תאריך+שעה מקומיים בישראל - "YYYY-MM-DD" + "HH:MM"
// (או "HH:MM:SS", כפי ש-Postgres מחזיר עמודת time). אותה גישה בדיוק כמו
// israelEndOfDayIso למעלה: ההיסט נלקח לפי השעה המקומית עצמה, כך ששעון קיץ/חורף
// מטופל אוטומטית. משמש את lib/shoots.ts כדי לדעת אם צילום כבר התחיל.
export function israelLocalToUtcIso(dateStr: string, timeStr: string): string {
  const [hh = '00', mm = '00', ss = '00'] = timeStr.split(':');
  const time = `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.slice(0, 2).padStart(2, '0')}`;
  return israelLocalToDate(dateStr, time).toISOString();
}

// הוספת ימים לתאריך "YYYY-MM-DD" - חישוב לוחני טהור (חצות UTC כעזר בלבד,
// כמו daysBetweenDateStrings), בלי תלות באזור הזמן של השרת.
export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// תאריך לתצוגה בעברית (למשל "5.10.2026") לפי הלוח בישראל - toLocaleDateString
// בלי timeZone משתמש באזור הזמן של השרת (UTC ב-Vercel), כך שגלריה שנוצרה
// בישראל אחרי חצות (21:00-24:00 UTC) הייתה מוצגת עם התאריך של יום קודם.
export function formatIsraelDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
}
