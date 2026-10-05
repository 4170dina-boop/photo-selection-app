// איזו שפה להציג בגלריית הלקוח/ה: בחירה שמורה בדפדפן (בורר השפה) קודמת
// לכל, אחר כך שפת הגלריה שהצלמת קבעה (galleries.language), אחר כך שפת
// הדפדפן אם נתמכת, ובסוף עברית.

import { DEFAULT_LANG, normalizeLang, type Lang } from './types';

// "en-US" -> 'en', "yi" / "ji" (קוד ישן ליידיש) -> 'yi', "iw" (קוד ישן לעברית) -> 'he'
export function langFromBrowserTag(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const base = tag.toLowerCase().split(/[-_]/)[0];
  if (base === 'iw') return 'he';
  if (base === 'ji') return 'yi';
  return normalizeLang(base);
}

export function firstSupportedBrowserLang(tags: readonly string[] | null | undefined): Lang | null {
  for (const tag of tags ?? []) {
    const lang = langFromBrowserTag(tag);
    if (lang) return lang;
  }
  return null;
}

export function resolveInitialLang(params: {
  stored?: unknown;
  galleryLang?: unknown;
  browserLangs?: readonly string[] | null;
}): Lang {
  return (
    normalizeLang(params.stored) ??
    normalizeLang(params.galleryLang) ??
    firstSupportedBrowserLang(params.browserLangs) ??
    DEFAULT_LANG
  );
}

// מפתח localStorage לכל גלריה - בחירה בגלריה אחת לא משנה גלריה של צלמת אחרת
export function langStorageKey(galleryId: string): string {
  return `gallery_lang_${galleryId}`;
}

export function loadStoredLang(galleryId: string): Lang | null {
  try {
    return normalizeLang(localStorage.getItem(langStorageKey(galleryId)));
  } catch {
    return null;
  }
}

export function saveStoredLang(galleryId: string, lang: Lang): void {
  try {
    localStorage.setItem(langStorageKey(galleryId), lang);
  } catch {
    // אחסון חסום - הבחירה פשוט לא תיזכר
  }
}

export function browserLanguages(): string[] {
  try {
    if (typeof navigator === 'undefined') return [];
    return Array.from(navigator.languages?.length ? navigator.languages : [navigator.language]).filter(Boolean);
  } catch {
    return [];
  }
}
