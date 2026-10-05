// לוגיקת נעילה טהורה (בלי I/O) עבור הגנת brute-force על קוד הגישה של הלקוחה -
// מופרדת מ-app/api/verify-access/route.ts כדי שאפשר יהיה לבדוק אותה בלי מוק ל-Supabase.

export interface LockoutState {
  failed_access_attempts: number | null;
  locked_until: string | null;
}

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export function isLockedOut(client: LockoutState | null | undefined, now = new Date()): boolean {
  return !!client?.locked_until && new Date(client.locked_until) > now;
}

// מחזירה את המצב שיש לשמור אחרי ניסיון שגוי - ננעלת בהגעה ל-MAX_ATTEMPTS.
// נעילה שכבר הסתיימה מאפסת את המונה: הניסיון השגוי הראשון אחריה נספר כ-1
// (ולא כ-6, שהיה נועל מחדש מיד על כל טעות בודדת). המקור האמיתי של הלוגיקה
// בזמן ריצה הוא register_failed_access_attempt ב-supabase/schema.sql (אטומי,
// עם נעילת שורה) - הפונקציה כאן היא המפרט הטהור שלה, ושתיהן חייבות להישאר זהות.
export function afterFailedAttempt(client: LockoutState | null | undefined, now = new Date()): {
  failed_access_attempts: number;
  locked_until: string | null;
} {
  const lockEnded = !!client?.locked_until && new Date(client.locked_until) <= now;
  const previous = lockEnded ? 0 : client?.failed_access_attempts ?? 0;
  const attempts = previous + 1;
  return {
    failed_access_attempts: attempts,
    locked_until: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
  };
}

export const clearedLockoutState = { failed_access_attempts: 0, locked_until: null } as const;
