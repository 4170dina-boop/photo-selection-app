import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { giftExclusionFilter } from '@/lib/gifts';
import {
  computePaymentSummary,
  nextPaidAt,
  paidAtAfterTotalChange,
  type PaymentChange,
  type PaymentSummary,
} from '@/lib/payments';

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
  // "איך נוח לך לשלם?" - מה שהלקוחה בחרה (lib/paymentMethods.ts), null = עוד לא
  // בחרה או שהמיגרציה לא רצה
  clientPaymentChoice: string | null;
  clientPaymentChoiceAt: string | null;
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
  const [{ data: payments, error: paymentsError }, { data: pkg }, { count }, choiceRes] = await Promise.all([
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
    // best-effort, שאילתה נפרדת - עמודה חסרה (מיגרציה שלא רצה) = בלי בחירה
    supabase
      .from('galleries')
      .select('client_payment_choice, client_payment_choice_at')
      .eq('id', gallery.id)
      .maybeSingle()
      .then(
        (r: { data: any; error: unknown }) => r,
        () => ({ data: null, error: true })
      ),
  ]);

  if (paymentsError) return null;

  const rows: GalleryPaymentRow[] = (payments ?? []).map((p: any) => ({ ...p, amount: Number(p.amount) }));
  const amountDueOverride = gallery.amount_due_override == null ? null : Number(gallery.amount_due_override);

  return {
    payments: rows,
    amountDueOverride,
    paidAt: gallery.paid_at,
    clientPaymentChoice: choiceRes.error ? null : choiceRes.data?.client_payment_choice ?? null,
    clientPaymentChoiceAt: choiceRes.error ? null : choiceRes.data?.client_payment_choice_at ?? null,
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
// מתנה, עריכת החבילה), בשני שלבים: captureAmountDueBefore *לפני* השינוי, ו-
// syncPaidAtAfterTotalChange אחריו עם התוצאה. מסנכרנים רק כשיש לגלריה לפחות
// תשלום רשום אחד, כשאין דריסה ידנית של הסכום (אז הסכום לא משתנה בכלל), ורק אם
// הסכום באמת השתנה - ואז רק מסמנים "שולם", אף פעם לא מבטלים (ראו
// paidAtAfterTotalChange ב-lib/payments.ts). best-effort - לעולם לא זורקות, רק
// רושמות ללוג, כדי לא להכשיל את הבקשה העיקרית.
export interface AmountDueSnapshot {
  galleryId: string;
  total: number;
}

// null = אין מה לסנכרן (אין תשלומים / דריסה ידנית / לא הבעלים / שגיאה).
// ownerParticipantId: כשנמסר, רק בחירות של הבעלים נספרות לחיוב - בן משפחה
// אחר לא משנה את הסכום, וחוסכים את השאילתות.
export async function captureAmountDueBefore(
  supabase: SupabaseClient,
  galleryId: string,
  ownerParticipantId?: string
): Promise<AmountDueSnapshot | null> {
  try {
    const { count, error: countError } = await supabase
      .from('gallery_payments')
      .select('id', { count: 'exact', head: true })
      .eq('gallery_id', galleryId);
    if (countError) throw countError;
    if (!count) return null;

    const gallery = await loadGalleryForTotalSync(supabase, galleryId);
    if (!gallery) return null;
    if (ownerParticipantId !== undefined && gallery.owner_participant_id !== ownerParticipantId) return null;

    const state = await loadPaymentsState(supabase, gallery);
    return state ? { galleryId, total: state.summary.total } : null;
  } catch (err) {
    console.error('[payments] קריאת הסכום לתשלום לפני שינוי נכשלה:', err);
    return null;
  }
}

export async function syncPaidAtAfterTotalChange(supabase: SupabaseClient, before: AmountDueSnapshot | null): Promise<void> {
  if (!before) return;
  try {
    const gallery = await loadGalleryForTotalSync(supabase, before.galleryId);
    if (!gallery) return;

    const state = await loadPaymentsState(supabase, gallery);
    if (!state) return;

    const newPaidAt = paidAtAfterTotalChange(gallery.paid_at, before.total, state.summary, new Date().toISOString());
    if (newPaidAt === gallery.paid_at) return;

    // מותנה ב-paid_at שנקרא - לא דורסים סימון ידני שנעשה בינתיים
    const { error } = await supabase
      .from('galleries')
      .update({ paid_at: newPaidAt })
      .eq('id', gallery.id)
      .is('paid_at', null);
    if (error) throw error;
  } catch (err) {
    console.error('[payments] סנכרון paid_at אחרי שינוי בסכום נכשל:', err);
  }
}

// הגלריה לסנכרון, או null כשיש דריסה ידנית של הסכום (אז שינוי עקיף לא משנה אותו).
async function loadGalleryForTotalSync(supabase: SupabaseClient, galleryId: string): Promise<OwnedGallery | null> {
  const { data: gallery, error } = await supabase
    .from('galleries')
    .select('id, paid_at, amount_due_override, owner_participant_id')
    .eq('id', galleryId)
    .single();
  if (error || !gallery) throw error ?? new Error('gallery not found');
  if (gallery.amount_due_override != null) return null;
  return gallery as OwnedGallery;
}
