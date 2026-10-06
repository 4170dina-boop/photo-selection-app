import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { giftExclusionFilter, groupGiftIdsByGallery } from '@/lib/gifts';
import { computePaymentSummary } from '@/lib/payments';
import { isPaymentMethodType } from '@/lib/paymentMethods';
import { mapWithConcurrency } from '@/lib/concurrency';
import { sortShoots, todayAndTomorrow, type TodayGalleryRow, type TodayShoot } from '@/lib/todayDashboard';

// כל הנתונים של מסך "היום" (app/dashboard/today/page.tsx) בקריאה אחת: הגלריות
// של הצלמת עם ספירת בחירות ויתרה לתשלום, בקשות הארכה ממתינות, וצילומי היום
// ומחר. השיוך למקטעים עצמו נעשה בדפדפן (buildTodayView ב-lib/todayDashboard.ts),
// כדי שעדכון אופטימי אחרי פעולה מהירה יעביר שורה בין מקטעים בלי טעינה מחדש.
//
// רץ עם session הצלמת (RLS) ובנוסף מסנן במפורש לפי photographer_id - אותו
// דפוס בעלות כמו app/api/galleries/cover-photos/route.ts.

// ספירה נפרדת לכל גלריה (head + count, כמו ברשימת הגלריות) - במקביל עם תקרה
const COUNT_QUERY_CONCURRENCY = 8;

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const [today, tomorrow] = todayAndTomorrow(new Date());

  const [galleriesRes, extensionRes, shootsRes] = await Promise.all([
    supabase
      .from('galleries')
      .select(
        'id, status, created_at, sent_at, expires_at, last_activity_at, last_viewed_at, editing_started_at, delivered_at, reopened_for_selection_at, paid_at, owner_participant_id, amount_due_override, clients(full_name), packages(included_photos, base_price, extra_photo_price), gallery_payments(amount)'
      )
      .eq('photographer_id', photographer.id)
      .order('created_at', { ascending: false }),
    // RLS כבר מגביל לבקשות של הגלריות שלה; בנוסף מסננים למטה לפי רשימת הגלריות
    supabase.from('gallery_extension_requests').select('id, gallery_id, requested_days, created_at').eq('status', 'pending'),
    supabase
      .from('shoots')
      .select('id, shoot_date, start_time, location, gallery_id, clients(full_name)')
      .eq('photographer_id', photographer.id)
      .gte('shoot_date', today)
      .lte('shoot_date', tomorrow),
  ]);

  if (galleriesRes.error) {
    return NextResponse.json({ error: galleriesRes.error.message }, { status: 500 });
  }
  const galleries = (galleriesRes.data ?? []) as any[];
  const ownedIds = new Set(galleries.map((g) => g.id as string));

  // best-effort (טבלה/מיגרציה חסרה = פשוט בלי בקשות/צילומים), כמו ברשימת הגלריות
  const pendingByGallery = new Map<string, { id: string; days: number; createdAt: string | null }>();
  if (!extensionRes.error) {
    for (const r of (extensionRes.data ?? []) as { id: string; gallery_id: string; requested_days: number; created_at: string | null }[]) {
      if (ownedIds.has(r.gallery_id)) pendingByGallery.set(r.gallery_id, { id: r.id, days: r.requested_days, createdAt: r.created_at });
    }
  }

  // ספירת הבחירות הרשמיות (בעלים, 'selected', בלי מתנות) - רק לגלריות שעוד
  // יכולות להופיע במסך: גלריה שנמסרה וגם שולמה כבר לא דורשת כלום.
  const needsCount = galleries.filter((g) => !(g.delivered_at && g.paid_at) && g.owner_participant_id);
  const giftIdsByGallery = groupGiftIdsByGallery(await fetchGiftPhotos(supabase, needsCount.map((g) => g.id)));
  const selectedCounts = new Map<string, number>();
  await mapWithConcurrency(needsCount, COUNT_QUERY_CONCURRENCY, async (g) => {
    let query = supabase
      .from('selections')
      .select('*', { count: 'exact', head: true })
      .eq('gallery_id', g.id)
      .eq('participant_id', g.owner_participant_id)
      .eq('status', 'selected');
    const giftFilter = giftExclusionFilter(giftIdsByGallery.get(g.id) ?? []);
    if (giftFilter) query = query.not('photo_id', 'in', giftFilter);
    const { count } = await query;
    selectedCounts.set(g.id, count ?? 0);
  });

  // בחירת אמצעי התשלום של הלקוחה (lib/paymentMethods.ts) - רק לגלריות שלא
  // סומנו כשולמו; שאילתה נפרדת ו-best-effort, עמודה חסרה (מיגרציה שלא רצה) = בלי תגית
  const paymentChoices = new Map<string, string>();
  try {
    const { data: choiceRows, error: choiceError } = await supabase
      .from('galleries')
      .select('id, client_payment_choice')
      .eq('photographer_id', photographer.id)
      .is('paid_at', null)
      .not('client_payment_choice', 'is', null);
    if (!choiceError) {
      for (const r of (choiceRows ?? []) as { id: string; client_payment_choice: unknown }[]) {
        if (isPaymentMethodType(r.client_payment_choice)) paymentChoices.set(r.id, r.client_payment_choice);
      }
    }
  } catch {
    // בכוונה שקט - ראו הערה למעלה
  }

  const rows: TodayGalleryRow[] = galleries.map((g) => {
    const selectedCount = selectedCounts.get(g.id) ?? 0;
    const summary = computePaymentSummary({
      pkg: g.packages,
      selectedCount,
      amountDueOverride: g.amount_due_override,
      payments: g.gallery_payments,
      paidAt: g.paid_at,
    });
    return {
      id: g.id,
      status: g.status,
      created_at: g.created_at,
      sent_at: g.sent_at,
      expires_at: g.expires_at,
      last_activity_at: g.last_activity_at,
      last_viewed_at: g.last_viewed_at ?? null,
      editing_started_at: g.editing_started_at,
      delivered_at: g.delivered_at,
      reopened_for_selection_at: g.reopened_for_selection_at,
      selectedCount,
      // נמסרה+שולמה לא נספרה, אבל ממילא outstanding = 0 כשיש paid_at
      outstanding: summary.outstanding,
      pendingExtension: pendingByGallery.get(g.id) ?? null,
      clientName: g.clients?.full_name ?? '',
      includedPhotos: g.packages?.included_photos ?? 0,
      paymentChoice: paymentChoices.get(g.id) ?? null,
    };
  });

  const shoots: TodayShoot[] = shootsRes.error
    ? []
    : sortShoots((shootsRes.data ?? []) as any[]).map((s) => ({
        id: s.id,
        shoot_date: s.shoot_date,
        start_time: s.start_time,
        location: s.location,
        gallery_id: s.gallery_id,
        clientName: s.clients?.full_name ?? '',
      }));

  return NextResponse.json({ galleries: rows, shoots, today, tomorrow });
}
