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

/**
 * האם הניהול נעול לחשבון ספציפי (ADMIN_USER_ID מוגדר). בלי זה - בפרויקט שבו
 * "Confirm email" כבוי, email_confirmed_at מתמלא אוטומטית בהרשמה, כך שמי
 * שנרשמת ראשונה עם הכתובת של ADMIN_EMAIL מקבלת ניהול. לא נועלים בכוח (המנהלת
 * הייתה מאבדת גישה עד שתגדיר את המשתנה) - רק אזהרה בשרת והודעה בדף הניהול.
 */
export function isAdminLockedToUserId(env: AdminEnv): boolean {
  return (env.ADMIN_USER_ID ?? '').trim().length > 0;
}

/**
 * עוטפת פונקציית לוג כך שתרוץ פעם אחת בלבד לכל חיי התהליך (instance של השרת) -
 * כדי שאזהרת "ADMIN_USER_ID לא מוגדר" לא תציף את הלוגים בכל בקשת ניהול.
 */
export function once<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let done = false;
  return (...args: A) => {
    if (done) return;
    done = true;
    fn(...args);
  };
}
