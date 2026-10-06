import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { resolveGalleryViewAccess } from '@/lib/galleryAccess';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { countBillableSelected } from '@/lib/gifts';
import { computeClientProgress } from '@/lib/clientProgress';
import { computeClientPayAmount } from '@/lib/paymentLinks';
import { clientPaymentMethods, isPaymentMethodType, type PaymentMethod, type PaymentMethodType } from '@/lib/paymentMethods';
import { loadPaymentMethods } from '@/lib/paymentMethodsQuery';

// "מה הבא?" ללקוחה אחרי הבחירה (components/ClientProgressTracker.tsx) + אמצעי
// התשלום של הצלמת ובחירת הלקוחה (components/ClientPayButton.tsx, lib/paymentMethods.ts).
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

  // תשלום - רק לבעלים (החשבון שלה), ורק אם הצלמת הפעילה לפחות אמצעי תשלום
  // אחד (lib/paymentMethods.ts). עמודות חסרות (מיגרציה שלא רצה) = נגזר מהעמודות
  // הישנות / אין אמצעים, בלי להפיל את הבקשה. settled = הגלריה סומנה כשולמה
  // (paid_at) - גם סכום שמחושב בדפדפן לא יוצג אז. choice = מה שהלקוחה כבר בחרה.
  let payment: { amount: number; settled: boolean; methods: PaymentMethod[]; choice: PaymentMethodType | null } | null = null;
  const isOwner = !!session.participantId && session.participantId === gallery.owner_participant_id;
  if (isOwner) {
    const methods = clientPaymentMethods((await loadPaymentMethods(supabaseAdmin, gallery.photographer_id)).methods);

    if (methods.length > 0) {
      const [{ data: selectionsData }, { data: packageData }, { data: paymentsData }, gifts, choiceRes] = await Promise.all([
        supabaseAdmin
          .from('selections')
          .select('photo_id, status')
          .eq('gallery_id', galleryId)
          .eq('participant_id', gallery.owner_participant_id),
        supabaseAdmin.from('packages').select('included_photos, extra_photo_price, base_price').eq('gallery_id', galleryId).maybeSingle(),
        supabaseAdmin.from('gallery_payments').select('amount').eq('gallery_id', galleryId),
        fetchGiftPhotos(supabaseAdmin, [galleryId]),
        // best-effort - עמודה חסרה = עוד לא בחרה
        supabaseAdmin.from('galleries').select('client_payment_choice').eq('id', galleryId).maybeSingle(),
      ]);
      const amount = computeClientPayAmount({
        pkg: packageData,
        billableSelectedCount: countBillableSelected(selectionsData ?? [], gifts.map((g) => g.id)),
        amountDueOverride: gallery.amount_due_override,
        payments: paymentsData ?? [],
        paidAt: gallery.paid_at,
      });
      const rawChoice = choiceRes.error ? null : choiceRes.data?.client_payment_choice;
      payment = { amount, settled: !!gallery.paid_at, methods, choice: isPaymentMethodType(rawChoice) ? rawChoice : null };
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
