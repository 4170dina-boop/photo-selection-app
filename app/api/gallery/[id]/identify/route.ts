import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { signSession } from '@/lib/session';
import { SESSION_MAX_AGE_MS } from '@/lib/gallerySession';
import {
  checkGalleryWritable,
  decideIdentify,
  evaluateOwnerClaim,
  loadGalleryViewAccess,
  MAX_PARTICIPANTS_PER_GALLERY,
} from '@/lib/galleryAccess';
import { isMissingColumnError, parseGenderInput } from '@/lib/gender';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const DISPLAY_NAME_MAX_LENGTH = 40;

// שיתוף גלריה משפחתי, שלב 2: אחרי שקוד הגישה כבר אומת (verify-access) אבל
// עדיין לא ידוע "מי בפועל נכנס/ת" - הבעלים הרשומה עצמה, או בן משפחה אחר עם
// אותו קוד. הלקוח שולח asOwner=true (הבעלים לוחצת "זאת אני") או displayName
// (מישהי אחרת מקלידה את השם שלה) - כאן מחליטים לאיזה participant לשייך את
// ה-session, וחותמים session חדש עם participantId קבוע. ההחלטה עצמה (כולל
// שימוש חוזר בזהות קיימת וחסימת "שדרוג" לבעלים) ב-decideIdentify, lib/galleryAccess.ts.
//
// גורם אימות שני לבעלים: קוד הגישה משותף לכל המשפחה (נשלח גם לכתובות
// הנוספות), אז "זאת אני" לבד היה נותן זכויות בעלים (סיום בחירה וכו') לכל מי
// שמחזיק בקוד ונכנס ראשון מדפדפן חדש. לכן asOwner=true מחייב גם ownerEmail -
// כתובת המייל שהצלמת רשמה ללקוחה (clients.email), נבדקת בצד השרת בלבד
// (evaluateOwnerClaim ב-lib/galleryAccess.ts). זה נדרש רק פעם אחת לכל דפדפן:
// אחרי זה ה-session נושא participantId של הבעלים (מסלול reuse) ו-verify-access
// שומר עליו גם כשמקלידים שוב את הקוד.
// ניסיונות שגויים נספרים במונה נפרד (clients.owner_claim_failed_attempts/
// owner_claim_locked_until, RPC register_failed_owner_claim ב-supabase/schema.sql,
// אותה לוגיקה בדיוק כמו lib/accessLockout.ts) ולא במונה של קוד הגישה - כי
// verify-access מאפס את המונה ההוא בכל הקלדת קוד נכונה, ומי שמחזיק בקוד היה
// יכול לנחש מיילים בלי הגבלה ע"י הקלדה חוזרת של הקוד בין ניחוש לניחוש.
const OWNER_CLAIM_LOCKED_ERROR = 'יותר מדי ניסיונות שגויים - נסי שוב בעוד כמה דקות';
const OWNER_EMAIL_MISMATCH_ERROR =
  'כתובת המייל לא תואמת לזו שהצלמת רשמה. אם את/ה לא הלקוחה הרשומה, יש לבחור "לא, אני בן/בת משפחה או חבר/ה"';
