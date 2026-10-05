// מגבלת קצב למיילים שהצלמת שולחת ידנית בלחיצת כפתור (הזמנה מחדש, תזכורת,
// התראת "התמונות מוכנות", בקשת ביקורת, עדכון צילום). בלי זה לחיצות חוזרות
// שורפות את מכסת Resend ומציפות את הלקוחה. פונקציה טהורה - ההחלטה בלבד;
// הקריאה/כתיבה ל-DB ב-lib/manualEmailLog.ts.

export type ManualEmailType = 'invite' | 'reminder' | 'delivery' | 'review' | 'shoot_update';

// מינימום בין שתי שליחות מאותו סוג לאותה גלריה/צילום
export const MANUAL_EMAIL_COOLDOWN_SECONDS = 60;
// מקסימום שליחות מאותו סוג לאותה גלריה/צילום ב-24 השעות האחרונות
export const MANUAL_EMAIL_DAILY_CAP = 10;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type CooldownDecision =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'daily_cap'; retryAfterSeconds: number; message: string };

export function checkManualEmailCooldown(
  sentAts: (string | null | undefined)[],
  now: Date = new Date(),
  cooldownSeconds: number = MANUAL_EMAIL_COOLDOWN_SECONDS,
  dailyCap: number = MANUAL_EMAIL_DAILY_CAP
): CooldownDecision {
  const nowMs = now.getTime();
  // רק שליחות מה-24 שעות האחרונות; מתעלמות מערכים ריקים/לא תקינים. חותמות
  // "מהעתיד" (שעון לא מסונכרן) נחשבות כאילו נשלחו עכשיו.
  const times = sentAts
    .map((s) => (s ? new Date(s).getTime() : NaN))
    .filter((t) => Number.isFinite(t))
    .map((t) => Math.min(t, nowMs))
    .filter((t) => nowMs - t < DAY_MS)
    .sort((a, b) => a - b);

  if (times.length === 0) return { allowed: true };

  const last = times[times.length - 1];
  const cooldownLeftMs = last + cooldownSeconds * 1000 - nowMs;
  if (cooldownLeftMs > 0) {
    const seconds = Math.ceil(cooldownLeftMs / 1000);
    return {
      allowed: false,
      reason: 'cooldown',
      retryAfterSeconds: seconds,
      message: `המייל נשלח לפני רגע - אפשר לשלוח שוב בעוד ${seconds} שניות`,
    };
  }

  if (times.length >= dailyCap) {
    // המקום מתפנה כשהשליחה ה-(count - cap + 1) הוותיקה יוצאת מחלון ה-24 שעות
    const freeingAt = times[times.length - dailyCap] + DAY_MS;
    const seconds = Math.max(1, Math.ceil((freeingAt - nowMs) / 1000));
    const hours = Math.ceil(seconds / 3600);
    return {
      allowed: false,
      reason: 'daily_cap',
      retryAfterSeconds: seconds,
      message: `המייל הזה כבר נשלח ${dailyCap} פעמים ב-24 השעות האחרונות - אפשר לשלוח שוב בעוד ${
        hours <= 1 ? 'שעה' : `${hours} שעות`
      }`,
    };
  }

  return { allowed: true };
}

// תווית קצרה לכפתור מושבת ("שוב בעוד 42 שנ׳") - שניות/דקות/שעות לפי הגודל
export function formatCooldownLeft(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s} שנ׳`;
  if (s < 3600) return `${Math.ceil(s / 60)} דק׳`;
  return `${Math.ceil(s / 3600)} שע׳`;
}
