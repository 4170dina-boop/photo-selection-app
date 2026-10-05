// קריאת שעת הצילום (EXIF DateTimeOriginal) מקובץ JPEG - בלי ספרייה חיצונית.
//
// למה בדפדפן ולא רק בשרת: ההקטנה ל-3000px לפני ההעלאה (lib/uploadResize.ts)
// מציירת לקנבס, והקובץ שיוצא כבר בלי EXIF - כך שבצד שרת שעת הצילום כבר לא
// קיימת ברוב ההעלאות. לכן app/dashboard/UploadProvider.tsx קורא את תחילת
// הקובץ המקורי, ושולח את התוצאה ברישום התמונה (app/api/galleries/[id]/photos).
// עיבוד בצד שרת (process) קורא גם הוא - לקבצים שעלו ברזולוציה מלאה / בלי הקטנה.
//
// המצלמה שומרת "שעון קיר" בלי אזור זמן. שומרים אותו כאילו הוא UTC
// ("2024:06:01 18:30:05" -> "2024-06-01T18:30:05.000Z") - מה שחשוב לנו הוא
// רק ההפרש בין תמונות (חלוקה לפרקים, רצפים של תמונות דומות), לא השעה המוחלטת.
//
// פונקציות טהורות, בלי Buffer של Node - עובדות גם בדפדפן.

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATETIME = 0x0132; // IFD0 - שעת שינוי הקובץ, גיבוי אחרון בלבד
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_SUBSEC_ORIGINAL = 0x9291;
const TYPE_ASCII = 2;

// כמה בייטים מתחילת הקובץ מספיקים כמעט תמיד ל-APP1 (EXIF מוגבל ל-64KB, אבל
// לפעמים יש לפניו APP0/JFIF וכו').
export const EXIF_SCAN_BYTES = 256 * 1024;

// "YYYY:MM:DD HH:MM:SS" (+ שברי שנייה אופציונליים מ-SubSecTimeOriginal) -> ISO, או null
// לערך לא תקין (מצלמות בלי שעון שמור כותבות "0000:00:00 00:00:00").
export function parseExifDateTime(value: string | null | undefined, subSec?: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  if (year < 1971 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const digits = (subSec ?? '').trim().replace(/\D.*$/, '');
  const ms = digits ? Math.round(Number(`0.${digits}`) * 1000) % 1000 : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  // 31 בפברואר וכו' - Date "מגלגל" לחודש הבא
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

interface TiffReader {
  u16(offset: number): number;
  u32(offset: number): number;
  length: number;
}

function tiffReader(bytes: Uint8Array, start: number): TiffReader | null {
  if (start + 8 > bytes.length) return null;
  const order = String.fromCharCode(bytes[start], bytes[start + 1]);
  const little = order === 'II';
  if (!little && order !== 'MM') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.length - start);
  const reader: TiffReader = {
    u16: (o) => view.getUint16(o, little),
    u32: (o) => view.getUint32(o, little),
    length: view.byteLength,
  };
  if (reader.u16(2) !== 42) return null;
  return reader;
}

// קורא IFD אחד ומחזיר את ערכי ה-ASCII של התגים המבוקשים + מצביע ל-Exif IFD.
function readIfd(
  r: TiffReader,
  bytes: Uint8Array,
  start: number,
  ifdOffset: number,
  wanted: number[]
): { ascii: Map<number, string>; exifPointer: number | null } {
  const ascii = new Map<number, string>();
  let exifPointer: number | null = null;
  if (ifdOffset + 2 > r.length) return { ascii, exifPointer };
  const count = r.u16(ifdOffset);
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > r.length) break;
    const tag = r.u16(entry);
    const type = r.u16(entry + 2);
    const n = r.u32(entry + 4);
    if (tag === TAG_EXIF_IFD_POINTER) {
      exifPointer = r.u32(entry + 8);
      continue;
    }
    if (!wanted.includes(tag) || type !== TYPE_ASCII || n === 0 || n > 64) continue;
    // עד 4 בייטים - הערך עצמו בתוך הרשומה; אחרת - offset אליו
    const valueOffset = n <= 4 ? entry + 8 : r.u32(entry + 8);
    if (valueOffset + n > r.length) continue;
    let text = '';
    for (let k = 0; k < n; k++) {
      const c = bytes[start + valueOffset + k];
      if (c === 0) break;
      text += String.fromCharCode(c);
    }
    ascii.set(tag, text);
  }
  return { ascii, exifPointer };
}

