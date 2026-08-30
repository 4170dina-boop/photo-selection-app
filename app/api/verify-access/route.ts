import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { signSession, safeCompare } from '@/lib/session';
import { SESSION_MAX_AGE_MS } from '@/lib/gallerySession';
import { isLockedOut, afterFailedAttempt, clearedLockoutState } from '@/lib/accessLockout';

// שימו לב: כאן (ורק כאן, בצד שרת) משתמשים ב-service_role key, לא ב-anon key.
// ה-service key חייב להישאר בסביבת השרת בלבד ולעולם לא להגיע לדפדפן.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(req: NextRequest) {
  let body: { galleryId?: string; accessCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { galleryId, accessCode } = body;

  if (!galleryId || !accessCode) {
    return NextResponse.json({ error: 'חסרים פרטים' }, { status: 400 });
  }

  // שולפים את הגלריה ואת הלקוחה המשויכת אליה
  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, client_id, status, expires_at, clients(id, access_code, failed_access_attempts, locked_until)')
    .eq('id', galleryId)
    .single();

  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const client = (gallery as any).clients;
  const expectedCode = client?.access_code;

  if (isLockedOut(client)) {
    return NextResponse.json({ error: 'יותר מדי ניסיונות שגויים - נסו שוב בעוד כמה דקות' }, { status: 429 });
  }

  // השוואה בזמן קבוע - לא חושפת מידע על אורך/תוכן הקוד הנכון דרך תזמון התשובה
  if (!expectedCode || !safeCompare(expectedCode, accessCode)) {
    if (client?.id) {
      await supabaseAdmin.from('clients').update(afterFailedAttempt(client)).eq('id', client.id);
    }
    return NextResponse.json({ error: 'קוד גישה שגוי' }, { status: 401 });
  }

  if (client?.id && (client.failed_access_attempts ?? 0) > 0) {
    await supabaseAdmin.from('clients').update(clearedLockoutState).eq('id', client.id);
  }

  if (gallery.expires_at && new Date(gallery.expires_at) < new Date()) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  // session token חתום (HMAC) - לא ניתן לזייף/לשנות בלי SESSION_SECRET שנשאר בצד שרת
  const sessionToken = signSession({
    galleryId,
    clientId: gallery.client_id,
    iat: Date.now(),
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(`gallery_session_${galleryId}`, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS / 1000,
    path: '/',
  });

  return response;
}
