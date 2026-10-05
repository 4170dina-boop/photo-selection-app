// t(lang, key, params, gender) - בחירת הודעה מהמילון, צורת יחיד/רבים
// (params.count) ולשון פנייה, ואז החלפת {param}. עברית = מקור האמת: מפתח
// שחסר בשפה אחרת (לא אמור לקרות - הטיפוסים אוכפים) נופל לעברית.

import { g, type ViewerGender } from '../gender';
import { he } from './he';
import { en } from './en';
import { yi } from './yi';
import { es } from './es';
import { fr } from './fr';
import { INTL_LOCALE, type GenderedMessage, type Lang, type Message, type MessageParams, type PluralMessage } from './types';

export type MessageKey = keyof typeof he;
export type Dictionary = Record<MessageKey, Message>;

export const DICTIONARIES: Record<Lang, Dictionary> = { he, en, yi, es, fr };

function isPlural(m: Message): m is PluralMessage {
  return typeof m === 'object' && 'one' in m;
}

function pluralCategory(lang: Lang, count: number): 'one' | 'other' {
  try {
    return new Intl.PluralRules(INTL_LOCALE[lang]).select(count) === 'one' ? 'one' : 'other';
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

// צורה מגדרית: עברית - g() מ-lib/gender.ts (כולל slashForm אוטומטי לניטרלי).
// שפות אחרות - n אם יש, אחרת "זכר/נקבה" (או אחת מהן אם זהות).
function pickGendered(lang: Lang, m: GenderedMessage, gender: ViewerGender | undefined): string {
  if (lang === 'he') return g(gender, m);
  if (gender === 'f') return m.f;
  if (gender === 'm') return m.m;
  if (m.n !== undefined) return m.n;
  return m.f === m.m ? m.f : `${m.m}/${m.f}`;
}

// התבנית (לפני החלפת פרמטרים) לפי שפה, כמות ולשון פנייה
export function resolveMessage(lang: Lang, key: MessageKey, gender?: ViewerGender, count?: number): string {
  const raw: Message = DICTIONARIES[lang]?.[key] ?? he[key];
  let m: string | GenderedMessage | PluralMessage = raw;
  if (isPlural(m)) m = pluralCategory(lang, Number(count ?? 0)) === 'one' ? m.one : m.other;
  if (typeof m === 'object') return pickGendered(lang, m as GenderedMessage, gender);
  return m;
}

// החלפת {name} - פרמטר שלא סופק נשאר כמו שהוא (קל לזהות בבדיקה)
export function interpolate(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

// כמו interpolate, אבל מחזיר מערך חלקים - כדי שהקורא יוכל להכניס ערכים שאינם
// מחרוזת (למשל אלמנט React מודגש). פרמטר חסר נשאר כטקסט.
export function interpolateParts<T>(template: string, params: Record<string, T | string | number>): (string | T)[] {
  const parts: (string | T)[] = [];
  let last = 0;
  template.replace(/\{(\w+)\}/g, (whole, name: string, offset: number) => {
    if (offset > last) parts.push(template.slice(last, offset));
    const value = params[name];
    parts.push(value === undefined ? whole : typeof value === 'number' ? String(value) : value);
    last = offset + whole.length;
    return whole;
  });
  if (last < template.length) parts.push(template.slice(last));
  return parts;
}

export function t(lang: Lang, key: MessageKey, params?: MessageParams, gender?: ViewerGender): string {
  const count = params && typeof params.count === 'number' ? params.count : undefined;
  return interpolate(resolveMessage(lang, key, gender, count), params);
}

// ריצה (לא רק טיפוסים): אילו מפתחות חסרים/מיותרים בשפה לעומת העברית
export function dictionaryKeyDiff(lang: Lang): { missing: string[]; extra: string[] } {
  const heKeys = Object.keys(he);
  const keys = Object.keys(DICTIONARIES[lang]);
  return {
    missing: heKeys.filter((k) => !keys.includes(k)),
    extra: keys.filter((k) => !heKeys.includes(k)),
  };
}
