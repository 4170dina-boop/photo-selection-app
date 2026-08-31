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

  // מייל לא נשמר בטבלת photographers - שולפים פעם אחת מ-auth.users ומצמידים לפי id
  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
  const emailByUserId = new Map((usersData?.users ?? []).map((u) => [u.id, u.email]));

  const rows = (photographers ?? []).map((p) => ({
    id: p.id,
    businessName: p.business_name,
    email: emailByUserId.get(p.auth_user_id) ?? null,
    isUnlimited: p.is_unlimited,
    createdAt: p.created_at,
  }));

  return NextResponse.json({ photographers: rows });
}
