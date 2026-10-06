// בדיקת התאמת מסירה: האם התמונות הסופיות שהועלו (delivered_photos) תואמות
// לתמונות שהלקוחה בחרה (+ תמונות מתנה). ההשוואה לפי שם הקובץ בלבד - בלי
// נתיב, בלי סיומת, בלי רישיות, ובלי תוספות שתוכנות עריכה מוסיפות בייצוא
// ("-edit", "_final", " (1)", "-Edit-2", " copy"). פונקציות טהורות -
// התצוגה: components/DeliveryMatchPanel.tsx.

import { fileBaseName, stripExtension } from './lightroomSearch';

// תוספת בסוף השם: מפריד (-, _, רווח) + מילת עריכה + מספר אופציונלי
const EDIT_SUFFIX_RE = /[-_ ]+(edit|edited|final|retouch|retouched|ret|copy|export|web|hires|lowres|bw)(?:[-_ ]*\d+)?$/i;
// " (1)" / "(2)" - כפילות של מערכת ההפעלה בהורדה
const COPY_NUMBER_RE = /\s*\(\d+\)$/;

// מפתח ההשוואה: "IMG_1234-Edit-2 (1).JPG" -> "img_1234"
export function deliveryMatchKey(filename: string): string {
  let name = stripExtension(fileBaseName(String(filename ?? '').trim())).trim();
  // כמה תוספות ברצף ("_final-edit (1)") - מסירים עד שאין יותר מה להסיר
  for (let i = 0; i < 5; i++) {
    const next = name.replace(COPY_NUMBER_RE, '').replace(EDIT_SUFFIX_RE, '').trim();
    if (next === name || next === '') break;
    name = next;
  }
  return name.toLowerCase();
}

export interface DeliveryMatchResult {
  // כמה מהתמונות הצפויות (נבחרות + מתנות, ייחודיות לפי מפתח) יש להן קובץ סופי
  matchedCount: number;
  expectedCount: number;
  // שמות הקבצים המקוריים שאין להם קובץ סופי תואם
  missing: string[];
  // קבצים סופיים שלא תואמים לשום תמונה נבחרת
  extras: string[];
  allMatched: boolean;
}

export function matchDelivery(expectedFilenames: readonly string[], finalFilenames: readonly string[]): DeliveryMatchResult {
  const finalKeys = new Set(finalFilenames.map(deliveryMatchKey).filter(Boolean));

  const expectedKeys = new Set<string>();
  const missing: string[] = [];
  for (const filename of expectedFilenames) {
    const key = deliveryMatchKey(filename);
    if (!key || expectedKeys.has(key)) continue;
    expectedKeys.add(key);
    if (!finalKeys.has(key)) missing.push(filename);
  }

  const extras: string[] = [];
  const seenExtra = new Set<string>();
  for (const filename of finalFilenames) {
    const key = deliveryMatchKey(filename);
    if (!key || expectedKeys.has(key) || seenExtra.has(key)) continue;
    seenExtra.add(key);
    extras.push(filename);
  }

  const expectedCount = expectedKeys.size;
  const matchedCount = expectedCount - missing.length;
  return { matchedCount, expectedCount, missing, extras, allMatched: missing.length === 0 && extras.length === 0 };
}

// "✓ 46/48 תואמות · חסרות: IMG_1, IMG_2" - רשימות ארוכות מקוצרות
export function deliveryMatchSummary(result: DeliveryMatchResult, maxNames = 5): string {
  const list = (names: string[]) => {
    const shown = names.slice(0, maxNames).map((n) => stripExtension(fileBaseName(n)));
    return names.length > maxNames ? `${shown.join(', ')} ועוד ${names.length - maxNames}` : shown.join(', ');
  };
  const parts = [`${result.allMatched ? '✓' : '⚠'} ${result.matchedCount}/${result.expectedCount} תואמות`];
  if (result.missing.length > 0) parts.push(`חסרות: ${list(result.missing)}`);
  if (result.extras.length > 0) parts.push(`מיותרות: ${list(result.extras)}`);
  return parts.join(' · ');
}
