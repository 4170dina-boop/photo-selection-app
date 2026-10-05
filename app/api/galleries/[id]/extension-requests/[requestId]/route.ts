import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendExtensionDecisionEmail } from '@/lib/email';
import { planExtensionApproval } from '@/lib/extensionRequests';
import { STATUS_GUARDED_UPDATE_MAX_ATTEMPTS } from '@/lib/galleryLifecycle';
import { applyRowGuard } from '@/lib/rowGuard';

// אישור/דחייה של בקשת הארכה (body: { action: 'approve' | 'decline' }).
// רץ עם session הצלמת (RLS), אותו דפוס בעלות כמו app/api/galleries/[id]/route.ts.
//
// אישור: קודם "תופסים" את הבקשה (pending -> approved, UPDATE מותנה) - כך
// שלחיצה כפולה/שתי לשוניות לא מאריכות פעמיים. אחר כך מאריכים את התוקף ב-N
// ימים מ-max(עכשיו, התוקף הנוכחי) ומחזירים לפעילה גלריה שה-cron כבר סימן
// expired (planExtensionApproval), ב-UPDATE מותנה ב-status+expires_at שנקראו
// עם ניסיונות חוזרים - כמו ה-PATCH של עריכת הגלריה. אם עדכון הגלריה נכשל,
// הבקשה חוזרת ל-pending כדי שאפשר יהיה לנסות שוב.
export async function POST(req: NextRequest, { params }: { params: { id: string; requestId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }
  const action = body?.action;
  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json({ error: 'פעולה לא תקינה' }, { status: 400 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name')
    .eq('auth_user_id', user.id)
    .single();
  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, status, expires_at, owner_participant_id, clients(full_name, email)')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();
  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const { data: request } = await supabase
    .from('gallery_extension_requests')
    .select('id, requested_days, status')
    .eq('id', params.requestId)
    .eq('gallery_id', gallery.id)
    .single();
  if (!request) {
    return NextResponse.json({ error: 'הבקשה לא נמצאה' }, { status: 404 });
  }
  if (request.status !== 'pending') {
    return NextResponse.json({ error: 'כבר הוחלט על הבקשה הזו - רענני את הדף' }, { status: 409 });
  }

  const decidedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('gallery_extension_requests')
    .update({ status: action === 'approve' ? 'approved' : 'declined', decided_at: decidedAt })
    .eq('id', request.id)
    .eq('status', 'pending')
    .select('id');
  if (claimError) {
    return NextResponse.json({ error: 'עדכון הבקשה נכשל' }, { status: 500 });
  }
  if (!claimed?.length) {
    return NextResponse.json({ error: 'כבר הוחלט על הבקשה הזו - רענני את הדף' }, { status: 409 });
  }

  const clientName = (gallery as any).clients?.full_name ?? '';
  const clientEmail = (gallery as any).clients?.email as string | undefined;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const galleryUrl = `${siteUrl}/gallery/${gallery.id}`;

  if (action === 'decline') {
    if (clientEmail) {
      // best-effort - הדחייה כבר נשמרה
      await sendExtensionDecisionEmail({
        to: clientEmail,
        clientName,
        businessName: photographer.business_name ?? '',
        galleryUrl,
        approved: false,
        replyTo: user.email ?? undefined,
      }).catch(() => {});
    }
    return NextResponse.json({ success: true, status: 'declined' });
  }

  // מחזירה את הבקשה ל-pending (רק אם עדיין approved מהתפיסה שלנו)
  const releaseClaim = () =>
    supabase
      .from('gallery_extension_requests')
      .update({ status: 'pending', decided_at: null })
      .eq('id', request.id)
      .eq('status', 'approved')
      .then(() => {}, () => {});

  let current: { status: string | null; expires_at: string | null; owner_participant_id: string | null } = gallery;
  let plan: ReturnType<typeof planExtensionApproval> | null = null;
  let galleryError: { message?: string } | null = null;
  let galleryUpdated = false;
  for (let attempt = 0; attempt < STATUS_GUARDED_UPDATE_MAX_ATTEMPTS; attempt++) {
    let ownerHasSelections = false;
    if (current.status === 'expired' && current.owner_participant_id) {
      const { count, error: countError } = await supabase
        .from('selections')
        .select('id', { count: 'exact', head: true })
        .eq('gallery_id', gallery.id)
        .eq('participant_id', current.owner_participant_id);
      if (countError) {
        await releaseClaim();
        return NextResponse.json({ error: 'בדיקת הבחירות של הלקוחה נכשלה' }, { status: 500 });
      }
      ownerHasSelections = (count ?? 0) > 0;
    }
    plan = planExtensionApproval({
      status: current.status,
      expiresAt: current.expires_at,
      days: request.requested_days,
      ownerHasSelections,
      now: new Date(),
    });

    const { data: updatedRows, error } = await applyRowGuard(
      supabase
        .from('galleries')
        .update({
          expires_at: plan.newExpiresAt,
          // תאריך חדש = תזכורת התפוגה (cron/tick) צריכה לצאת שוב לפי התאריך החדש
          last_reminder_sent_at: null,
          ...(plan.reactivatedStatus ? { status: plan.reactivatedStatus } : {}),
        })
        .eq('id', gallery.id),
      plan.guard
    ).select('id');
    if (error) {
      galleryError = error;
      break;
    }
    if (updatedRows?.length) {
      galleryUpdated = true;
      break;
    }

    const { data: fresh } = await supabase
      .from('galleries')
      .select('status, expires_at, owner_participant_id')
      .eq('id', gallery.id)
      .single();
    if (!fresh) {
      await releaseClaim();
      return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
    }
    current = fresh;
  }

  if (!galleryUpdated || !plan) {
    await releaseClaim();
    if (galleryError?.message?.includes('LIMIT_ACTIVE_GALLERY')) {
      return NextResponse.json(
        {
          error:
            'בחשבון חינמי אפשר רק גלריה פעילה אחת, והארכת התוקף מחזירה את הגלריה הזו לפעילה. השלימי או מחקי את הגלריה הפעילה האחרת ונסי שוב.',
        },
        { status: 402 }
      );
    }
    if (galleryError) {
      return NextResponse.json({ error: 'הארכת התוקף נכשלה' }, { status: 500 });
    }
    return NextResponse.json({ error: 'הגלריה השתנתה בזמן השמירה - רענני את הדף ונסי שוב' }, { status: 409 });
  }

  let emailSent = false;
  if (clientEmail) {
    const result = await sendExtensionDecisionEmail({
      to: clientEmail,
      clientName,
      businessName: photographer.business_name ?? '',
      galleryUrl,
      approved: true,
      newExpiresAt: plan.newExpiresAt,
      replyTo: user.email ?? undefined,
    }).catch(() => ({ sent: false }));
    emailSent = result.sent;
  }

  return NextResponse.json({
    success: true,
    status: 'approved',
    expiresAt: plan.newExpiresAt,
    galleryStatus: plan.reactivatedStatus ?? current.status,
    emailSent,
  });
}
