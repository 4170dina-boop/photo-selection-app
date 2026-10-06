// תבניות גלריה (טבלת gallery_templates, ראו supabase/schema.sql) - "חתונה",
// "בר מצווה", "ניובורן": חבילה (תמונות כלולות, מחיר, מחיר לתמונה נוספת),
// כמה ימים פתוחה לבחירה, לשון פנייה ושפה. הצלמת בוחרת "תבנית:" בטופס גלריה
// חדשה והשדות מתמלאים. אימות טהור (בלי DB) - משותף ל-API
// (app/api/gallery-templates) ולטופס.

import { parseNonNegativeInt, parsePrice, type ParseResult } from './galleryValidation';
import { normalizeGender, type Gender } from './gender';
import { normalizeLang, type Lang } from './i18n/types';

export const TEMPLATE_NAME_MAX_LENGTH = 60;
export const MAX_TEMPLATES_PER_PHOTOGRAPHER = 50;
export const MAX_TEMPLATE_EXPIRY_DAYS = 365;

export interface GalleryTemplateData {
  includedPhotos: number;
  basePrice: number;
  extraPhotoPrice: number;
  // null = בלי תוקף
  expiryDays: number | null;
  clientGender: Gender;
  language: Lang;
}

export interface GalleryTemplate {
  id: string;
  name: string;
  data: GalleryTemplateData;
  created_at?: string;
}

export function parseTemplateName(value: unknown): ParseResult<string> {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { ok: false, error: 'צריך לתת שם לתבנית' };
  if (name.length > TEMPLATE_NAME_MAX_LENGTH) {
    return { ok: false, error: `שם התבנית ארוך מדי (עד ${TEMPLATE_NAME_MAX_LENGTH} תווים)` };
  }
  return { ok: true, value: name };
}

// אימות קפדני (שמירה דרך ה-API) - בדיוק השדות המותרים, שום דבר נוסף לא נכנס ל-jsonb
export function parseTemplateData(value: unknown): ParseResult<GalleryTemplateData> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'נתוני התבנית לא תקינים' };
  const body = value as Record<string, unknown>;

  const included = parseNonNegativeInt(body.includedPhotos, 'מספר התמונות בחבילה חייב להיות מספר שלם אי-שלילי');
  if (!included.ok) return included;
  const priceError = 'המחיר חייב להיות מספר אי-שלילי';
  const base = body.basePrice == null || body.basePrice === '' ? { ok: true as const, value: 0 } : parsePrice(body.basePrice, priceError);
  if (!base.ok) return base;
  const extra =
    body.extraPhotoPrice == null || body.extraPhotoPrice === '' ? { ok: true as const, value: 0 } : parsePrice(body.extraPhotoPrice, priceError);
  if (!extra.ok) return extra;

  let expiryDays: number | null = null;
  if (body.expiryDays != null && body.expiryDays !== '') {
    const days = parseNonNegativeInt(body.expiryDays, `מספר ימי התוקף חייב להיות מספר שלם בין 1 ל-${MAX_TEMPLATE_EXPIRY_DAYS}`);
    if (!days.ok) return days;
    if (days.value < 1 || days.value > MAX_TEMPLATE_EXPIRY_DAYS) {
      return { ok: false, error: `מספר ימי התוקף חייב להיות מספר שלם בין 1 ל-${MAX_TEMPLATE_EXPIRY_DAYS}` };
    }
    expiryDays = days.value;
  }

  const clientGender = body.clientGender == null || body.clientGender === '' ? 'f' : normalizeGender(body.clientGender);
  if (!clientGender) return { ok: false, error: 'לשון הפנייה לא תקינה' };
  const language = body.language == null || body.language === '' ? 'he' : normalizeLang(body.language);
  if (!language) return { ok: false, error: 'שפת הגלריה לא תקינה' };

  return {
    ok: true,
    value: { includedPhotos: included.value, basePrice: base.value, extraPhotoPrice: extra.value, expiryDays, clientGender, language },
  };
}

// קריאה מה-DB - סלחנית: שורה ישנה/פגומה לא מפילה את הרשימה, רק נופלת
// לברירות מחדל. null = אין אפילו מספר תמונות - מדלגים על התבנית.
export function normalizeTemplateData(value: unknown): GalleryTemplateData | null {
  const parsed = parseTemplateData(value);
  if (parsed.ok) return parsed.value;
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const included = parseNonNegativeInt(body.includedPhotos, '');
  if (!included.ok) return null;
  const price = (v: unknown) => {
    const p = parsePrice(v, '');
    return p.ok ? p.value : 0;
  };
  const days = parseNonNegativeInt(body.expiryDays, '');
  return {
    includedPhotos: included.value,
    basePrice: price(body.basePrice),
    extraPhotoPrice: price(body.extraPhotoPrice),
    expiryDays: days.ok && days.value >= 1 && days.value <= MAX_TEMPLATE_EXPIRY_DAYS ? days.value : null,
    clientGender: normalizeGender(body.clientGender) ?? 'f',
    language: normalizeLang(body.language) ?? 'he',
  };
}

// תאריך התוקף לטופס (YYYY-MM-DD) - היום + expiryDays, לפי לוח השנה המקומי
export function expiryDateFromDays(days: number | null, now: Date = new Date()): string {
  if (days == null) return '';
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ההפך - כמה ימים מהיום עד התאריך בטופס (לשמירה כתבנית). '' = בלי תוקף.
export function expiryDaysFromDate(date: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return days >= 1 && days <= MAX_TEMPLATE_EXPIRY_DAYS ? days : null;
}

// טבלה חסרה (המיגרציה לא רצה): 42P01 מ-Postgres, PGRST205 מ-PostgREST
export function isMissingTemplatesTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const msg = error.message ?? '';
  return /gallery_templates/.test(msg) && /(does not exist|could not find)/i.test(msg);
}

// תיאור קצר לרשימה: "30 תמונות · ₪2,500 · ₪50 לנוספת · 14 ימים"
export function templateSummary(data: GalleryTemplateData): string {
  const money = (n: number) => `₪${n.toLocaleString('he-IL')}`;
  const parts = [`${data.includedPhotos} תמונות`, money(data.basePrice), `${money(data.extraPhotoPrice)} לנוספת`];
  if (data.expiryDays) parts.push(`${data.expiryDays} ימים`);
  return parts.join(' · ');
}