const EMAIL_MAX_LENGTH = 254;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);

  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  let body: { asOwner?: boolean; displayName?: string; ownerEmail?: string; gender?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('id, client_id, owner_participant_id, status, expires_at, delivered_at')
    .eq('id', galleryId)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // זיהוי כבעלים/שימוש חוזר בזהות קיימת לא כותב כלום - מותר כל עוד הגלריה
  // פתוחה לצפייה (כולל צפייה בלבד אחרי תפוגה, כדי לראות את הבחירה שלה).
  if (!(await loadGalleryViewAccess(supabaseAdmin, galleryId, gallery)).ok) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  let decision = decideIdentify({
    sessionParticipantId: session.participantId,
    ownerParticipantId: gallery.owner_participant_id ?? null,
    asOwner: !!body.asOwner,
  });

  let participantId: string;
  let displayName: string;
  let isOwner: boolean;

  if (decision.kind === 'reuse') {
    const { data: existing } = await supabaseAdmin
      .from('gallery_participants')
      .select('id, display_name, is_owner')
      .eq('id', decision.participantId)
      .eq('gallery_id', galleryId)
      .maybeSingle();

    if (existing) {
      participantId = existing.id;
      displayName = existing.display_name;
      isOwner = existing.id === gallery.owner_participant_id;
    } else if (body.asOwner) {
      // המשתתף/ת שב-session נמחק/ה - לא נותנים לזה להפוך למסלול עקיפה לבעלים
      return NextResponse.json({ error: 'כבר נכנסת לגלריה בשם אחר - אי אפשר להחליף לבעלת הגלריה' }, { status: 403 });
    } else {
      decision = { kind: 'guest' };
    }
  }

  if (decision.kind === 'reject') {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }

  if (decision.kind === 'owner') {
    const claim = await verifyOwnerClaim(gallery.client_id, body.ownerEmail);
    if (claim) return claim;

    const { data: owner } = await supabaseAdmin
      .from('gallery_participants')
      .select('display_name')
      .eq('id', gallery.owner_participant_id)
      .single();

    participantId = gallery.owner_participant_id as string;
    displayName = owner?.display_name ?? '';
    isOwner = true;
  } else if (decision.kind === 'guest') {
    const trimmed = (body.displayName ?? '').trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'צריך למלא שם' }, { status: 400 });
    }
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      return NextResponse.json({ error: `השם ארוך מדי (מקסימום ${DISPLAY_NAME_MAX_LENGTH} תווים)` }, { status: 400 });
    }
    // לשון פנייה לאורח/ת (lib/gender.ts). המסך מחייב בחירה, אבל השרת מקבל גם
    // בקשה בלי השדה (דף ישן שנשמר בדפדפן) - אז נשמר null = "לא ידוע".
    const parsedGender = parseGenderInput(body.gender);
    if (!parsedGender.ok) {
      return NextResponse.json({ error: parsedGender.error }, { status: 400 });
    }
    const guestGender = parsedGender.value;

    // יצירת משתתף/ת חדש/ה היא כתיבה - רק בגלריה שעדיין פתוחה לבחירה
    // (לא אחרי תפוגה ולא אחרי "סיימתי לבחור").
    const writable = await checkGalleryWritable(supabaseAdmin, galleryId);
    if (!writable.ok) {
      return NextResponse.json({ error: writable.error }, { status: writable.status });
    }

    // מגבלה רכה (לא אטומית - שתי בקשות מקבילות יכולות לעבור אותה באחד) על
    // מספר המשתתפים, כדי שהקוד לא ינוצל לניפוח gallery_participants.
    const { count, error: countError } = await supabaseAdmin
      .from('gallery_participants')
      .select('id', { count: 'exact', head: true })
      .eq('gallery_id', galleryId);
    if (countError) {
      return NextResponse.json({ error: 'ההצטרפות נכשלה' }, { status: 500 });
    }
    if ((count ?? 0) >= MAX_PARTICIPANTS_PER_GALLERY) {
      return NextResponse.json(
        { error: `הגעתם למספר המשתתפים המרבי בגלריה (${MAX_PARTICIPANTS_PER_GALLERY})` },
        { status: 409 }
      );
    }

    const insertGuest = (withGender: boolean) =>
      supabaseAdmin
        .from('gallery_participants')
        .insert({
          gallery_id: galleryId,
          display_name: trimmed,
          is_owner: false,
          ...(withGender && guestGender ? { gender: guestGender } : {}),
        })
        .select('id, display_name')
        .single();

    let { data: guest, error } = await insertGuest(true);
    // מיגרציית gallery_participants.gender עוד לא רצה - מצטרפים בלי לשמור את הפנייה
    if (error && guestGender && isMissingColumnError(error)) {
      ({ data: guest, error } = await insertGuest(false));
    }

    if (error || !guest) {
      return NextResponse.json({ error: 'ההצטרפות נכשלה' }, { status: 500 });
    }

    participantId = guest.id;
    displayName = guest.display_name;
    isOwner = false;
  }

  const sessionToken = signSession({
    galleryId,
    clientId: session.clientId,
    participantId: participantId!,
    iat: Date.now(),
  });

  const response = NextResponse.json({ success: true, displayName: displayName!, isOwner: isOwner! });
  response.cookies.set(`gallery_session_${galleryId}`, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS / 1000,
    path: '/',
  });

  return response;
}

