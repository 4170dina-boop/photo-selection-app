import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/requireAdmin';

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// רשימת כל הצלמות לפאנל הניהול (app/dashboard/admin/page.tsx) - מי משלמת
// (Grow) מסומנת ידנית כ-is_unlimited=true כאן, מחוץ לזרימת ההרשמה הרגילה.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });
  }

  const { data: photographers, error } = await supabaseAdmin
    .from('photographers')
    .select('id, auth_user_id, business_name, is_unlimited, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'שליפת הצלמות נכשלה' }, { status: 500 });
  }

  // מייל לא נשמר בטבלת photographers - שולפים מ-auth.users ומצמידים לפי id.
  // listUsers() מחזיר עמוד אחד בלבד (ברירת מחדל page:1, perPage:50) - עם יותר מ-50
  // משתמשי auth בפרויקט (לא רק צלמות) צריך לדפדף על כל העמודים, בדיוק כמו
  // listAllFiles ב-app/api/galleries/[id]/route.ts עבור Storage .list().
  const allUsers: { id: string; email?: string }[] = [];
  let page = 1;
  const perPage = 1000; // המקסימום הנתמך ב-SDK (auth.admin.listUsers)
  while (true) {
    const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    // שגיאה באמצע הדפדוף עוצרת כאן במקום ללולאה אינסופית או קריסת הבקשה כולה -
    // הצלמות עצמן כבר נשלפו בהצלחה למעלה, אז מציגים אותן עם המיילים שכן הצלחנו
    // לשלוף (חלק עלול לצאת null) במקום להפיל את כל הבקשה על שגיאה בהעשרת מייל בלבד.
    if (usersError || !usersPage) break;
    allUsers.push(...usersPage.users);
    if (usersPage.users.length < perPage) break; // עמוד לא מלא = העמוד האחרון
    page += 1;
  }
  const emailByUserId = new Map(allUsers.map((u) => [u.id, u.email]));

  const rows = (photographers ?? []).map((p) => ({
    id: p.id,
    businessName: p.business_name,
    email: emailByUserId.get(p.auth_user_id) ?? null,
    isUnlimited: p.is_unlimited,
    createdAt: p.created_at,
  }));

  return NextResponse.json({ photographers: rows });
}
