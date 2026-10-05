import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { signSession } from '@/lib/session';
import { SESSION_MAX_AGE_MS } from '@/lib/gallerySession';
import {
  checkGalleryWritable,
  decideIdentify,
  loadGalleryViewAccess,
  MAX_PARTICIPANTS_PER_GALLERY,
} from '@/lib/galleryAccess';

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
// הערה: אין כאן גורם אימות שני לבעלים - כל מי שמחזיק בקוד ונכנס ראשון
// מדפדפן חדש יכול ללחוץ "זאת אני". זה מחוץ להיקף של ה-route הזה.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);

  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  let body: { asOwner?: boolean; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('id, owner_participant_id, status, expires_at, delivered_at')
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

    const { data: guest, error } = await supabaseAdmin
      .from('gallery_participants')
      .insert({ gallery_id: galleryId, display_name: trimmed, is_owner: false })
      .select('id, display_name')
      .single();

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
