// עזרי אזור-זמן ישראל (Asia/Jerusalem) בלי ספריית טיימזון חיצונית (ראו
// lib/hebrewDate.ts לאותה גישה) - Intl.DateTimeFormat עם timeZone כבר יודע
// את ההיסט בפועל לכל תאריך נתון, כולל המעבר בין שעון קיץ (+3) לשעון חורף
// (+2), בלי שנצטרך לשמור בעצמנו טבלת תאריכי מעבר.

// היסט ה-UTC (בשעות, +2 או +3) שישראל נמצאת בו בפועל בתאריך היעד. משתמשים
// בצהריים UTC של אותו תאריך כ"בדיקה" כדי להיות בטוחים שבודקים את היום
// האזרחי הנכון בישראל (מעברי שעון קורים לפנות בוקר, רחוק מצהריים).
function israelUtcOffsetHours(dateStr: string): number {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    timeZoneName: 'shortOffset',
  }).formatToParts(probe);
  const label = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+3';
  const match = label.match(/GMT([+-]\d+)/);
  return match ? Number(match[1]) : 3;
}

// סוף היום (23:59:59) בזמן ישראל האמיתי עבור תאריך "YYYY-MM-DD" (כפי שמגיע
// מ-<input type="date">), כ-ISO string ב-UTC - במקום היסט קבוע (+03:00) שמניח
// שעון קיץ כל השנה ומקצר את התוקף בשעה אחת בחצי מהשנה (שעון חורף, +02:00).
export function israelEndOfDayIso(dateStr: string): string {
  const offset = israelUtcOffsetHours(dateStr);
  const sign = offset < 0 ? '-' : '+';
  const hours = String(Math.abs(offset)).padStart(2, '0');
  return new Date(`${dateStr}T23:59:59${sign}${hours}:00`).toISOString();
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
// israelEndOfDayIso למעלה: ההיסט נלקח לפי התאריך עצמו, כך ששעון קיץ/חורף
// מטופל אוטומטית. משמש את lib/shoots.ts כדי לדעת אם צילום כבר התחיל.
export function israelLocalToUtcIso(dateStr: string, timeStr: string): string {
  const offset = israelUtcOffsetHours(dateStr);
  const sign = offset < 0 ? '-' : '+';
  const offsetHours = String(Math.abs(offset)).padStart(2, '0');
  const [hh = '00', mm = '00', ss = '00'] = timeStr.split(':');
  const time = `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.slice(0, 2).padStart(2, '0')}`;
  return new Date(`${dateStr}T${time}${sign}${offsetHours}:00`).toISOString();
}

// הוספת ימים לתאריך "YYYY-MM-DD" - חישוב לוחני טהור (חצות UTC כעזר בלבד,
// כמו daysBetweenDateStrings), בלי תלות באזור הזמן של השרת.
export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
