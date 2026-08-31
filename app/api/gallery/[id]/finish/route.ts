import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { sendSelectionCompleteEmail, sendClientSelectionSummaryEmail } from '@/lib/email';

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
    .select('status, expires_at, photographer_id, owner_participant_id, clients(full_name, email)')
    .eq('id', galleryId)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // שיתוף גלריה משפחתי: רק הבעלים הרשומה יכולה לסיים את הבחירה בפועל -
  // בני משפחה אחרים תורמים קלט, אבל לא נועלים את הגלריה בשם הבעלים.
  if (session.participantId !== gallery.owner_participant_id) {
    return NextResponse.json({ error: 'רק הלקוחה הראשית יכולה לסיים את הבחירה' }, { status: 403 });
  }

  if (gallery.expires_at && new Date(gallery.expires_at) < new Date()) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  if (gallery.status !== 'completed') {
    await supabaseAdmin
      .from('galleries')
      .update({ status: 'completed', last_activity_at: new Date().toISOString() })
      .eq('id', galleryId);

    const { data: selectedRows } = await supabaseAdmin
      .from('selections')
      .select('photos(original_filename)')
      .eq('gallery_id', galleryId)
      .eq('participant_id', gallery.owner_participant_id)
      .eq('status', 'selected');

    const filenames = (selectedRows ?? [])
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

      if (photographer?.auth_user_id) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(photographer.auth_user_id);
        const photographerEmail = authUser?.user?.email;

        if (photographerEmail) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
          await sendSelectionCompleteEmail({
            to: photographerEmail,
            clientName,
            selectedCount: filenames.length,
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
        });
      }
    } catch (err) {
      console.error('[finish] שליחת מייל נכשלה:', err);
    }
  }

  return NextResponse.json({ success: true });
}
