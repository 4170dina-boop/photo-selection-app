import { NextRequest } from 'next/server';
import { handleAuthCallback } from '@/lib/authCallback';
import { SAFE_DEFAULT_NEXT } from '@/lib/safeNext';

// יעד לקישור האימות שנשלח במייל אחרי הרשמה (Supabase Auth, PKCE flow).
// צריך להגדיר את זה כ-Redirect URL מורשה בהגדרות ה-Auth של פרויקט Supabase:
// {SITE_URL}/auth/callback (ראו README). ?next= (אם יש) עובר דרך lib/safeNext.ts.
export async function GET(request: NextRequest) {
  return handleAuthCallback(request, {
    defaultNext: SAFE_DEFAULT_NEXT,
    allowNext: true,
    errorPath: '/login',
  });
}
