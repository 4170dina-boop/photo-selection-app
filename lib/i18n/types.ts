// טיפוסים ועזרים בסיסיים לריבוי שפות בגלריית הלקוח/ה ובמיילים ללקוח/ה.
// פונקציות טהורות בלבד (בלי React/DOM/supabase) - כדי שאפשר יהיה לייבא גם
// בדפדפן, גם בשרת וגם ב-vitest.

import type { ViewerGender } from '../gender';

export const SUPPORTED_LANGS = ['he', 'en', 'yi', 'es', 'fr'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

// עברית היא שפת המקור (ברירת המחדל של galleries.language)
export const DEFAULT_LANG: Lang = 'he';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SUPPORTED_LANGS as readonly string[]).includes(value);
}

export function normalizeLang(value: unknown): Lang | null {
  return isLang(value) ? value : null;
}

// עברית ויידיש נכתבות מימין לשמאל
export function langDir(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'he' || lang === 'yi' ? 'rtl' : 'ltr';
}

// locale מלא ל-Intl (תאריכים/מספרים). ביידיש Intl לא תמיד מכיר פורמטים
// (תלוי בדפדפן/ICU) - לתאריך לועזי ומספרים משתמשים בפורמט הישראלי.
export const INTL_LOCALE: Record<Lang, string> = {
  he: 'he-IL',
  en: 'en-US',
  yi: 'he-IL',
  es: 'es-ES',
  fr: 'fr-FR',
};

// תווית קצרה לבורר השפה ("🌐 עב | EN | ייִד | ES | FR") + שם מלא (aria/רשימה)
export const LANG_SHORT_LABEL: Record<Lang, string> = {
  he: 'עב',
  en: 'EN',
  yi: 'ייִד',
  es: 'ES',
  fr: 'FR',
};

export const LANG_NAME: Record<Lang, string> = {
  he: 'עברית',
  en: 'English',
  yi: 'ייִדיש',
  es: 'Español',
  fr: 'Français',
};

// ---------- צורות הודעה ----------

// צורה לפי לשון פנייה: f/m, ו-n (ניטרלי, כשלא ידוע) אופציונלי - בעברית נגזר
// אוטומטית (slashForm ב-lib/gender.ts), בשאר השפות נופלים לזכר/נקבה עם לוכסן.
export interface GenderedMessage {
  f: string;
  m: string;
  n?: string;
}

// צורת יחיד/רבים לפי params.count (Intl.PluralRules). כל אחת יכולה להיות גם
// מגדרית.
export interface PluralMessage {
  one: string | GenderedMessage;
  other: string | GenderedMessage;
}

export type Message = string | GenderedMessage | PluralMessage;

export type MessageParams = Record<string, string | number | null | undefined>;

export type { ViewerGender };
