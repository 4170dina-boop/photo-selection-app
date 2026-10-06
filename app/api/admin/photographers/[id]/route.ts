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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // id לא תקין היה מגיע ל-Postgres ונופל כ-500 (invalid input syntax for uuid)
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'צלם/ת לא נמצא/ה' }, { status: 404 });
  }

  // select('id') - בלעדיו update על id שלא קיים "מצליח" בלי לעדכן כלום
  const { data, error } = await supabaseAdmin
    .from('photographers')
    .update({ is_unlimited: body.isUnlimited })
    .eq('id', params.id)
    .select('id');

  if (error) {
    return NextResponse.json({ error: 'העדכון נכשל' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'צלם/ת לא נמצא/ה' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
