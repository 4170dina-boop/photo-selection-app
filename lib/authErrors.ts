// מיפוי שגיאות Supabase Auth להודעות בעברית לצלמת, ופרמטר ?error= שחוזר
// מ-app/auth/callback כשקישור במייל לא עבד. לוגיקה טהורה - בלי supabase-js -
// כדי שאפשר יהיה לבדוק אותה ב-vitest.

export type AuthErrorLike = {
  code?: string | null;
  status?: number | null;
  message?: string | null;
};

export type SignInErrorKind = 'email_not_confirmed' | 'invalid_credentials' | 'rate_limited' | 'generic';

const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
]);

export function isRateLimitError(err: AuthErrorLike | null | undefined): boolean {
  if (!err) return false;
  if (err.status === 429) return true;
  if (err.code && RATE_LIMIT_CODES.has(err.code)) return true;
  return false;
}

export function classifySignInError(err: AuthErrorLike): SignInErrorKind {
  if (isRateLimitError(err)) return 'rate_limited';
  if (err.code === 'email_not_confirmed') return 'email_not_confirmed';
  if (err.code === 'invalid_credentials') return 'invalid_credentials';
  // גרסאות ישנות של GoTrue לא מחזירות code - נופלים להודעה עצמה
  const message = err.message ?? '';
  if (/email not confirmed/i.test(message)) return 'email_not_confirmed';
  if (/invalid login credentials/i.test(message)) return 'invalid_credentials';
  return 'generic';
}

export const SIGN_IN_ERROR_MESSAGES: Record<SignInErrorKind, string> = {
  email_not_confirmed: 'המייל עוד לא אושר, בדקי את תיבת הדואר',
  invalid_credentials: 'אימייל או סיסמה שגויים',
  rate_limited: 'יותר מדי ניסיונות. חכי כמה דקות ונסי שוב',
  generic: 'ההתחברות נכשלה, נסי שוב בעוד רגע',
};

// שגיאות updateUser בדף קביעת סיסמה חדשה - הודעה לפי הקוד במקום תמיד "הקישור פג תוקף"
export function updatePasswordErrorMessage(err: AuthErrorLike): string {
  if (isRateLimitError(err)) return 'יותר מדי ניסיונות. חכי כמה דקות ונסי שוב';
  switch (err.code) {
    case 'weak_password':
      return 'הסיסמה חלשה מדי - בחרי סיסמה ארוכה יותר, עם שילוב של אותיות ומספרים';
    case 'same_password':
      return 'הסיסמה החדשה זהה לסיסמה הקודמת - בחרי סיסמה אחרת';
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'bad_jwt':
      return 'עדכון הסיסמה נכשל - הקישור פג תוקף, בקשי קישור חדש';
    case 'reauthentication_needed':
    case 'reauthentication_not_valid':
      return 'נדרש אימות מחדש - בקשי קישור איפוס חדש ונסי שוב';
  }
  return 'עדכון הסיסמה נכשל - ייתכן שהקישור פג תוקף, נסי לבקש קישור חדש';
}

export const RATE_LIMIT_MESSAGE = 'יותר מדי ניסיונות. חכי כמה דקות ונסי שוב';

export const ALREADY_REGISTERED_MESSAGE = 'כתובת המייל כבר רשומה - אפשר להתחבר או לאפס סיסמה';

// הרשמה עם מייל שכבר רשום: כש-"Confirm email" דלוק, Supabase לא מחזיר שגיאה
// (כדי לא לחשוף אילו כתובות רשומות) אלא user "מזויף" עם identities ריק ובלי
// session - בלי הבדיקה הזו הצלמת הייתה רואה "נרשמת בהצלחה" ומחכה למייל שלא יגיע.
export function isExistingUserSignup(
  user: { identities?: unknown[] | null } | null | undefined,
  hasSession: boolean
): boolean {
  if (!user || hasSession) return false;
  return Array.isArray(user.identities) && user.identities.length === 0;
}

// קודים שה-callback מעביר ל-/login?error=... (ול-/login/forgot-password?error=...)
export type CallbackErrorCode = 'link_expired' | 'link_invalid';

export const CALLBACK_ERROR_MESSAGES: Record<CallbackErrorCode, string> = {
  link_expired:
    'הקישור מהמייל פג תוקף או שכבר נעשה בו שימוש. אם כבר אישרת את המייל - פשוט התחברי. אחרת, בקשי קישור חדש.',
  link_invalid: 'הקישור מהמייל לא תקין או חסר. נסי לפתוח אותו שוב מהמייל, או בקשי קישור חדש.',
};

export function callbackErrorMessage(param: string | null | undefined): string | null {
  if (!param) return null;
  if (param === 'link_expired' || param === 'link_invalid') return CALLBACK_ERROR_MESSAGES[param];
  return null;
}

/**
 * מחליט מה קרה בקישור שחזר מ-Supabase ל-callback, לפני ובלי תלות בהחלפת הקוד:
 * - error / error_description / error_code ב-query - Supabase דחה את הקישור (למשל otp_expired)
 * - אין code בכלל - קישור שבור/חתוך
 * מחזיר null אם יש code ואין שגיאה, כלומר צריך לנסות exchangeCodeForSession.
 */
export function callbackParamsError(params: URLSearchParams): CallbackErrorCode | null {
  if (params.get('error') || params.get('error_description') || params.get('error_code')) {
    return 'link_expired';
  }
  if (!params.get('code')) return 'link_invalid';
  return null;
}