// אימות המייל של "זאת אני" מול clients.email + רישום/איפוס ניסיונות שגויים.
// מחזירה תשובת שגיאה מוכנה, או null אם מותר להמשיך כבעלים.
async function verifyOwnerClaim(clientId: string, rawEmail: unknown): Promise<NextResponse | null> {
  const providedEmail = typeof rawEmail === 'string' ? rawEmail.slice(0, EMAIL_MAX_LENGTH) : '';

  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('id, email, owner_claim_failed_attempts, owner_claim_locked_until')
    .eq('id', clientId)
    .single();

  // כולל המצב שבו מיגרציית owner_claim_* עוד לא הורצה (העמודות חסרות) -
  // נכשלים "סגור": לא נותנים זכויות בעלים בלי אפשרות לספור ניסיונות שגויים.
  if (error || !client) {
    console.error('[identify] טעינת פרטי הלקוחה לאימות בעלים נכשלה:', error);
    return NextResponse.json({ error: 'השירות לא זמין כרגע, נסי שוב בעוד כמה דקות' }, { status: 503 });
  }

  const check = evaluateOwnerClaim({
    lockout: { failed_access_attempts: client.owner_claim_failed_attempts, locked_until: client.owner_claim_locked_until },
    registeredEmail: client.email,
    providedEmail,
  });

  if (check.kind === 'locked') {
    return NextResponse.json({ error: OWNER_CLAIM_LOCKED_ERROR }, { status: 429 });
  }
  if (check.kind === 'missing') {
    return NextResponse.json({ error: 'צריך להקליד את כתובת המייל שלך', needsOwnerEmail: true }, { status: 400 });
  }
  if (check.kind === 'no_registered_email') {
    return NextResponse.json({ error: 'לא רשום מייל ללקוחה בגלריה הזו - פני לצלמת' }, { status: 403 });
  }
  if (check.kind === 'mismatch') {
    // אטומי ב-DB (נעילת שורה), כמו register_failed_access_attempt ב-verify-access
    const { data: attemptRows, error: attemptError } = await supabaseAdmin.rpc('register_failed_owner_claim', {
      p_client_id: client.id,
    });
    if (attemptError) {
      // בלי רישום הניסיון אין הגבלה על ניחושים - לא מחזירים 401 רגיל
      console.error('[identify] register_failed_owner_claim נכשל:', attemptError);
      return NextResponse.json({ error: 'השירות לא זמין כרגע, נסי שוב בעוד כמה דקות' }, { status: 503 });
    }
    if (attemptRows?.[0]?.already_locked_out) {
      return NextResponse.json({ error: OWNER_CLAIM_LOCKED_ERROR }, { status: 429 });
    }
    return NextResponse.json({ error: OWNER_EMAIL_MISMATCH_ERROR }, { status: 401 });
  }

  if ((client.owner_claim_failed_attempts ?? 0) > 0 || client.owner_claim_locked_until) {
    await supabaseAdmin
      .from('clients')
      .update({ owner_claim_failed_attempts: 0, owner_claim_locked_until: null })
      .eq('id', client.id);
  }
  return null;
}
