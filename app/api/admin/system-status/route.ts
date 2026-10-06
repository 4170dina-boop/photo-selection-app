import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { adminLockedToUserId, requireAdmin } from '@/lib/requireAdmin';
import { isSandboxFromAddress, RESEND_SANDBOX_FROM } from '@/lib/setupChecklist';

// מצב הגדרות המערכת לקטע "⚙️ הגדרות מערכת" בדף הניהול (components/SystemSetupGuide.tsx).
// למנהלת בלבד. לא מחזירים מפתחות - רק האם הם מוגדרים, ואת שמות הדומיינים
// שצריך לבקש לפתוח בסינון (נטפרי וכו').
export const dynamic = 'force-dynamic';

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function fromAddress(): Promise<string> {
  const fallback = process.env.RESEND_FROM_EMAIL || RESEND_SANDBOX_FROM;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return fallback;
  try {
    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await admin.from('app_settings').select('value').eq('key', 'resend_from_email').maybeSingle();
    return (data as { value?: string } | null)?.value || fallback;
  } catch {
    return fallback;
  }
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });

  const r2Endpoint =
    process.env.R2_ENDPOINT_OVERRIDE ||
    (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
  const from = process.env.RESEND_API_KEY ? await fromAddress() : null;

  return NextResponse.json({
    ai: !!process.env.ANTHROPIC_API_KEY,
    emailKey: !!process.env.RESEND_API_KEY,
    emailSandbox: from ? isSandboxFromAddress(from) : null,
    fromAddress: from,
    adminLocked: adminLockedToUserId(),
    userId: admin.id,
    siteHost: hostOf(process.env.NEXT_PUBLIC_SITE_URL) || new URL(req.url).host,
    imagesHost: hostOf(r2Endpoint),
    supabaseHost: hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL),
  });
}
