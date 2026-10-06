import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isSandboxFromAddress, RESEND_SANDBOX_FROM } from '@/lib/setupChecklist';

// אילו יכולות מערכת מוגדרות בשרת (משתני סביבה) - לרשימת השלמת ההגדרות
// (components/SetupChecklist.tsx). מחזירים רק בוליאנים, אף פעם לא את המפתחות
// עצמם או את כתובת השליחה המלאה.
export const dynamic = 'force-dynamic';

// אותו סדר עדיפויות כמו getFromAddress ב-lib/email.ts: app_settings ->
// RESEND_FROM_EMAIL -> כתובת ה-sandbox. null = לא הצלחנו לבדוק.
async function emailSandbox(): Promise<boolean | null> {
  const fallback = process.env.RESEND_FROM_EMAIL || RESEND_SANDBOX_FROM;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return isSandboxFromAddress(fallback);
  }
  try {
    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await admin.from('app_settings').select('value').eq('key', 'resend_from_email').maybeSingle();
    return isSandboxFromAddress((data as { value?: string } | null)?.value || fallback);
  } catch {
    return null;
  }
}

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const email = !!process.env.RESEND_API_KEY;
  return NextResponse.json({
    ai: !!process.env.ANTHROPIC_API_KEY,
    email,
    emailSandbox: email ? await emailSandbox() : null,
  });
}