// בלוק TIFF (מה שבא אחרי "Exif\0\0") -> שעת צילום ISO, או null.
export function takenAtFromTiff(bytes: Uint8Array, start = 0): string | null {
  try {
    const r = tiffReader(bytes, start);
    if (!r) return null;
    const ifd0 = readIfd(r, bytes, start, r.u32(4), [TAG_DATETIME]);
    if (ifd0.exifPointer !== null) {
      const exif = readIfd(r, bytes, start, ifd0.exifPointer, [TAG_DATETIME_ORIGINAL, TAG_DATETIME_DIGITIZED, TAG_SUBSEC_ORIGINAL]);
      const subSec = exif.ascii.get(TAG_SUBSEC_ORIGINAL) ?? null;
      const original = parseExifDateTime(exif.ascii.get(TAG_DATETIME_ORIGINAL), subSec);
      if (original) return original;
      const digitized = parseExifDateTime(exif.ascii.get(TAG_DATETIME_DIGITIZED));
      if (digitized) return digitized;
    }
    return parseExifDateTime(ifd0.ascii.get(TAG_DATETIME));
  } catch {
    return null;
  }
}

function startsWithExifHeader(bytes: Uint8Array, offset: number): boolean {
  // "Exif\0\0"
  return (
    bytes[offset] === 0x45 && bytes[offset + 1] === 0x78 && bytes[offset + 2] === 0x69 &&
    bytes[offset + 3] === 0x66 && bytes[offset + 4] === 0 && bytes[offset + 5] === 0
  );
}

// בלוק EXIF כמו ש-sharp מחזיר ב-metadata().exif ("Exif\0\0" + TIFF), או TIFF ישיר.
export function takenAtFromExifBlock(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes || bytes.length < 8) return null;
  return takenAtFromTiff(bytes, startsWithExifHeader(bytes, 0) ? 6 : 0);
}

// תחילת קובץ JPEG -> שעת צילום ISO, או null (לא JPEG / אין EXIF / קטוע).
export function takenAtFromJpeg(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // SOS / EOI - מכאן מתחיל המידע של התמונה, אין יותר metadata
    if (marker === 0xda || marker === 0xd9) return null;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2) return null;
    if (marker === 0xe1 && startsWithExifHeader(bytes, offset + 4)) {
      return takenAtFromTiff(bytes.subarray(0, Math.min(bytes.length, offset + 2 + segmentLength)), offset + 10);
    }
    offset += 2 + segmentLength;
  }
  return null;
}

// דפדפן: File/Blob מקורי (לפני הקטנה) -> שעת צילום, או null. אף פעם לא זורק.
export async function readTakenAtFromFile(file: Blob): Promise<string | null> {
  try {
    if (file.type && file.type !== 'image/jpeg') return null;
    const head = new Uint8Array(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
    return takenAtFromJpeg(head);
  } catch {
    return null;
  }
}

// אימות קלט מגוף בקשה (רישום תמונה): מחרוזת ISO סבירה, אחרת null.
export function parseTakenAtInput(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  // 1971..שנה קדימה - מעבר לזה שעון מצלמה שגוי
  if (time < Date.UTC(1971, 0, 1) || time > Date.now() + 366 * 24 * 3600 * 1000) return null;
  return new Date(time).toISOString();
}
