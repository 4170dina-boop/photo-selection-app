// אשף הפתיחה לצלמת חדשה (app/dashboard/welcome/page.tsx) - לוגיקה טהורה בלבד,
// כדי שאפשר יהיה לבדוק ב-vitest את החלטת ההפניה בלי דפדפן/Supabase.
//
// מקור האמת: photographers.onboarding_done_at (מיגרציה בסוף supabase/schema.sql).
// אם העמודה עוד לא קיימת, ה-API מחזיר onboardingDone=null ונופלים לדגל
// ב-localStorage (ONBOARDING_LOCAL_KEY) - כך שגם בלי המיגרציה האשף מוצג פעם אחת
// בלבד לכל דפדפן, ולא בכל טעינה.

export const WELCOME_PATH = '/dashboard/welcome';

// דגל מקומי: האשף הסתיים/דולג בדפדפן הזה (fallback כשאין עמודה ב-DB)
export const ONBOARDING_LOCAL_KEY = 'onboardingDone';

// דגל ל-session הנוכחי: כבר הפנינו פעם אחת לאשף - לא מפנים שוב באותו טאב,
// גם אם שמירת "סיימתי" נכשלה. זו רשת הביטחון נגד לולאות הפניה.
export const ONBOARDING_REDIRECTED_SESSION_KEY = 'onboardingRedirected';

// דפים שלעולם לא מפנים מהם: האשף עצמו (לולאה), הגדרות (האשף שולח לשם
// לפרטים נוספים) וניהול (מנהלת המערכת).
const EXEMPT_PREFIXES = [WELCOME_PATH, '/dashboard/settings', '/dashboard/admin'];

export function isOnboardingExemptPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  return EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export interface OnboardingRedirectInput {
  pathname: string | null | undefined;
  // מה-DB: true/false, או null = העמודה חסרה / לא ידוע
  onboardingDone: boolean | null;
  // דגל localStorage (fallback)
  localDone: boolean;
  // כמה גלריות יש לצלמת (כולל דוגמה). null = לא ידוע (שגיאה) -> לא מפנים
  galleryCount: number | null;
  // כבר הפנינו ב-session הזה
  alreadyRedirectedThisSession: boolean;
}

// מפנים לאשף רק כשבטוח שזו צלמת חדשה: אין אף גלריה, והאשף לא סומן כגמור -
// לא ב-DB ולא בדפדפן. כל ספק (שגיאה, נתון חסר) = לא מפנים.
export function shouldRedirectToWelcome(input: OnboardingRedirectInput): boolean {
  if (isOnboardingExemptPath(input.pathname)) return false;
  if (input.alreadyRedirectedThisSession) return false;
  if (input.galleryCount === null || input.galleryCount > 0) return false;
  if (input.onboardingDone === true) return false;
  if (input.localDone) return false;
  return true;
}

// "שם העסק" מהשלב הראשון באשף - אותו כלל כמו שדה חובה ב-photographers
// (business_name not null): לא ריק, עם תקרת אורך סבירה.
export const BUSINESS_NAME_MAX_LENGTH = 80;

export type BusinessNameParse = { ok: true; value: string } | { ok: false; error: string };

export function parseBusinessName(value: unknown): BusinessNameParse {
  const trimmed = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!trimmed) return { ok: false, error: 'נא למלא את שם העסק' };
  if (trimmed.length > BUSINESS_NAME_MAX_LENGTH) {
    return { ok: false, error: `שם העסק ארוך מדי (מקסימום ${BUSINESS_NAME_MAX_LENGTH} תווים)` };
  }
  return { ok: true, value: trimmed };
}

export const WELCOME_STEP_COUNT = 3;

// מעבר שלב באשף, תמיד בתוך הטווח 0..WELCOME_STEP_COUNT-1
export function clampWelcomeStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(WELCOME_STEP_COUNT - 1, Math.max(0, Math.trunc(step)));
}
