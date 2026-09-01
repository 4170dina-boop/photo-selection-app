import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/requireAdmin';

// service_role - נדרש כי app_settings לא חשוף ל-anon/authenticated דרך RLS
// בכלל (ראו supabase/schema.sql), אותו דפוס כמו app/api/admin/photographers.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const RESEND_FROM_EMAIL_KEY = 'resend_from_email';

// כרגע רק כתובת השליחה של Resend - הגדרה כלל-מערכתית אחת, לא לפי צלם.
// נועד לתת למנהלת המערכת (ADMIN_EMAIL) דרך קלה לעדכן את זה אחרי שיש דומיין
// מאומת ב-Resend, בלי לגעת במשתני סביבה ב-Vercel בכל פעם.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });
  }

  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', RESEND_FROM_EMAIL_KEY).single();

  return NextResponse.json({
    resendFromEmail: data?.value ?? process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });
  }

  let body: { resendFromEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const value = body.resendFromEmail?.trim();
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return NextResponse.json({ error: 'כתובת מייל לא תקינה' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('app_settings').upsert({ key: RESEND_FROM_EMAIL_KEY, value });

  if (error) {
    return NextResponse.json({ error: 'עדכון ההגדרה נכשל' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
