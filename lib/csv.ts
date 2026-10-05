// עזרי CSV משותפים לכל הייצואים בצד הצלמת (selections-export, lightroom-export,
// export-contacts) - מקום אחד לבריחת שדות, הגנה מפני הזרקת נוסחאות ב-Excel
// וכותרת Content-Disposition עם שם קובץ בעברית.

// תווים שבתחילת תא גורמים ל-Excel/Sheets לפרש אותו כנוסחה (CSV/formula injection) -
// שם לקוחה כמו "=HYPERLINK(...)" או שם קובץ שמתחיל ב-"+" לא אמור לרוץ כנוסחה
// אצל הצלמת. מקדימים גרש (') - הקונבנציה המקובלת (OWASP) לסימון "טקסט בלבד".
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

// אילו תווים מחייבים עטיפה במירכאות - כולל CR לבד (\r), שבלי מירכאות שובר שורה
// ב-Excel בדיוק כמו \n.
const NEEDS_QUOTING = /[",\r\n]/;

export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  // מספרים שאנחנו עצמנו מייצרים (דירוג וכו') - לא קלט משתמש, אין מה להגן עליהם
  if (typeof value === 'number') return String(value);
  let s = value;
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
  if (NEEDS_QUOTING.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(fields: Array<string | number | null | undefined>): string {
  return fields.map(escapeCsvField).join(',');
}

// BOM כדי ש-Excel יזהה UTF-8 נכון (בלי זה עברית מוצגת כג'יבריש בפתיחה ישירה),
// ו-CRLF בין שורות כמו ש-RFC 4180 מגדיר.
export function buildCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return '\uFEFF' + [csvRow(header), ...rows.map(csvRow)].join('\r\n');
}

// קידוד RFC 5987 ל-filename*: encodeURIComponent משאיר ' ( ) * ! לא מקודדים,
// אבל ' הוא המפריד של charset''value ו-( ) * אינם attr-char חוקיים.
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// שם ASCII "בטוח" לפרמטר filename= הרגיל (לדפדפנים ישנים שלא מבינים filename*) -
// בלי מירכאות, backslash או תווי בקרה שישברו את הכותרת.
function sanitizeAsciiFallback(value: string): string {
  const cleaned = value.replace(/[^\x20-\x7e]|["\\]/g, '_').trim();
  return cleaned || 'download';
}

// Content-Disposition עם שם בעברית: filename= רגיל מקבל fallback ב-ASCII (percent
// escapes בתוכו לא מפוענחים ע"י רוב הדפדפנים ונשמרים כ-"%D7%93..." בשם הקובץ),
// ו-filename* (RFC 6266/5987) נושא את השם האמיתי ב-UTF-8.
export function attachmentContentDisposition(filename: string, asciiFallback: string): string {
  return `attachment; filename="${sanitizeAsciiFallback(asciiFallback)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
