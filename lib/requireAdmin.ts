import { createClient } from '@/lib/supabase/server';

// שער יחיד לכל app/api/admin/* - רק המייל שמוגדר ב-ADMIN_EMAIL (משתני סביבה,
// לא ב-DB) עובר. זה לא תפקיד/הרשאה בטבלת photographers במכוון - מנהלת
// המערכת היא לא בהכרח צלמת רשומה, וזה מונע מצב שבו שינוי בטבלה בטעות
// "מוסיף" מנהלים חדשים.
export async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !process.env.ADMIN_EMAIL || user.email !== process.env.ADMIN_EMAIL) {
    return null;
  }

  return user;
}
