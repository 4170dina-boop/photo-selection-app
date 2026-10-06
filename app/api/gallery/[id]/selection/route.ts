import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { checkGalleryWritable } from '@/lib/galleryAccess';
import { sendQuotaReachedEmail } from '@/lib/email';
import { fetchClientGender } from '@/lib/gender';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { countBillableSelected } from '@/lib/gifts';
import { captureAmountDueBefore, syncPaidAtAfterTotalChange } from '@/lib/galleryPayments';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);

  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  // שיתוף גלריה משפחתי: אי אפשר לסמן בחירה לפני שידוע מי בפועל מסמן (ראו
  // app/api/gallery/[id]/identify/route.ts) - כל selection שייכת ל-participant ספציפי.
  if (!session.participantId) {
    return NextResponse.json({ error: 'צריך לזהות את עצמך קודם' }, { status: 428 });
  }

  const writable = await checkGalleryWritable(supabaseAdmin, galleryId);
  if (!writable.ok) {
    return NextResponse.json({ error: writable.error }, { status: writable.status });
  }

  let body: { photoId?: string; status?: 'maybe' | 'selected' | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { photoId, status } = body;
  if (!photoId || (status !== 'maybe' && status !== 'selected' && status !== null)) {
    return NextResponse.json({ error: 'חסרים פרטים' }, { status: 400 });
  }

  // מוודאים שהתמונה שייכת לגלריה הזו, כדי שלא יהיה אפשר לעדכן selection של גלריה אחרת
  const { data: photo } = await supabaseAdmin
    .from('photos')
    .select('id')
    .eq('id', photoId)
    .eq('gallery_id', galleryId)
    .single();

  if (!photo) {
    return NextResponse.json({ error: 'תמונה לא נמצאה' }, { status: 404 });
  }

  // תמונת מתנה (lib/gifts.ts) כבר כלולה אוטומטית - לא מסמנים אותה כבחירה,
  // כדי שלא תיספר למכסה. ביטול (status=null) עדיין מותר, למקרה שהלקוחה
  // סימנה אותה לפני שהצלמת הפכה אותה למתנה. best-effort כמו fetchGiftPhotos.
  const giftIds = (await fetchGiftPhotos(supabaseAdmin, [galleryId])).map((g) => g.id);
  if (status !== null && giftIds.includes(photoId)) {
    return NextResponse.json({ error: 'זו תמונת מתנה - היא כבר כלולה אצלך, אין צורך לבחור אותה' }, { status: 400 });
  }

  // הסכום לתשלום לפני השינוי - paid_at מסונכרן רק אם הוא באמת השתנה (רק
  // בחירות הבעלים נספרות לחיוב, ראו captureAmountDueBefore)
  const amountBefore = await captureAmountDueBefore(supabaseAdmin, galleryId, session.participantId);

  const { error: writeError } =
    status === null
      ? await supabaseAdmin
          .from('selections')
          .delete()
          .eq('gallery_id', galleryId)
          .eq('photo_id', photoId)
          .eq('participant_id', session.participantId)
      : await supabaseAdmin.from('selections').upsert(
          { gallery_id: galleryId, photo_id: photoId, participant_id: session.participantId, status },
          { onConflict: 'gallery_id,photo_id,participant_id' }
        );

  if (writeError) {
    console.error('[selection] שמירת הבחירה נכשלה:', writeError);
    return NextResponse.json({ error: 'שמירת הבחירה נכשלה, נסי שוב' }, { status: 500 });
  }

  // התראה לצלמת ברגע שהבעלים (לא בן משפחה אחר) מגיעה למכסת החבילה -
  // best-effort, לא חוסמת את התשובה ללקוחה. פעם אחת בלבד לכל גלריה: "תופסים"
  // את galleries.quota_notified_at ב-UPDATE מותנה (is null), כך שגם בחירות
  // נוספות, ביטול-ובחירה-מחדש או בקשות מקבילות לא שולחים מייל חוזר.
  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('owner_participant_id, photographer_id, clients(full_name)')
    .eq('id', galleryId)
    .single();

  if (status === 'selected' && gallery?.owner_participant_id === session.participantId) {
    try {
      const { data: pkg } = await supabaseAdmin
        .from('packages')
        .select('included_photos')
        .eq('gallery_id', galleryId)
        .single();

      if (pkg && pkg.included_photos > 0) {
        const { data: ownerSelected } = await supabaseAdmin
          .from('selections')
          .select('photo_id, status')
          .eq('gallery_id', galleryId)
          .eq('participant_id', session.participantId)
          .eq('status', 'selected');
        // בלי תמונות מתנה - הן לא חלק מהמכסה (lib/gifts.ts)
        const count = countBillableSelected(ownerSelected ?? [], giftIds);

        let shouldNotify = false;
        if (count >= pkg.included_photos) {
          const { data: claimed, error: claimError } = await supabaseAdmin
            .from('galleries')
            .update({ quota_notified_at: new Date().toISOString() })
            .eq('id', galleryId)
            .is('quota_notified_at', null)
            .select('id');
          // לפני שהמיגרציה של quota_notified_at רצה העמודה לא קיימת - נופלים
          // להתנהגות הישנה (רק בהגעה בדיוק למכסה) במקום לשלוח בכל בחירה.
          shouldNotify = claimError ? count === pkg.included_photos : (claimed ?? []).length > 0;
        }

        if (shouldNotify) {
          const { data: photographer } = await supabaseAdmin
            .from('photographers')
            .select('auth_user_id')
            .eq('id', gallery.photographer_id)
            .single();

          if (photographer?.auth_user_id) {
            const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(photographer.auth_user_id);
            const photographerEmail = authUser?.user?.email;
            const clientName = (gallery as any).clients?.full_name ?? 'לקוחה';

            if (photographerEmail) {
              const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
              await sendQuotaReachedEmail({
                to: photographerEmail,
                clientName,
                clientGender: await fetchClientGender(supabaseAdmin, galleryId),
                includedPhotos: pkg.included_photos,
                dashboardUrl: `${siteUrl}/dashboard/galleries/${galleryId}/edit`,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[selection] שליחת התראת מכסה נכשלה:', err);
    }
  }

  // רק בחירות הבעלים נספרות לחיוב - שינוי שלהן אולי שינה את הסכום לתשלום
  // (amountBefore הוא null לבן משפחה אחר / בלי תשלומים).
  await syncPaidAtAfterTotalChange(supabaseAdmin, amountBefore);

  return NextResponse.json({ success: true });
}

// מבטלת בבת אחת את כל הסימונים (אולי+נבחר) של המשתתף/ת המחובר/ת בגלריה הזו -
// רק שלה/שלו, לא של בני משפחה אחרים (participant_id מסונן, לא gallery_id בלבד).
// כפתור "ביטול כל הבחירה" ב-app/gallery/[id]/page.tsx.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);

  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  if (!session.participantId) {
    return NextResponse.json({ error: 'צריך לזהות את עצמך קודם' }, { status: 428 });
  }

  const writable = await checkGalleryWritable(supabaseAdmin, galleryId);
  if (!writable.ok) {
    return NextResponse.json({ error: writable.error }, { status: writable.status });
  }

  // הסכום לפני - רק לבעלים (ראו POST)
  const amountBefore = await captureAmountDueBefore(supabaseAdmin, galleryId, session.participantId);

  const { error: deleteError } = await supabaseAdmin
    .from('selections')
    .delete()
    .eq('gallery_id', galleryId)
    .eq('participant_id', session.participantId);

  if (deleteError) {
    console.error('[selection] ביטול כל הבחירה נכשל:', deleteError);
    return NextResponse.json({ error: 'ביטול הבחירה נכשל, נסי שוב' }, { status: 500 });
  }

  await syncPaidAtAfterTotalChange(supabaseAdmin, amountBefore);

  return NextResponse.json({ success: true });
}
