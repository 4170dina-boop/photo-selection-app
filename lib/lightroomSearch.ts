// מחרוזת חיפוש ל-Lightroom / Capture One: שמות הקבצים המקוריים של התמונות
// שנבחרו (+ מתנות), מופרדים ב-", " - מדביקים בשדה החיפוש של הסינון (Library
// Filter > Text > Filename / Capture One: Filter > File Name) ומקבלים בדיוק
// את התמונות לעריכה. פונקציות טהורות - הכפתור: components/LightroomNamesCopy.tsx.

// רק השם עצמו, בלי תיקיות (שמות שהגיעו עם נתיב, למשל מגרירת תיקייה)
export function fileBaseName(filename: string): string {
  const parts = filename.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

// הסרת הסיומת האחרונה (.jpg / .CR3 / .jpeg) - רק אם היא נראית כמו סיומת
// (1-5 אותיות/ספרות), כדי שנקודה באמצע שם ("חתונה.דנה") לא תחתוך אותו.
// קובץ שמתחיל בנקודה (".hidden") נשאר כמו שהוא.
export function stripExtension(filename: string): string {
  return filename.replace(/(.)\.[A-Za-z0-9]{1,5}$/, '$1');
}

export interface LightroomSearchOptions {
  // true = "IMG_1234.CR3", false (ברירת מחדל) = "IMG_1234" - בלי סיומת
  // החיפוש תופס גם RAW וגם JPEG עם אותו שם
  withExtension?: boolean;
}

// רשימת השמות לחיפוש: בלי נתיב, בלי סיומת (אלא אם ביקשו), בלי ריקים ובלי
// כפילויות (השוואה בלי רישיות - Lightroom לא מבחין), לפי סדר ההופעה.
export function lightroomSearchNames(filenames: readonly string[], options: LightroomSearchOptions = {}): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of filenames) {
    const base = fileBaseName(String(raw ?? '').trim()).trim();
    const name = options.withExtension ? base : stripExtension(base);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function buildLightroomSearchString(filenames: readonly string[], options: LightroomSearchOptions = {}): string {
  return lightroomSearchNames(filenames, options).join(', ');
}

export function lightroomCopiedToast(count: number): string {
  return count === 1 ? 'הועתק שם אחד ✓' : `הועתקו ${count} שמות ✓`;
}
