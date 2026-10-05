// הלוגיקה הטהורה של lib/requireAdmin.ts - בנפרד כדי שאפשר יהיה לבדוק אותה
// בלי next/headers ו-Supabase.

export type AdminCandidate = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
};

export type AdminEnv = {
  ADMIN_EMAIL?: string;
  ADMIN_USER_ID?: string;
};

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * מנהלת = מייל מאומת (email_confirmed_at) שזהה ל-ADMIN_EMAIL (בלי רווחים/רישיות).
 * בלי אימות מייל, מי שנרשמת ראשונה עם הכתובת של המנהלת (בפרויקט שבו
 * "Confirm email" כבוי, או לפני שאישרה) הייתה מקבלת הרשאות ניהול.
 * אם ADMIN_USER_ID מוגדר - חייב בנוסף להתאים ל-user.id (נעילה לחשבון ספציפי).
 */
export function isAdminUser(user: AdminCandidate | null | undefined, env: AdminEnv): boolean {
  if (!user) return false;

  const adminEmail = normalizeEmail(env.ADMIN_EMAIL);
  if (!adminEmail) return false;

  const userEmail = normalizeEmail(user.email);
  if (!userEmail || userEmail !== adminEmail) return false;

  if (!user.email_confirmed_at) return false;

  const adminUserId = (env.ADMIN_USER_ID ?? '').trim();
  if (adminUserId && user.id !== adminUserId) return false;

  return true;
}
