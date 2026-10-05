// כללי ההעלאה והאחסון של תמונות - לוגיקה טהורה (בלי R2/Supabase), כדי שאפשר
// יהיה לבדוק אותה ב-vitest ולשתף בין ה-routes בצד שרת לבין הדפדפן.

// תואם ל-enforce_photo_limit ב-supabase/schema.sql - אם המספר שם משתנה, צריך
// לעדכן גם כאן. האכיפה הסופית היא ה-trigger ב-DB; הבדיקה ב-presign-upload היא
// רק כדי לא לתת לדפדפן להעלות ל-R2 קובץ שה-insert ממילא ידחה.
export const FREE_PHOTO_LIMIT = 25;

// גודל מקסימלי לקובץ בודד שמעלים ל-R2 (מקור או תמונה סופית).
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// מגבלת פיקסלים ל-sharp - מגן מפני "פצצת דקומפרסיה" (קובץ קטן עם מידות ענק
// שמתפוצץ בזיכרון). 100MP מכסה בנוחות כל מצלמה מקצועית נפוצה.
export const MAX_INPUT_PIXELS = 100_000_000;

// רק פורמטים ש-sharp יודע לפענח (אחרת העיבוד נכשל והתמונה לא מוצגת ללקוחה).
// הסיומת נגזרת מסוג התוכן, לא משם הקובץ שהגיע מהלקוח.
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
};

export type UploadRequestValidation =
  | { ok: true; contentType: string; size: number; ext: string }
  | { ok: false; error: string };

// מאמתת את מה שהדפדפן הצהיר לפני חתימת ה-URL. ה-contentType וה-size נחתמים
// לתוך ה-URL עצמו (ראו getPresignedUploadUrl ב-lib/r2.ts), כך ש-R2 ידחה PUT
// עם סוג/גודל שונים ממה שאושר כאן.
export function validateUploadRequest(body: unknown): UploadRequestValidation {
  const b = (body ?? {}) as { contentType?: unknown; size?: unknown };
  const contentType = typeof b.contentType === 'string' ? b.contentType.toLowerCase() : '';
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext) {
    return { ok: false, error: 'סוג קובץ לא נתמך - אפשר להעלות JPEG, PNG, WebP, AVIF או TIFF' };
  }

  const size = b.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    return { ok: false, error: 'גודל קובץ לא תקין' };
  }
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `הקובץ גדול מדי (מקסימום ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)` };
  }

  return { ok: true, contentType, size, ext };
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXT_RE = `(${Array.from(new Set(Object.values(ALLOWED_IMAGE_TYPES))).join('|')})`;

// שם הקובץ ב-R2 הוא uuid בלבד + סיומת בטוחה - שם הקובץ המקורי נשמר רק
// ב-original_filename ב-DB, לא בתוך ה-key.
export function buildPhotoKey(galleryId: string, uuid: string, ext: string): string {
  return `${galleryId}/${uuid}.${ext}`;
}

export function buildFinalPhotoKey(galleryId: string, uuid: string, ext: string): string {
  return `${galleryId}/final/${uuid}.${ext}`;
}

// key קבוע לכל תמונה - עיבוד חוזר דורס את אותו אובייקט במקום להשאיר thumbs יתומים.
export function thumbnailKey(galleryId: string, photoId: string): string {
  return `${galleryId}/thumbs/${photoId}.jpg`;
}

// האם ה-key שייך לתיקיית הגלריה - אותו כלל כמו ה-CHECK constraint ב-schema.sql.
export function isKeyInGallery(galleryId: string, key: unknown): key is string {
  return typeof galleryId === 'string' && galleryId.length > 0 && typeof key === 'string' && key.startsWith(`${galleryId}/`);
}

// האם זה בדיוק key של מקור שנוצר ע"י presign-upload (ולא thumb/final/נתיב שרירותי).
export function isFreshPhotoKey(galleryId: string, key: unknown): key is string {
  if (!isKeyInGallery(galleryId, key)) return false;
  return new RegExp(`^${UUID_RE}\\.${EXT_RE}$`).test(key.slice(galleryId.length + 1));
}

// כמה תמונות עוד אפשר להוסיף לגלריה. null = ללא הגבלה (is_unlimited).
export function remainingPhotoQuota(currentCount: number, isUnlimited: boolean): number | null {
  if (isUnlimited) return null;
  return Math.max(0, FREE_PHOTO_LIMIT - currentCount);
}

// תמונה מוצגת ללקוחה רק אם יש לה thumbnail מעובד (עם סימן מים) שונה מהמקור.
// thumbnail_path == file_path הוא מצב ישן (לפני התיקון) שבו העיבוד נכשל ו-
// thumbnail_path נשאר המקור הנקי - גם אותו לא מציגים.
export function hasWatermarkedThumbnail(photo: { file_path: string; thumbnail_path: string | null }): boolean {
  return !!photo.thumbnail_path && photo.thumbnail_path !== photo.file_path;
}

// כמה זמן מחכים מרגע ההעלאה לפני שמניחים שהעיבוד (fire-and-forget ב-
// UploadProvider) נכשל ומפעילים אותו מחדש - קצת יותר מ-maxDuration של ה-route.
export const PROCESS_RETRY_GRACE_MS = 90_000;

export function photosNeedingProcessRetry<T extends { id: string; needsProcessing: boolean; createdAt: string | null }>(
  photos: T[],
  nowMs: number,
  alreadyAttempted: Set<string>
): T[] {
  return photos.filter((p) => {
    if (!p.needsProcessing || alreadyAttempted.has(p.id)) return false;
    const created = p.createdAt ? Date.parse(p.createdAt) : NaN;
    return Number.isNaN(created) || nowMs - created >= PROCESS_RETRY_GRACE_MS;
  });
}

// הלוגו של הצלמת מורד בצד שרת (סימן מים) - מותר רק מה-bucket הציבורי
// photographer-logos של פרויקט ה-Supabase שלנו, כדי שלא יהיה אפשר לגרום לשרת
// לפנות לכתובת שרירותית (SSRF) דרך logo_url.
export function isAllowedLogoUrl(logoUrl: unknown, supabaseUrl: string | undefined): logoUrl is string {
  if (typeof logoUrl !== 'string' || !supabaseUrl) return false;
  try {
    const url = new URL(logoUrl);
    const base = new URL(supabaseUrl);
    return (
      url.protocol === 'https:' &&
      url.origin === base.origin &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/storage/v1/object/public/photographer-logos/')
    );
  } catch {
    return false;
  }
}

// אינדקסים בתור ההעלאה שעדיין צריך להעלות - רק pending/error, אף פעם לא
// done/uploading (אחרת "נסי שוב" מעלה שוב תמונות שכבר הועלו ויוצר כפילויות).
export function indicesToUpload(items: { status: 'pending' | 'uploading' | 'done' | 'error' }[]): number[] {
  const result: number[] = [];
  items.forEach((it, i) => {
    if (it.status === 'pending' || it.status === 'error') result.push(i);
  });
  return result;
}

// מריצה fn על כל הפריטים עם לכל היותר `limit` הרצות בו-זמנית. שומרת על הסדר בתוצאות.
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
