import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/requireAdmin';

// service_role - חובה כאן: הטריגר protect_is_unlimited ב-supabase/schema.sql
// דוחה שינוי ב-is_unlimited מכל חיבור שאינו service_role, כדי שצלמת לא תוכל
// לפתוח את קונסולת הדפדפן ולסמן את עצמה כ"ללא הגבלה" בעצמה.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });
  }

  let body: { isUnlimited?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  if (typeof body.isUnlimited !== 'boolean') {
    return NextResponse.json({ error: 'חסר isUnlimited' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('photographers')
    .update({ is_unlimited: body.isUnlimited })
    .eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: 'העדכון נכשל' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
