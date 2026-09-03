import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const SAFE_DEFAULT_NEXT = '/dashboard/galleries';

// מוודא ש-next הוא נתיב יחסי לאותו origin, לא URL שמפנה לאתר חיצוני. בלי זה
// אפשר היה להעביר ?next=@evil.com/x (הדפדפן מפרש הכל לפני ה-@ האחרון כ-userinfo
// ומקבל host=evil.com בפועל) או ?next=//evil.com/x (protocol-relative URL) ולקבל
// הפניה פתוחה (open redirect) לפישינג - בלי אפילו code תקין, ישירות מ-GET הזה.
function resolveSafeNext(next: string | null, origin: string): string {
  if (!next) return SAFE_DEFAULT_NEXT;

  try {
    const resolved = new URL(next, origin);
    if (resolved.origin === origin) {
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    }
  } catch {
    // next לא ניתן לפענוח כ-URL תקין - מתעלמים וממשיכים ליעד ברירת המחדל.
  }

  return SAFE_DEFAULT_NEXT;
}

// יעד לקישור האימות שנשלח במייל אחרי הרשמה (Supabase Auth, PKCE flow).
// צריך להגדיר את זה כ-Redirect URL מורשה בהגדרות ה-Auth של פרויקט Supabase:
// {SITE_URL}/auth/callback
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = resolveSafeNext(searchParams.get('next'), origin);

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
