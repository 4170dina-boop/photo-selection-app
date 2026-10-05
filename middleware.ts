import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveSafeNext } from '@/lib/safeNext';

// response חדש (כדי שה-request headers המעודכנים יגיעו הלאה), בלי לאבד עוגיות
// שכבר נכתבו קודם באותה בקשה - session מפוצל לכמה עוגיות (chunks) נכתב ב-set
// נפרד לכל אחת.
function nextWithPreviousCookies(request: NextRequest, previous: NextResponse) {
  const next = NextResponse.next({ request: { headers: request.headers } });
  previous.cookies.getAll().forEach((cookie) => next.cookies.set(cookie));
  return next;
}

// מרענן את ה-session (טוקנים) בכל בקשה, ומגן על /dashboard/* -
// בלי זה, session שפג היה נשאר "תקוע" עד שהמשתמש היה עושה רענון ידני.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = nextWithPreviousCookies(request, response);
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = nextWithPreviousCookies(request, response);
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // הפניה שנושאת איתה את העוגיות שה-supabase client כתב ל-response (למשל
  // טוקנים שרועננו ב-getUser). בלי זה, הפניה "זורקת" את הרענון והדפדפן נשאר
  // עם טוקן ישן - ונכשל שוב בבקשה הבאה.
  function redirectTo(url: URL) {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // כולל ה-query (למשל ?tab=...) כדי לחזור בדיוק לאותו מקום אחרי ההתחברות
    url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return redirectTo(url);
  }

  if (user && request.nextUrl.pathname === '/login') {
    const target = resolveSafeNext(request.nextUrl.searchParams.get('next'), request.nextUrl.origin);
    return redirectTo(new URL(target, request.nextUrl.origin));
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
