import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { giftExclusionFilter } from '@/lib/gifts';
import { computePaymentSummary, nextPaidAt, type PaymentChange, type PaymentSummary } from '@/lib/payments';

// עזרי DB למעקב תשלומים (app/api/galleries/[id]/payments/*) - רץ תמיד עם
// session הצלם (createClient מ-lib/supabase/server), כך שגם ה-RLS על
// gallery_payments וגם בדיקת הבעלות המפורשת כאן (אותו דפוס כמו
// app/api/galleries/[id]/toggle-paid/route.ts) חלים. הלוגיקה הטהורה עצמה
// (חישוב יתרה, מתי paid_at מסומן) נמצאת ב-lib/payments.ts.

export interface GalleryPaymentRow {
  id: string;
  amount: number;
  paid_on: string;
  method: string | null;
  note: string | null;
  created_at: string;
}

export interface PaymentsState {
  payments: GalleryPaymentRow[];
  summary: PaymentSummary;
  amountDueOverride: number | null;
  paidAt: string | null;
}

interface OwnedGallery {
  id: string;
  paid_at: string | null;
  amount_due_override: number | string | null;
  owner_participant_id: string | null;
}

export async function loadOwnedGalleryForPayments(
  supabase: SupabaseClient,
  galleryId: string,
  authUserId: string
): Promise<OwnedGallery | null> {
  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('auth_user_id', authUserId)
    .single();

  if (!photographer) return null;

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, paid_at, amount_due_override, owner_participant_id')
    .eq('id', galleryId)
    .eq('photographer_id', photographer.id)
    .single();

  return (gallery as OwnedGallery | null) ?? null;
}

// טוען את רשימת התשלומים + מחשב סיכום. הסכום האוטומטי סופר רק בחירות
// 'selected' של הבעלים - בדיוק כמו רשימת הגלריות ודוח ההכנסות (קלט של בני
// משפחה אחרים בשיתוף גלריה משפחתי לא נספר לחיוב).
export async function loadPaymentsState(
  supabase: SupabaseClient,
  gallery: OwnedGallery
): Promise<PaymentsState | null> {
  // תמונות מתנה לא נספרות כתמונות נוספות לחיוב (ראו lib/gifts.ts)
  const giftFilter = giftExclusionFilter((await fetchGiftPhotos(supabase, [gallery.id])).map((g) => g.id));
  const [{ data: payments, error: paymentsError }, { data: pkg }, { count }] = await Promise.all([
    supabase
      .from('gallery_payments')
      .select('id, amount, paid_on, method, note, created_at')
      .eq('gallery_id', gallery.id)
      .order('paid_on', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('packages')
      .select('included_photos, base_price, extra_photo_price')
      .eq('gallery_id', gallery.id)
      .maybeSingle(),
    gallery.owner_participant_id
      ? (() => {
          let q = supabase
            .from('selections')
            .select('*', { count: 'exact', head: true })
            .eq('gallery_id', gallery.id)
            .eq('participant_id', gallery.owner_participant_id)
            .eq('status', 'selected');
          if (giftFilter) q = q.not('photo_id', 'in', giftFilter);
          return q;
        })()
      : Promise.resolve({ count: 0 }),
  ]);

  if (paymentsError) return null;

  const rows: GalleryPaymentRow[] = (payments ?? []).map((p: any) => ({ ...p, amount: Number(p.amount) }));
  const amountDueOverride = gallery.amount_due_override == null ? null : Number(gallery.amount_due_override);

  return {
    payments: rows,
    amountDueOverride,
    paidAt: gallery.paid_at,
    summary: computePaymentSummary({
      pkg,
      selectedCount: count ?? 0,
      amountDueOverride,
      payments: rows,
      paidAt: gallery.paid_at,
    }),
  };
}

// אחרי כל שינוי (הוספה/מחיקה של תשלום, שינוי הסכום לתשלום): טוען מחדש,
// מעדכן את paid_at לפי הכלל ב-nextPaidAt, ומחזיר את המצב העדכני לדפדפן.
export async function syncPaidAtAndLoad(
  supabase: SupabaseClient,
  gallery: OwnedGallery,
  change: PaymentChange
): Promise<PaymentsState | null> {
  const state = await loadPaymentsState(supabase, gallery);
  if (!state) return null;

  const newPaidAt = nextPaidAt(gallery.paid_at, state.summary, change, new Date().toISOString());
  if (newPaidAt === gallery.paid_at) return state;

  const { error } = await supabase.from('galleries').update({ paid_at: newPaidAt }).eq('id', gallery.id);
  if (error) return state;

  // מחשבים שוב את outstanding (תלוי ב-paid_at) - שאר הסיכום לא משתנה
  return {
    ...state,
    paidAt: newPaidAt,
    summary: { ...state.summary, outstanding: newPaidAt ? 0 : Math.max(0, state.summary.balance) },
  };
}

// לקריאה מ-routes שמשנים את הסכום לתשלום בעקיפין (בחירה של הלקוחה, סימון
// מתנה, עריכת החבילה): מסנכרן את paid_at רק כשיש לגלריה לפחות תשלום רשום
// אחד (בלי תשלומים nextPaidAt ממילא לא נוגע בו), ורק כשאין דריסה ידנית של
// הסכום (אז הסכום לא השתנה בכלל). best-effort - לעולם לא זורק, רק רושם ללוג,
// כדי לא להכשיל את הבקשה העיקרית שכבר הצליחה.
export async function syncPaidAtAfterTotalChange(supabase: SupabaseClient, galleryId: string): Promise<void> {
  try {
    const { count, error: countError } = await supabase
      .from('gallery_payments')
      .select('id', { count: 'exact', head: true })
      .eq('gallery_id', galleryId);
    if (countError) throw countError;
    if (!count) return;

    const { data: gallery, error: galleryError } = await supabase
      .from('galleries')
      .select('id, paid_at, amount_due_override, owner_participant_id')
      .eq('id', galleryId)
      .single();
    if (galleryError || !gallery) throw galleryError ?? new Error('gallery not found');
    if (gallery.amount_due_override != null) return;

    await syncPaidAtAndLoad(supabase, gallery as OwnedGallery, 'total_changed');
  } catch (err) {
    console.error('[payments] סנכרון paid_at אחרי שינוי בסכום נכשל:', err);
  }
}
