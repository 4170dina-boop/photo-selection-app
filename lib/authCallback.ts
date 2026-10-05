import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { callbackParamsError } from '@/lib/authErrors';
import { resolveSafeNext } from '@/lib/safeNext';

type CallbackOptions = {
  // לאן להמשיך אחרי החלפת קוד מוצלחת, כשאין ?next= תקין
  defaultNext: string;
  // האם בכלל לקבל ?next= מה-URL (בקישור איפוס סיסמה היעד קבוע)
  allowNext: boolean;
  // לאן להפנות כשהקישור לא עבד (מתווסף ?error=...)
  errorPath: string;
};

// הלוגיקה המשותפת של app/auth/callback (אימות הרשמה) ו-app/auth/callback/reset
// (איפוס סיסמה): בודקת פרמטרי שגיאה של Supabase, code חסר, ושגיאה בהחלפת
// הקוד - ובכל אחד מהמקרים מפנה לדף עם ?error= שמציג הודעה ברורה, במקום
// "להצליח" בשקט בלי session ולהשאיר את הצלמת תקועה ב-/login בלי הסבר.
export async function handleAuthCallback(request: NextRequest, options: CallbackOptions) {
  const { searchParams, origin } = new URL(request.url);

  const fail = (code: string) => {
    const url = new URL(options.errorPath, origin);
    url.searchParams.set('error', code);
    return NextResponse.redirect(url);
  };

  const paramsError = callbackParamsError(searchParams);
  if (paramsError) {
    if (paramsError === 'link_expired') {
      console.warn('auth callback: Supabase returned error', {
        error: searchParams.get('error'),
        error_code: searchParams.get('error_code'),
        error_description: searchParams.get('error_description'),
      });
    }
    return fail(paramsError);
  }

  const code = searchParams.get('code') as string;
  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // בדרך כלל: קוד שפג/כבר נוצל, או שהקישור נפתח בדפדפן אחר מזה שבו
    // ביקשו אותו (PKCE - ה-code verifier נשמר בעוגייה בדפדפן המקורי).
    console.warn('auth callback: exchangeCodeForSession failed', error.code ?? error.status, error.message);
    return fail('link_expired');
  }

  const next = options.allowNext
    ? resolveSafeNext(searchParams.get('next'), origin, options.defaultNext)
    : options.defaultNext;

  return NextResponse.redirect(`${origin}${next}`);
}
