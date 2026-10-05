import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { sendSelectionCompleteEmail, sendClientSelectionSummaryEmail } from '@/lib/email';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { isGalleryExpired } from '@/lib/galleryAccess';
import { fetchClientGender } from '@/lib/gender';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// מסמן שהלקוחה סיימה לבחור. לא מחושב אוטומטית לפי מספר תמונות שנבחרו - אין דרך
// לדעת אם היא באמת סיימה או עדיין שוקלת, ואפשר שתרצה לבחור פחות/יותר מהמכסה
// שבחבילה. לכן זו פעולה מפורשת של הלקוחה, לא threshold אוטומטי.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);
  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('status, expires_at, reopened_for_selection_at, photographer_id, owner_participant_id, clients(full_name, email)')
    .eq('id', galleryId)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // שיתוף גלריה משפחתי: רק הבעלים הרשומה יכולה לסיים את הבחירה בפועל -
  // בני משפחה אחרים תורמים קלט, אבל לא נועלים את הגלריה בשם הבעלים.
  // session בלי זהות (null) או גלריה בלי בעלים רשומה (null) - בלי הבדיקה
  // המפורשת, null === null היה עובר כ"בעלים".
  if (!session.participantId || !gallery.owner_participant_id || session.participantId !== gallery.owner_participant_id) {
    return NextResponse.json({ error: 'רק הלקוחה הראשית יכולה לסיים את הבחירה' }, { status: 403 });
  }

  if (isGalleryExpired(gallery.expires_at)) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  // רץ גם כשהגלריה כבר completed אבל הצלמת פתחה אותה מחדש
  // (reopened_for_selection_at) - סיום חוזר נועל שוב ושולח שוב את המיילים.
  // קריאה כפולה על גלריה נעולה לא עושה כלום (בלי מייל כפול).
  if (gallery.status !== 'completed' || gallery.reopened_for_selection_at) {
    const { data: selectedRows, error: selectedError } = await supabaseAdmin
      .from('selections')
      .select('photo_id, photos(original_filename)')
      .eq('gallery_id', galleryId)
      .eq('participant_id', gallery.owner_participant_id)
      .eq('status', 'selected');

    if (selectedError) {
      return NextResponse.json({ error: 'שליחת הבחירה נכשלה' }, { status: 500 });
    }

    // תמונות מתנה (lib/gifts.ts) לא נספרות כבחירה - הן כלולות ממילא.
    const giftIds = new Set((await fetchGiftPhotos(supabaseAdmin, [galleryId])).map((g) => g.id));
    const billableRows = (selectedRows ?? []).filter((s: any) => !giftIds.has(s.photo_id));

    if (billableRows.length === 0) {
      return NextResponse.json({ error: 'עדיין לא בחרת אף תמונה - צריך לבחור לפחות תמונה אחת לפני שמסיימים' }, { status: 400 });
    }

    // "תפיסה" אטומית של המעבר ל-completed: ה-UPDATE מותנה במצב שנקרא למעלה
    // (עדיין לא completed, או completed שנפתח מחדש ועדיין פתוח), כך שמבין
    // שתי בקשות מקבילות רק אחת מעדכנת שורה - ורק היא שולחת את המיילים.
    let claim = supabaseAdmin
      .from('galleries')
      .update({ status: 'completed', reopened_for_selection_at: null, last_activity_at: new Date().toISOString() })
      .eq('id', galleryId);
    claim =
      gallery.status !== 'completed'
        ? claim.neq('status', 'completed')
        : claim.eq('status', 'completed').not('reopened_for_selection_at', 'is', null);
    const { data: claimed, error: updateError } = await claim.select('id');

    if (updateError) {
      return NextResponse.json({ error: 'שליחת הבחירה נכשלה' }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      // בקשה מקבילה כבר סיימה - התוצאה זהה מבחינת הלקוחה, בלי מייל כפול
      return NextResponse.json({ success: true });
    }

    const filenames = billableRows
      .map((s: any) => s.photos?.original_filename as string | undefined)
      .filter((name): name is string => !!name);

    const clientName = (gallery as any).clients?.full_name ?? 'לקוחה';
    const clientEmail = (gallery as any).clients?.email as string | undefined;

    // best-effort: מודיעה לצלמת ולללקוחה שהבחירה הסתיימה. לא חוסמת/מפילה את
    // הבקשה אם המייל נכשל - הלקוחה כבר סיימה, המצב ב-DB כבר עודכן למעלה.
    try {
      const { data: photographer } = await supabaseAdmin
        .from('photographers')
        .select('auth_user_id, business_name')
        .eq('id', gallery.photographer_id)
        .single();

      let photographerEmail: string | undefined;
      if (photographer?.auth_user_id) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(photographer.auth_user_id);
        photographerEmail = authUser?.user?.email;

        if (photographerEmail) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
          await sendSelectionCompleteEmail({
            to: photographerEmail,
            clientName,
            clientGender: await fetchClientGender(supabaseAdmin, galleryId),
            selectedCount: billableRows.length,
            dashboardUrl: `${siteUrl}/dashboard/galleries/${galleryId}/edit`,
          });
        }
      }

      if (clientEmail) {
        await sendClientSelectionSummaryEmail({
          to: clientEmail,
          clientName,
          businessName: photographer?.business_name ?? '',
          filenames,
          replyTo: photographerEmail,
        });
      }
    } catch (err) {
      console.error('[finish] שליחת מייל נכשלה:', err);
    }
  }

  return NextResponse.json({ success: true });
}
