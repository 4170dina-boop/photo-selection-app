// לוגיקה טהורה ל"הכנה לסינון" (app/dashboard/galleries/[id]/filter-check):
// האם תמונה כבר עברה את סינון האינטרנט, לפי השוואת הגודל שהתקבל בדפדפן של
// הצלמת לגודל האמיתי של הקובץ. סינון שמחזיק תמונה מחזיר במקומה תמונה אחרת
// (מטושטשת/הודעה) או שגיאה - בשני המקרים הגודל לא יהיה זהה בדיוק.

export type FilterState = 'checking' | 'passed' | 'held';

export function classifyFilterResult(expectedBytes: number | null, receivedBytes: number | null): FilterState {
  if (receivedBytes === null) return 'held';
  // בלי גודל צפוי (הקובץ חסר ב-R2) אין דרך לדעת - מתייחסים כמו "עבר" כדי לא
  // לתקוע את הצלמת על תמונה שבכל מקרה לא תוצג כראוי.
  if (expectedBytes === null) return 'passed';
  return receivedBytes === expectedBytes ? 'passed' : 'held';
}

export function summarizeFilterStates(states: FilterState[]): { total: number; passed: number; held: number; checking: number; allPassed: boolean } {
  const passed = states.filter((s) => s === 'passed').length;
  const held = states.filter((s) => s === 'held').length;
  const checking = states.length - passed - held;
  return { total: states.length, passed, held, checking, allPassed: states.length > 0 && passed === states.length };
}
