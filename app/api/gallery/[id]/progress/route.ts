import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { resolveGalleryViewAccess } from '@/lib/galleryAccess';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { countBillableSelected } from '@/lib/gifts';
import { computeClientProgress } from '@/lib/clientProgress';
import { computeClientPayAmount, EMPTY_PAYMENT_LINKS, hasAnyPaymentLink, normalizePaymentLinks } from '@/lib/paymentLinks';

// "מה הבא?" ללקוחה אחרי הבחירה (components/ClientProgressTracker.tsx) + קישורי
// התשלום של הצלמת על התוספת (components/ClientPayButton.tsx).
//
// endpoint נפרד וקל בכוונה, ולא GET /api/gallery/[id] הראשי: הקומפוננטה מרעננת
// אותו בכל פעם שהעמוד חוזר לפוקוס, והראשי חותם URL לכל תמונה ומגדיל את מונה
// הצפיות - כאן רק כמה שדות. חושף ללקוחה רק דגלים (editingStarted/delivered)
// ותאריך מסירה, לא תאריכים פנימיים אחרים.
//
// service_role - נשאר בצד שרת בלבד, כמו שאר ה-API של הגלריה.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);
  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, status, expires_at, delivered_at, editing_started_at, reopened_for_selection_at, owner_participant_id, paid_at, amount_due_override, photographer_id')
    .eq('id', galleryId)
    .single();

  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const { count: deliveredCount } = await supabaseAdmin
    .from('delivered_photos')
    .select('id', { count: 'exact', head: true })
    .eq('gallery_id', galleryId);
  const hasDeliveredPhotos = (deliveredCount ?? 0) > 0;

  const access = resolveGalleryViewAccess(gallery, hasDeliveredPhotos);
  if (!access.ok) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  const editingStarted = !!gallery.editing_started_at;
  const delivered = !!gallery.delivered_at || hasDeliveredPhotos;
  const progress = computeClientProgress({
    status: gallery.status,
    reopenedForSelection: !!gallery.reopened_for_selection_at,
    editingStarted,
    delivered,
  });

  // תשלום על התוספת - רק לבעלים (החשבון שלה), ורק אם הצלמת הגדירה קישורים.
  // עמודות חסרות (מיגרציה שלא רצה) = אין קישורים, בלי להפיל את הבקשה.
  // settled = הגלריה סומנה כשולמה (paid_at) - גם סכום שמחושב בדפדפן לא יוצג אז.
  let payment: { amount: number; settled: boolean; links: typeof EMPTY_PAYMENT_LINKS } | null = null;
  const isOwner = !!session.participantId && session.participantId === gallery.owner_participant_id;
  if (isOwner) {
    let links = EMPTY_PAYMENT_LINKS;
    try {
      const { data: photographerRow, error } = await supabaseAdmin
        .from('photographers')
        .select('payment_bit_url, payment_paybox_url, payment_bank_details')
        .eq('id', gallery.photographer_id)
        .maybeSingle();
      if (!error) links = normalizePaymentLinks(photographerRow);
    } catch {
      // בכוונה שקט - ראו הערה למעלה
    }

    if (hasAnyPaymentLink(links)) {
      const [{ data: selectionsData }, { data: packageData }, { data: paymentsData }, gifts] = await Promise.all([
        supabaseAdmin
          .from('selections')
          .select('photo_id, status')
          .eq('gallery_id', galleryId)
          .eq('participant_id', gallery.owner_participant_id),
        supabaseAdmin.from('packages').select('included_photos, extra_photo_price, base_price').eq('gallery_id', galleryId).maybeSingle(),
        supabaseAdmin.from('gallery_payments').select('amount').eq('gallery_id', galleryId),
        fetchGiftPhotos(supabaseAdmin, [galleryId]),
      ]);
      const amount = computeClientPayAmount({
        pkg: packageData,
        billableSelectedCount: countBillableSelected(selectionsData ?? [], gifts.map((g) => g.id)),
        amountDueOverride: gallery.amount_due_override,
        payments: paymentsData ?? [],
        paidAt: gallery.paid_at,
      });
      payment = { amount, settled: !!gallery.paid_at, links };
    }
  }

  return NextResponse.json({
    status: gallery.status,
    editingStarted,
    delivered,
    deliveredAt: gallery.delivered_at ?? null,
    deliveredCount: deliveredCount ?? 0,
    progress,
    payment,
  });
}
