import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { sendExtensionRequestedEmail } from '@/lib/email';
import { fetchClientGender } from '@/lib/gender';
import {
  decideNewExtensionRequest,
  isMissingTableError,
  parseRequestedDays,
  summarizeExtensionRequests,
  type ExtensionRequestRow,
} from '@/lib/extensionRequests';

// service_role - הלקוחה לא ניגשת לטבלה ישירות (אין לה policy). כל בקשה
// עוברת קודם את בדיקת עוגיית הגלריה (requireGallerySession) ואת בדיקת
// הבעלים (participant == owner_participant_id), כמו app/api/gallery/[id]/finish.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const UNAVAILABLE = { available: false, requestsUsed: 0, maxRequests: 2, pending: null, lastDecision: null };

async function loadRequests(galleryId: string): Promise<{ rows: ExtensionRequestRow[] } | { missing: true } | { failed: true }> {
  const { data, error } = await supabaseAdmin
    .from('gallery_extension_requests')
    .select('id, requested_days, status, created_at, decided_at')
    .eq('gallery_id', galleryId);
  if (error) return isMissingTableError(error) ? { missing: true } : { failed: true };
  return { rows: (data ?? []) as ExtensionRequestRow[] };
}

// מצב הבקשות לבאנר בגלריה: כמה נוצלו, האם יש ממתינה, ומה הוחלט לאחרונה.
// available=false (טבלה חסרה / שגיאה) = הממשק פשוט מסתיר את הכפתור.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = requireGallerySession(req, params.id);
  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const result = await loadRequests(params.id);
  if (!('rows' in result)) {
    return NextResponse.json(UNAVAILABLE);
  }
  return NextResponse.json({ available: true, ...summarizeExtensionRequests(result.rows) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);
  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  let body: { days?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }
  const parsedDays = parseRequestedDays(body?.days);
  if (!parsedDays.ok) {
    return NextResponse.json({ error: parsedDays.error }, { status: 400 });
  }

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('id, status, expires_at, reopened_for_selection_at, delivered_at, photographer_id, owner_participant_id, clients(full_name)')
    .eq('id', galleryId)
    .single();
  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // session בלי זהות (null) או גלריה בלי בעלים (null) - בלי הבדיקה המפורשת,
  // null === null היה עובר כ"בעלים" (אותו דפוס כמו finish).
  const isOwner =
    !!session.participantId && !!gallery.owner_participant_id && session.participantId === gallery.owner_participant_id;

  const existing = await loadRequests(galleryId);
  if ('missing' in existing) {
    return NextResponse.json({ error: 'בקשת הארכה עוד לא זמינה בגלריה הזו' }, { status: 503 });
  }
  if ('failed' in existing) {
    return NextResponse.json({ error: 'שליחת הבקשה נכשלה, נסי שוב' }, { status: 500 });
  }
  const summary = summarizeExtensionRequests(existing.rows);

  const decision = decideNewExtensionRequest({
    gallery,
    isOwner,
    requestsUsed: summary.requestsUsed,
    hasPending: !!summary.pending,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.httpStatus });
  }

  // שתי בקשות מקבילות: האינדקס הייחודי gallery_extension_requests_one_pending
  // (שורה pending אחת לגלריה) מאפשר רק לאחת להיכנס - וכיוון שתמיד יש לכל
  // היותר אחת ממתינה, הספירה לא יכולה לעבור את המקסימום גם במירוץ.
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('gallery_extension_requests')
    .insert({ gallery_id: galleryId, participant_id: session.participantId, requested_days: parsedDays.days })
    .select('id, requested_days, status, created_at, decided_at')
    .single();
  if (insertError?.code === '23505') {
    return NextResponse.json({ error: 'כבר שלחת בקשת הארכה - הצלמת תעדכן אותך בקרוב' }, { status: 409 });
  }
  if (insertError || !inserted) {
    return NextResponse.json({ error: 'שליחת הבקשה נכשלה, נסי שוב' }, { status: 500 });
  }

  // best-effort: התראה לצלמת. הבקשה כבר נשמרה ומוצגת בדף העריכה גם אם המייל נכשל.
  try {
    const { data: photographer } = await supabaseAdmin
      .from('photographers')
      .select('auth_user_id')
      .eq('id', gallery.photographer_id)
      .single();
    if (photographer?.auth_user_id) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(photographer.auth_user_id);
      const photographerEmail = authUser?.user?.email;
      if (photographerEmail) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
        await sendExtensionRequestedEmail({
          to: photographerEmail,
          clientName: (gallery as any).clients?.full_name ?? 'לקוחה',
          clientGender: await fetchClientGender(supabaseAdmin, galleryId),
          days: parsedDays.days,
          currentExpiresAt: gallery.expires_at,
          dashboardUrl: `${siteUrl}/dashboard/galleries/${galleryId}/edit`,
        });
      }
    }
  } catch (err) {
    console.error('[extension-request] שליחת מייל לצלמת נכשלה:', err);
  }

  return NextResponse.json({
    available: true,
    ...summarizeExtensionRequests([...existing.rows, inserted as ExtensionRequestRow]),
  });
}
