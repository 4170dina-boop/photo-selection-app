// "זאת אני" (app/api/gallery/[id]/identify/route.ts): ספירת ניסיונות שגויים
// בשתי רמות - לוגיקה טהורה, בלי DB/רשת.
//
// הבעיה: המונה היחיד היה על שורת הלקוחה (clients.owner_claim_*) - כך שבן משפחה
// שמקליד 5 פעמים מייל לא נכון (בטעות או בכוונה) נעל גם את הבעלים האמיתית
// במכשיר אחר ל-15 דקות.
//
// הפתרון (הפשוט שעדיין עמיד):
// 1. מונה לדפדפן - עוגייה חתומה (HMAC, lib/session.ts) לכל גלריה, אותו סף
//    בדיוק כמו קודם (MAX_ATTEMPTS=5 / LOCKOUT_MINUTES=15 מ-lib/accessLockout.ts).
//    טעויות של דפדפן אחד נועלות רק אותו.
// 2. מונה גלובלי על שורת הלקוחה - נשאר, אבל עם סף גבוה יותר
//    (OWNER_CLAIM_GLOBAL_MAX_ATTEMPTS) ובפונקציה אטומית אחת ב-DB
//    (try_owner_claim, supabase/schema.sql) שנועלת את השורה, בודקת נעילה,
//    משווה ורושמת - כך שבקשות מקבילות לא יכולות לעקוף אותו. הוא הגבול האמיתי
//    נגד brute force: מי שמוחק/לא שולח את העוגייה מקבל מונה דפדפן חדש, אבל
//    עדיין נעצר בסף הגלובלי.
// בעלים שכבר זוהתה במכשיר שלה לא מושפעת בכלל (מסלול reuse ב-identify לא בודק מייל).
// חסרון ידוע: תוקף מכוון שמנקה עוגיות עדיין יכול לנעול את "זאת אני" במכשירים
// חדשים אחרי OWNER_CLAIM_GLOBAL_MAX_ATTEMPTS ניסיונות - זה המחיר של הגבלת ניחושים.

import { afterFailedAttempt, isLockedOut, MAX_ATTEMPTS, type LockoutState } from './accessLockout';

export const OWNER_CLAIM_COOKIE_PREFIX = 'owner_claim_';
// יום - מספיק כדי לכסות חלון נעילה, ולא נשאר לנצח בדפדפן
export const OWNER_CLAIM_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;
// פי 4 מהסף לדפדפן: כמה בני משפחה שטועים במקביל לא נועלים את הבעלים,
// ועדיין לכל היותר 20 ניחושי מייל לכל חלון של 15 דקות.
export const OWNER_CLAIM_GLOBAL_MAX_ATTEMPTS = MAX_ATTEMPTS * 4;

export interface OwnerClaimBrowserState extends LockoutState {
  clientId: string;
}

// מה שנקרא מהעוגייה (אחרי אימות החתימה) - כל צורה לא צפויה, או עוגייה של
// לקוחה אחרת, = מצב נקי.
export function parseOwnerClaimBrowserState(raw: unknown, clientId: string): OwnerClaimBrowserState {
  const fresh: OwnerClaimBrowserState = { clientId, failed_access_attempts: 0, locked_until: null };
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Record<string, unknown>;
  if (r.clientId !== clientId) return fresh;
  const attempts = typeof r.failed_access_attempts === 'number' && Number.isFinite(r.failed_access_attempts)
    ? Math.max(0, Math.floor(r.failed_access_attempts))
    : 0;
  const lockedUntil = typeof r.locked_until === 'string' && !Number.isNaN(new Date(r.locked_until).getTime()) ? r.locked_until : null;
  return { clientId, failed_access_attempts: attempts, locked_until: lockedUntil };
}

export function isBrowserOwnerClaimLocked(state: OwnerClaimBrowserState, now = new Date()): boolean {
  return isLockedOut(state, now);
}

export function browserStateAfterFailure(state: OwnerClaimBrowserState, now = new Date()): OwnerClaimBrowserState {
  return { clientId: state.clientId, ...afterFailedAttempt(state, now) };
}

export type OwnerClaimDbResult = 'ok' | 'locked' | 'mismatch' | 'no_registered_email' | 'not_found';

// התשובה של try_owner_claim (returns table (result text)) - supabase-js מחזיר
// מערך שורות. ערך לא מוכר = null (ה-route מתייחס לזה כתקלה ונכשל "סגור").
export function parseOwnerClaimDbResult(data: unknown): OwnerClaimDbResult | null {
  const row = Array.isArray(data) ? data[0] : data;
  const value = row && typeof row === 'object' ? (row as { result?: unknown }).result : row;
  return value === 'ok' || value === 'locked' || value === 'mismatch' || value === 'no_registered_email' || value === 'not_found'
    ? value
    : null;
}

// התשובה של try_access_code (returns table (ok boolean, locked_out boolean))
export function parseAccessCodeDbResult(data: unknown): { ok: boolean; lockedOut: boolean } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const r = row as { ok?: unknown; locked_out?: unknown };
  if (typeof r.ok !== 'boolean' || typeof r.locked_out !== 'boolean') return null;
  return { ok: r.ok, lockedOut: r.locked_out };
}
