import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { signSession, accessCodesMatch, normalizeAccessCodeForCompare } from '@/lib/session';
import { SESSION_MAX_AGE_MS, requireGallerySession } from '@/lib/gallerySession';
import { isLockedOut, clearedLockoutState } from '@/lib/accessLockout';
import { loadGalleryViewAccess } from '@/lib/galleryAccess';
import { isMissingFunctionError } from '@/lib/rpcErrors';
import { parseAccessCodeDbResult } from '@/lib/ownerClaimSession';

// שימו לב: כאן (ורק כאן, בצד שרת) משתמשים ב-service_role key, לא ב-anon key.
// ה-service key חייב להישאר בסביבת השרת בלבד ולעולם לא להגיע לדפדפן.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const LOCKED_OUT_ERROR = 'יותר מדי ניסיונות שגויים - נסו שוב בעוד כמה דקות';

export async function POST(req: NextRequest) {
  let body: { galleryId?: string; accessCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { galleryId, accessCode } = body;

  if (!galleryId || !accessCode || typeof accessCode !== 'string') {
    return NextResponse.json({ error: 'חסרים פרטים' }, { status: 400 });
  }

  // שולפים את הגלריה ואת הלקוחה המשויכת אליה
  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, client_id, status, expires_at, delivered_at, clients(id, access_code, failed_access_attempts, locked_until)')
    .eq('id', galleryId)
    .single();

  // טיוטה (draft) עוד לא נשלחה ללקוחה - לא פותחים אותה גם עם קוד נכון,
  // ומחזירים בדיוק כמו גלריה שלא קיימת (בלי לחשוף שיש כזו).
  if (galleryError || !gallery || gallery.status === 'draft') {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // בדיקת התוקף קודם להשוואת הקוד: גלריה שפג תוקפה (ושאין בה מה להוריד) לא
  // צריכה לחשוף אם הקוד שנוסה נכון או לא (410 לכל קוד, נכון או שגוי).
  // גלריה שפג תוקפה אבל כבר הושלמה/נמסרה נשארת פתוחה לצפייה בלבד (readOnly) -
  // כדי שהלקוחה תוכל להוריד את התמונות הסופיות. ראו resolveGalleryViewAccess.
  const access = await loadGalleryViewAccess(supabaseAdmin, galleryId, gallery);
  if (!access.ok) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  const client = (gallery as any).clients;
  const expectedCode = client?.access_code;

  if (isLockedOut(client)) {
    return NextResponse.json({ error: LOCKED_OUT_ERROR }, { status: 429 });
  }

  // הנתיב הראשי: try_access_code (supabase/schema.sql) - נעילת שורת הלקוחה,
  // בדיקת נעילה, השוואת הקוד ורישום הכשל/איפוס המונה בטרנזקציה אחת. קודם
  // ההשוואה הייתה ב-JS מול מצב שנקרא *לפני* הנעילה: עשרות ניחושים מקבילים
  // עברו כולם את isLockedOut למעלה, והנכון ביניהם הצליח גם אחרי שהשאר כבר
  // נעלו את הלקוחה. isLockedOut למעלה נשאר רק כקיצור דרך זול.
  // אם הפונקציה עוד לא קיימת (מיגרציה שלא רצה) - הנתיב הישן למטה.
  let verified = false;
  if (client?.id) {
    const { data: tryRows, error: tryError } = await supabaseAdmin.rpc('try_access_code', {
      p_client_id: client.id,
      p_code: normalizeAccessCodeForCompare(accessCode),
    });
    if (!tryError) {
      const result = parseAccessCodeDbResult(tryRows);
      if (!result) {
        console.error('[verify-access] try_access_code החזיר תשובה לא צפויה:', tryRows);
        return NextResponse.json({ error: 'השירות לא זמין כרגע, נסו שוב בעוד כמה דקות' }, { status: 503 });
      }
      if (result.lockedOut) {
        return NextResponse.json({ error: LOCKED_OUT_ERROR }, { status: 429 });
      }
      if (!result.ok) {
        return NextResponse.json({ error: 'קוד גישה שגוי' }, { status: 401 });
      }
      verified = true;
    } else if (!isMissingFunctionError(tryError)) {
      console.error('[verify-access] try_access_code נכשל:', tryError);
      return NextResponse.json({ error: 'השירות לא זמין כרגע, נסו שוב בעוד כמה דקות' }, { status: 503 });
    }
  }

  // נתיב ישן (fallback) - השוואה בזמן קבוע ובלי תלות ברישיות (lib/session.ts) - לא חושפת מידע על
  // אורך/תוכן הקוד הנכון דרך תזמון התשובה
  if (!verified && !accessCodesMatch(expectedCode, accessCode)) {
    if (client?.id) {
      // הרצה אטומית ב-DB (register_failed_access_attempt, ראו supabase/schema.sql)
      // במקום read-then-write מהערך שכבר נקרא למעלה - כדי לסגור מרוץ בין ניחושים
      // שמגיעים במקביל (לא ברצף): הפונקציה נועלת את שורת ה-client (SELECT ... FOR
      // UPDATE) ומחשבת/כותבת את failed_access_attempts/locked_until החדשים באותה
      // טרנזקציה. המפרט הטהור של אותה לוגיקה: afterFailedAttempt ב-lib/accessLockout.ts.
      const { data: attemptRows, error: attemptError } = await supabaseAdmin.rpc('register_failed_access_attempt', {
        p_client_id: client.id,
      });
      if (attemptError) {
        // בלי רישום הניסיון השגוי אין הגנת brute-force בכלל - לא מחזירים 401
        // רגיל (שהיה מאפשר ניחושים ללא הגבלה כל עוד ה-RPC שבור), אלא 503.
        console.error('[verify-access] register_failed_access_attempt נכשל:', attemptError);
        return NextResponse.json({ error: 'השירות לא זמין כרגע, נסו שוב בעוד כמה דקות' }, { status: 503 });
      }
      if (attemptRows?.[0]?.already_locked_out) {
        return NextResponse.json({ error: LOCKED_OUT_ERROR }, { status: 429 });
      }
    }
    return NextResponse.json({ error: 'קוד גישה שגוי' }, { status: 401 });
  }

  // try_access_code כבר איפס את המונה ב-DB; בנתיב הישן מאפסים כאן
  if (!verified && client?.id && ((client.failed_access_attempts ?? 0) > 0 || client.locked_until)) {
    await supabaseAdmin.from('clients').update(clearedLockoutState).eq('id', client.id);
  }

  // אם בדפדפן הזה כבר יש session תקף לגלריה הזו עם זהות (participantId) -
  // שומרים עליה במקום להתחיל מחדש, כדי שהקלדת הקוד שוב (למשל אחרי ניקוי
  // localStorage) לא תאפשר לבן/בת משפחה לבחור מחדש "זאת אני" בשם הבעלים.
  const existing = requireGallerySession(req, galleryId);
  const keepParticipantId =
    existing && existing.clientId === gallery.client_id ? existing.participantId : null;

  // session token חתום (HMAC) - לא ניתן לזייף/לשנות בלי SESSION_SECRET שנשאר בצד שרת.
  // participantId עדיין null בשלב הזה (אלא אם נשמר למעלה) - קוד הגישה נכון
  // פותח את הגלריה, אבל "מי בפועל נכנס/ת עכשיו" (הבעלים הרשומה או בן משפחה
  // אחר) נקבע בשלב הבא, ראו app/api/gallery/[id]/identify/route.ts.
  const sessionToken = signSession({
    galleryId,
    clientId: gallery.client_id,
    participantId: keepParticipantId,
    iat: Date.now(),
  });

  const response = NextResponse.json({ success: true, readOnly: access.readOnly });
  response.cookies.set(`gallery_session_${galleryId}`, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS / 1000,
    path: '/',
  });

  return response;
}
