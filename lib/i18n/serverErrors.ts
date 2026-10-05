// תרגום הודעות שגיאה שמגיעות מהשרת (בעברית) לשפת הגלריה. השרת לא יודע
// באיזו שפה הלקוח/ה צופה, אז ממפים לפי הטקסט המדויק (הסעיף serverErrors
// במילון העברי). הודעה לא מוכרת (למשל עם מספר דינמי) מוצגת כמו שהיא -
// כלומר בעברית - בשפות אחרות.

import { serverErrors } from './he/serverErrors';
import { t, type MessageKey } from './translate';
import type { Lang, ViewerGender } from './types';

const KEY_BY_TEXT: Map<string, MessageKey> = new Map(
  (Object.entries(serverErrors) as [MessageKey, string][]).map(([key, text]) => [text, key])
);

export function serverErrorKey(text: string): MessageKey | null {
  return KEY_BY_TEXT.get(text.trim()) ?? null;
}

export function localizeServerError(lang: Lang, text: string, gender?: ViewerGender): string {
  if (lang === 'he') return text;
  const key = serverErrorKey(text);
  return key ? t(lang, key, undefined, gender) : text;
}

// הודעת שגיאה מגוף תשובה (שאולי אינה JSON) - מתורגמת אם מוכרת, אחרת
// fallback (שכבר בשפה הנכונה).
export function localizedErrorFromBody(lang: Lang, body: unknown, fallback: string, gender?: ViewerGender): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    const msg = (body as { error: string }).error.trim();
    if (msg) return localizeServerError(lang, msg, gender);
  }
  return fallback;
}
