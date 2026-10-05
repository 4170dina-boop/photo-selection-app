import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/adminCheck';

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

  if (
    !isAdminUser(user, {
      ADMIN_EMAIL: process.env.ADMIN_EMAIL,
      ADMIN_USER_ID: process.env.ADMIN_USER_ID,
    })
  ) {
    return null;
  }

  return user;
}
