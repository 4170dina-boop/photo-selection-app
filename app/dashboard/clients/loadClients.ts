import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { fetchAllPages } from '@/lib/fetchAllPages';
import { giftExclusionFilter, groupGiftIdsByGallery } from '@/lib/gifts';
import { computePaymentSummary, type PaymentSummary } from '@/lib/payments';
import { israelDateString } from '@/lib/israelTime';
import { buildClientSummaries, type ClientSummary } from '@/lib/clientGroups';

// טעינת הנתונים המשותפת לרשימת הלקוחות ולדף הלקוחה. רץ בדפדפן עם ה-client של
// session הצלמת (lib/supabase/client) - RLS מגביל לנתונים שלה, כמו
// app/dashboard/galleries/page.tsx. קריאה בלבד.

export interface ClientGallery {
  id: string;
  client_id: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  last_activity_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  paid_at: string | null;
  owner_participant_id: string | null;
  amount_due_override: number | null;
  packages: { included_photos: number; base_price: number; extra_photo_price: number } | null;
  gallery_payments: { amount: number }[] | null;
  selectedCount: number;
  summary: PaymentSummary;
}

export interface ClientShoot {
  id: string;
  client_id: string;
  gallery_id: string | null;
  shoot_date: string;
  start_time: string;
  location: string;
  created_at: string | null;
}

export interface ClientsData {
  clients: ClientSummary[];
  galleries: Map<string, ClientGallery>;
  shoots: Map<string, ClientShoot>;
}

export async function loadClientsData(supabase: SupabaseClient): Promise<ClientsData> {
  // pagination (lib/fetchAllPages.ts) - PostgREST חותך כל שאילתה ב-1000 שורות,
  // וצלמת ותיקה עם יותר לקוחות/גלריות/צילומים הייתה רואה רשימה חסרה בשקט.
  // order משני לפי id כדי שהעמודים יהיו יציבים (בלי חפיפות/דילוגים).
  // שגיאה ב-clients/galleries מפילה את הדף (אחרת זה נראה כמו "אין לקוחות").
  // shoots - best-effort: אם המיגרציה של יומן הצילומים עוד לא רצה, ממשיכים בלעדיו.
  const [clientsRows, rawGalleries, shoots] = await Promise.all([
    fetchAllPages<any>((from, to) =>
      supabase
        .from('clients')
        .select('id, full_name, email, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ).catch((error) => {
      throw new Error(error?.message ?? String(error));
    }),
    fetchAllPages<any>((from, to) =>
      supabase
        .from('galleries')
        .select('id, client_id, status, created_at, expires_at, last_activity_at, sent_at, delivered_at, paid_at, owner_participant_id, amount_due_override, packages(included_photos, base_price, extra_photo_price), gallery_payments(amount)')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ).catch((error) => {
      throw new Error(error?.message ?? String(error));
    }),
    fetchAllPages<ClientShoot>((from, to) =>
      supabase
        .from('shoots')
        .select('id, client_id, gallery_id, shoot_date, start_time, location, created_at')
        .order('shoot_date', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ).catch((error) => {
      console.warn('[clients] טעינת הצילומים נכשלה - ממשיכים בלעדיהם:', error);
      return [] as ClientShoot[];
    }),
  ]);

  // ספירת הבחירות לחיוב - בדיוק כמו app/dashboard/galleries/page.tsx: רק של
  // הבעלים, סטטוס 'selected', בלי תמונות מתנה (lib/gifts.ts).
  const giftIdsByGallery = groupGiftIdsByGallery(await fetchGiftPhotos(supabase, rawGalleries.map((g) => g.id)));
  const galleries: ClientGallery[] = await Promise.all(
    rawGalleries.map(async (g) => {
      let query = supabase
        .from('selections')
        .select('*', { count: 'exact', head: true })
        .eq('gallery_id', g.id)
        .eq('participant_id', g.owner_participant_id)
        .eq('status', 'selected');
      const giftFilter = giftExclusionFilter(giftIdsByGallery.get(g.id) ?? []);
      if (giftFilter) query = query.not('photo_id', 'in', giftFilter);
      const { count } = await query;
      const selectedCount = count ?? 0;

      const summary = computePaymentSummary({
        pkg: g.packages,
        selectedCount,
        amountDueOverride: g.amount_due_override,
        payments: g.gallery_payments,
        paidAt: g.paid_at,
      });
      return { ...g, selectedCount, summary } as ClientGallery;
    })
  );

  const clients = buildClientSummaries({
    clients: clientsRows,
    galleries: galleries.map((g) => ({ ...g, paid: g.summary.paid, outstanding: g.summary.outstanding })),
    shoots,
    todayDate: israelDateString(new Date()),
  });

  return {
    clients,
    galleries: new Map(galleries.map((g) => [g.id, g])),
    shoots: new Map(shoots.map((s) => [s.id, s])),
  };
}

export function clientHref(key: string): string {
  return `/dashboard/clients/${encodeURIComponent(key)}`;
}

export function newGalleryHref(c: { name: string; email: string }): string {
  return `/dashboard/galleries/new?${new URLSearchParams({ name: c.name, email: c.email }).toString()}`;
}

export function newShootHref(c: { name: string; email: string }): string {
  return `/dashboard/calendar?${new URLSearchParams({ name: c.name, email: c.email }).toString()}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  // תאריך בלבד (shoot_date) - בלי המרת אזור זמן
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${Number(d)}.${Number(m)}.${y}`;
  }
  return new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
}
