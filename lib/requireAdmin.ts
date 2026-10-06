import { createClient } from '@/lib/supabase/server';
import { isAdminLockedToUserId, isAdminUser, once } from '@/lib/adminCheck';

// אזהרה חד-פעמית (לכל instance של השרת) כשהניהול לא נעול ל-ADMIN_USER_ID -
// ראו isAdminLockedToUserId ב-lib/adminCheck.ts.
const warnUnlockedAdmin = once((userId: string) => {
  console.warn(
    `[admin] ADMIN_USER_ID לא מוגדר - הניהול פתוח לכל מי שמחוברת עם ADMIN_EMAIL. ` +
      `מומלץ להגדיר ב-Vercel: ADMIN_USER_ID=${userId}`
  );
});

// שער יחיד לכל app/api/admin/* - רק המייל שמוגדר ב-ADMIN_EMAIL (משתני סביבה,
// לא ב-DB) עובר, ורק אחרי שאומת (email_confirmed_at). אם מוגדר גם
// ADMIN_USER_ID - חייב להתאים ל-user.id. זה לא תפקיד/הרשאה בטבלת photographers
// במכוון - מנהלת המערכת היא לא בהכרח צלמת רשומה, וזה מונע מצב שבו שינוי
// בטבלה בטעות "מוסיף" מנהלים חדשים. הלוגיקה עצמה ב-lib/adminCheck.ts.
export async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const env = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_USER_ID: process.env.ADMIN_USER_ID,
  };

  if (!user || !isAdminUser(user, env)) {
    return null;
  }

  if (!isAdminLockedToUserId(env)) warnUnlockedAdmin(user.id);

  return user;
}

// לדף הניהול - האם להציג את ההמלצה לנעול את הניהול ל-ADMIN_USER_ID.
export function adminLockedToUserId(): boolean {
  return isAdminLockedToUserId({ ADMIN_USER_ID: process.env.ADMIN_USER_ID });
}
