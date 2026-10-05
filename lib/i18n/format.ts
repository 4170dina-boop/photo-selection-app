// פורמט תאריכים/מטבע לפי שפה, וכיווני ניווט (חצים/החלקה) לפי כיוון השפה.
// תאריך עברי (לוח עברי) מוצג רק בעברית וביידיש; בשאר השפות - תאריך לועזי
// לפי ה-locale. תמיד לפי היום האזרחי בישראל (Asia/Jerusalem).

import { hebrewDateInIsrael } from '../galleryClient';
import { formatIsraelDate } from '../israelTime';
import { INTL_LOCALE, langDir, type Lang } from './types';

function hasHebrewCalendar(lang: Lang): boolean {
  return lang === 'he' || lang === 'yi';
}

// תאריך "ארוך" לתצוגה בטקסט ("עד {date}"): עברית/יידיש - תאריך עברי
// (כמו קודם); אחרות - "October 12, 2026" / "12 de octubre de 2026".
export function formatGalleryDate(lang: Lang, date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  if (hasHebrewCalendar(lang)) return hebrewDateInIsrael(d);
  return new Intl.DateTimeFormat(INTL_LOCALE[lang], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(d);
}

// לועזי + עברי (באנר ההארכה, קולאז', מיילי הארכה): עברית/יידיש -
// "12.10.2026 · כ״ט בתשרי תשפ״ז"; אחרות - התאריך הלועזי בלבד.
export function formatDateWithHebrew(lang: Lang, date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  if (hasHebrewCalendar(lang)) return `${formatIsraelDate(d)} · ${hebrewDateInIsrael(d)}`;
  return formatGalleryDate(lang, d);
}

// סכום בשקלים: Intl.NumberFormat עם ILS (₪), עד שתי ספרות אחרי הנקודה בלי
// אפסים מיותרים (12 / 12.5).
export function formatCurrency(lang: Lang, amount: number): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  return new Intl.NumberFormat(INTL_LOCALE[lang], {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

// חצים במקלדת: ב-RTL "הבאה" משמאל (חץ שמאלה = הבאה), ב-LTR הפוך.
export function arrowNavDelta(key: string, lang: Lang): 1 | -1 | 0 {
  const rtl = langDir(lang) === 'rtl';
  if (key === 'ArrowLeft') return rtl ? 1 : -1;
  if (key === 'ArrowRight') return rtl ? -1 : 1;
  return 0;
}

// הסף בפיקסלים - כמו SWIPE_THRESHOLD_PX ב-lib/galleryClient.ts
const SWIPE_THRESHOLD = 50;

// החלקה אופקית: ב-RTL גרירה ימינה (dx>0) חושפת את "הבאה" שמשמאל; ב-LTR
// גרירה שמאלה (dx<0) = הבאה. לא בזום, לא בתנועה בעיקר אנכית, לא מתחת לסף.
export function swipeNavDeltaForLang(dx: number, dy: number, zoomed: boolean, lang: Lang, threshold = SWIPE_THRESHOLD): 1 | -1 | 0 {
  if (zoomed) return 0;
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  const toRight = dx > 0;
  if (langDir(lang) === 'rtl') return toRight ? 1 : -1;
  return toRight ? -1 : 1;
}
