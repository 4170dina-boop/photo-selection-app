// galleries.language - שפת הגלריה והמיילים ללקוח/ה, נקבעת ע"י הצלמת.
// אותה גישה כמו client_gender ב-lib/gender.ts: הקוד עובד גם כשהעמודה עוד
// לא קיימת (מיגרציה שלא רצה) - קריאה מחזירה null/'he', ושמירה היא עדכון
// נפרד אחרי השמירה הראשית כדי שעמודה חסרה לא תפיל יצירה/עריכה.

import { isMissingColumnError } from '../gender';
import { DEFAULT_LANG, normalizeLang, type Lang } from './types';

interface SupabaseLike {
  from: (table: string) => any;
}

export function parseLanguageInput(value: unknown): { ok: true; value: Lang | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const lang = normalizeLang(value);
  if (!lang) return { ok: false, error: 'שפת הגלריה לא תקינה' };
  return { ok: true, value: lang };
}

// null = לא ידוע (עמודה חסרה / שגיאה / גלריה לא קיימת) - הגלריה בצד הלקוח
// נופלת אז לשפת הדפדפן, והמיילים לעברית (fetchGalleryLanguageOrDefault).
export async function fetchGalleryLanguage(supabase: SupabaseLike, galleryId: string): Promise<Lang | null> {
  try {
    const { data, error } = await supabase.from('galleries').select('language').eq('id', galleryId).maybeSingle();
    if (error) return null;
    return normalizeLang(data?.language);
  } catch {
    return null;
  }
}

export async function fetchGalleryLanguageOrDefault(supabase: SupabaseLike, galleryId: string): Promise<Lang> {
  return (await fetchGalleryLanguage(supabase, galleryId)) ?? DEFAULT_LANG;
}

export async function saveGalleryLanguage(
  supabase: SupabaseLike,
  galleryId: string,
  lang: Lang
): Promise<'ok' | 'missing-column' | 'error'> {
  try {
    const { error } = await supabase.from('galleries').update({ language: lang }).eq('id', galleryId);
    if (!error) return 'ok';
    return isMissingColumnError(error) ? 'missing-column' : 'error';
  } catch {
    return 'error';
  }
}
