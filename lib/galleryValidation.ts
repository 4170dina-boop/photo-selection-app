// אימות טהור (בלי DB/רשת) של שדות מספריים/תאריכים שמגיעים מטפסי הדשבורד -
// יצירת גלריה (POST app/api/galleries), עריכת גלריה (PATCH
// app/api/galleries/[id]) וברירות המחדל בהגדרות (PATCH app/api/photographer).
// הבדיקות בצד הלקוח (min/step ב-<input>) הן רק נוחות - זו הבקרה האמיתית לפני
// כתיבה ל-DB, ומטרתה לדחות NaN, מחרוזות ריקות, שברים במקום מספר שלם וכו'
// *לפני* הכתיבה הראשונה, כדי שלא יישארו עדכונים חלקיים.

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_PRICE = 99_999_999.99; // numeric(10,2)
const MAX_INT = 2_147_483_647; // int ב-Postgres

// מספר מתוך ערך JSON: מספר סופי, או מחרוזת מספרית לא ריקה. כל השאר (NaN,
// Infinity, '', בוליאני, אובייקט) -> null.
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseNonNegativeInt(value: unknown, error: string): ParseResult<number> {
  const n = toFiniteNumber(value);
  if (n === null || !Number.isInteger(n) || n < 0 || n > MAX_INT) return { ok: false, error };
  return { ok: true, value: n };
}

export function parsePrice(value: unknown, error: string): ParseResult<number> {
  const n = toFiniteNumber(value);
  if (n === null || n < 0 || n > MAX_PRICE) return { ok: false, error };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function parseReminderDays(value: unknown): ParseResult<number> {
  const n = toFiniteNumber(value);
  if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_INT) {
    return { ok: false, error: 'מספר ימי התזכורת חייב להיות מספר שלם, לפחות 1' };
  }
  return { ok: true, value: n };
}

// תאריך תפוגה: null/undefined/'' = בלי תפוגה. אחרת חייב להיות מחרוזת תאריך
// שניתנת לפענוח (הטפסים שולחים ISO מלא, ראו israelEndOfDayIso).
export function parseExpiresAt(value: unknown): ParseResult<string | null> {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return { ok: false, error: 'תאריך התפוגה לא תקין' };
  }
  return { ok: true, value: new Date(value).toISOString() };
}

export interface GalleryNumbers {
  includedPhotos: number;
  basePrice: number;
  extraPhotoPrice: number;
  // null = לא נשלח / נוקה (ביצירה: ברירת המחדל של הצלמת, בעריכה: null ב-DB)
  reminderDays: number | null;
  expiresAt: string | null;
}

// כל השדות המספריים של טופס גלריה (יצירה ועריכה) בבת אחת. מחירים חסרים
// (null/undefined) = 0, כמו שהקוד הקיים עשה עם `?? 0`.
export function parseGalleryNumbers(body: {
  includedPhotos?: unknown;
  basePrice?: unknown;
  extraPhotoPrice?: unknown;
  reminderDays?: unknown;
  expiresAt?: unknown;
}): ParseResult<GalleryNumbers> {
  const included = parseNonNegativeInt(body.includedPhotos, 'מספר התמונות בחבילה חייב להיות מספר שלם אי-שלילי');
  if (!included.ok) return included;

  const priceError = 'המחיר חייב להיות מספר אי-שלילי';
  const base = body.basePrice == null ? { ok: true as const, value: 0 } : parsePrice(body.basePrice, priceError);
  if (!base.ok) return base;
  const extra = body.extraPhotoPrice == null ? { ok: true as const, value: 0 } : parsePrice(body.extraPhotoPrice, priceError);
  if (!extra.ok) return extra;

  let reminderDays: number | null = null;
  if (body.reminderDays != null && body.reminderDays !== '') {
    const r = parseReminderDays(body.reminderDays);
    if (!r.ok) return r;
    reminderDays = r.value;
  }

  const expires = parseExpiresAt(body.expiresAt);
  if (!expires.ok) return expires;

  return {
    ok: true,
    value: {
      includedPhotos: included.value,
      basePrice: base.value,
      extraPhotoPrice: extra.value,
      reminderDays,
      expiresAt: expires.value,
    },
  };
}

// לוגו הצלמת: רק URL ציבורי מה-bucket של הלוגואים ב-Supabase Storage שלנו
// (מה שמסך ההגדרות מעלה, ראו app/dashboard/settings/page.tsx) - לא כל URL
// חיצוני, כי הוא מוצג בגלריות של הלקוחות. null/'' = הסרת הלוגו.
export function parseLogoUrl(value: unknown, supabaseUrl: string | undefined): ParseResult<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'כתובת הלוגו לא תקינה' };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: true, value: null };

  const base = (supabaseUrl ?? '').replace(/\/+$/, '');
  const prefix = `${base}/storage/v1/object/public/photographer-logos/`;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'כתובת הלוגו לא תקינה' };
  }
  if (
    !base ||
    parsed.protocol !== 'https:' ||
    !trimmed.startsWith(prefix) ||
    trimmed.length === prefix.length ||
    // מונע ../ שיוצא מה-bucket אחרי נרמול ה-URL
    !parsed.href.startsWith(prefix)
  ) {
    return { ok: false, error: 'כתובת הלוגו לא תקינה' };
  }
  return { ok: true, value: trimmed };
}
