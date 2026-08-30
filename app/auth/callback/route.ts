import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// יעד לקישור האימות שנשלח במייל אחרי הרשמה (Supabase Auth, PKCE flow).
// צריך להגדיר את זה כ-Redirect URL מורשה בהגדרות ה-Auth של פרויקט Supabase:
// {SITE_URL}/auth/callback
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard/galleries';

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
