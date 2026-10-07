// בחירה במייל (משימה 21): תמונות התצוגה נשלחות ללקוחה כקבצים מצורפים רגילים
// לג'ימייל. לפי נטפרי, תמונות מצורפות בג'ימייל הן "תוכן אישי" ונפתחות בלי
// סינון בברירת מחדל - בניגוד לגלריה באתר, שבה כל תמונה נשלחת לבדיקה (ותמונות
// של נשים לא מאושרות). ראו https://netfree.link/wiki/סינון_תוכן_אישי_ופרטי_בנטפרי
//
// ג'ימייל מקבל עד 25MB למייל, כולל קידוד base64 (~33% תוספת), אז כל מייל
// מוגבל ל-17MB של קבצים גולמיים ול-40 תמונות.

export const EMAIL_MAX_PHOTOS = 40;
export const EMAIL_MAX_RAW_BYTES = 17 * 1024 * 1024;
// חלק אחד = בקשה אחת לשרת (הורדה + הקטנה + שליחה), כדי לא לעבור את מגבלת
// הזמן של Vercel. חלק יכול לצאת ביותר ממייל אחד אם התמונות כבדות במיוחד.
export const EMAIL_PART_SIZE = EMAIL_MAX_PHOTOS;
export const TEST_EMAIL_PHOTOS = 6;

export type EmailPart = { index: number; from: number; to: number };

// חלוקה לחלקים לפי מספרי התמונות (1..total), כפי שהלקוחה רואה אותם בגלריה.
export function planEmailParts(total: number, partSize = EMAIL_PART_SIZE): EmailPart[] {
  const parts: EmailPart[] = [];
  for (let from = 1, index = 0; from <= total; from += partSize, index++) {
    parts.push({ index, from, to: Math.min(total, from + partSize - 1) });
  }
  return parts;
}

// חלוקה חמדנית של תמונות (כבר מוקטנות) למיילים, לפי גודל ומספר.
export function packBySize<T extends { bytes: number }>(
  items: T[],
  maxBytes = EMAIL_MAX_RAW_BYTES,
  maxCount = EMAIL_MAX_PHOTOS
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    if (current.length > 0 && (size + item.bytes > maxBytes || current.length >= maxCount)) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.bytes;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// שם קובץ = מספר התמונה, מרופד לפי גודל הגלריה (001.jpg ... 156.jpg), כדי
// שהלקוחה תראה מיד איזה מספר לכתוב בתשובה, וג'ימייל ימיין אותם נכון.
export function photoFilename(number: number, total: number): string {
  const width = Math.max(3, String(total).length);
  return `${String(number).padStart(width, '0')}.jpg`;
}
