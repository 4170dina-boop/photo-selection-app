import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { signSession } from '@/lib/session';
import { SESSION_MAX_AGE_MS } from '@/lib/gallerySession';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const DISPLAY_NAME_MAX_LENGTH = 40;

// שיתוף גלריה משפחתי, שלב 2: אחרי שקוד הגישה כבר אומת (verify-access) אבל
// עדיין לא ידוע "מי בפועל נכנס/ת" - הבעלים הרשומה עצמה, או בן משפחה אחר עם
// אותו קוד. הלקוח שולח asOwner=true (הבעלים לוחצת "זאת אני") או displayName
// (מישהי אחרת מקלידה את השם שלה) - כאן מחליטים לאיזה participant לשייך את
// ה-session, וחותמים session חדש עם participantId קבוע.
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
    .select('id, owner_participant_id')
    .eq('id', galleryId)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  let participantId: string;
  let displayName: string;
  let isOwner: boolean;

  if (body.asOwner) {
    if (!gallery.owner_participant_id) {
      return NextResponse.json({ error: 'לא נמצא בעלים לגלריה' }, { status: 500 });
    }

    const { data: owner } = await supabaseAdmin
      .from('gallery_participants')
      .select('display_name')
      .eq('id', gallery.owner_participant_id)
      .single();

    participantId = gallery.owner_participant_id;
    displayName = owner?.display_name ?? '';
    isOwner = true;
  } else {
    const trimmed = (body.displayName ?? '').trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'צריך למלא שם' }, { status: 400 });
    }
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      return NextResponse.json({ error: `השם ארוך מדי (מקסימום ${DISPLAY_NAME_MAX_LENGTH} תווים)` }, { status: 400 });
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
    participantId,
    iat: Date.now(),
  });

  const response = NextResponse.json({ success: true, displayName, isOwner });
  response.cookies.set(`gallery_session_${galleryId}`, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS / 1000,
    path: '/',
  });

  return response;
}
