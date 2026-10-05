import { NextRequest } from 'next/server';
import { handleAuthCallback } from '@/lib/authCallback';

// יעד לקישור איפוס הסיסמה (app/login/forgot-password/page.tsx). נתיב נפרד
// במקום /auth/callback?next=/login/reset-password - כי Supabase בודק את
// redirectTo מול רשימת ה-Redirect URLs המורשים כולל ה-query string, וכתובת
// עם ?next= לא תואמת לרשומה "/auth/callback" בדיוק; אז Supabase נופל בשקט
// ל-Site URL והקוד הולך לאיבוד. כאן אין query משלנו, והיעד קבוע.
// צריך להוסיף ל-Redirect URLs: {SITE_URL}/auth/callback/reset (ראו README).
export async function GET(request: NextRequest) {
  return handleAuthCallback(request, {
    defaultNext: '/login/reset-password',
    allowNext: false,
    errorPath: '/login/forgot-password',
  });
}
