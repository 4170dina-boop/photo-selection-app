// בדיקה אחת משותפת לכל פרמטר ?next= (דף ההתחברות, app/auth/callback, middleware).
// במקום לנחש בעזרת startsWith אילו מחרוזות "נראות" כמו נתיב פנימי - מה שפספס
// בעבר את /\evil.com (הדפדפן הופך \ ל-/ ומקבל //evil.com) ואת /%09/evil.com
// (searchParams מפענח ל-TAB, ו-URL מוחק TAB ומקבל שוב //evil.com) - נותנים
// לפרסר ה-URL של הדפדפן/Node לפענח את המחרוזת בדיוק כמו שהדפדפן יפענח אותה
// בהפניה, ודורשים שהתוצאה תישאר באותו origin.

export const SAFE_DEFAULT_NEXT = '/dashboard/galleries';

// יעדים שאסור להפנות אליהם אחרי התחברות - /login עצמו היה יוצר לולאת הפניות
// ב-middleware (צלמת מחוברת על /login?next=/login).
const BLOCKED_PATHNAMES = new Set(['/login', '/login/']);

/**
 * מחזיר נתיב פנימי בטוח (pathname + search + hash) או את ברירת המחדל.
 * @param next הערך הגולמי (כבר מפוענח, כמו ש-searchParams.get מחזיר)
 * @param origin ה-origin של האתר, למשל https://app.example.com
 */
export function resolveSafeNext(
  next: string | null | undefined,
  origin: string,
  fallback: string = SAFE_DEFAULT_NEXT
): string {
  if (!next) return fallback;

  try {
    const base = new URL(origin);
    const resolved = new URL(next, base);
    if (resolved.origin !== base.origin) return fallback;
    // /.//evil.com נפתר ל-pathname "//evil.com" באותו origin - אבל כשמחזירים
    // רק את הנתיב, router.push / new URL(path, origin) יפרשו אותו שוב כ-
    // protocol-relative ויצאו ל-evil.com. מצמצמים לוכסנים מובילים לאחד.
    const pathname = resolved.pathname.replace(/^\/+/, '/');
    if (BLOCKED_PATHNAMES.has(pathname)) return fallback;
    return `${pathname}${resolved.search}${resolved.hash}`;
  } catch {
    // next (או origin) לא ניתן לפענוח כ-URL תקין
    return fallback;
  }
}
