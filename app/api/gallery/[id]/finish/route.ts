import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { sendSelectionCompleteEmail } from '@/lib/email';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// מסמן שהלקוחה סיימה לבחור. לא מחושב אוטומטית לפי מספר תמונות שנבחרו - אין דרך
// לדעת אם היא באמת סיימה או עדיין שוקלת, ואפשר שתרצה לבחור פחות/יותר מהמכסה
// שבחבילה. לכן זו פעולה מפורשת של הלקוחה, לא threshold אוטומטי.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  if (!requireGallerySession(req, galleryId)) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('status, expires_at, photographer_id, clients(full_name)')
    .eq('id', galleryId)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (gallery.expires_at && new Date(gallery.expires_at) < new Date()) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  if (gallery.status !== 'completed') {
    await supabaseAdmin
      .from('galleries')
      .update({ status: 'completed', last_activity_at: new Date().toISOString() })
      .eq('id', galleryId);

    // best-effort: מודיעה לצלמת שהבחירה הסתיימה. לא חוסמת/מפילה את הבקשה אם
    // המייל נכשל - הלקוחה כבר סיימה, המצב ב-DB כבר עודכן בשלב הקודם.
    try {
      const { data: photographer } = await supabaseAdmin
        .from('photographers')
        .select('auth_user_id')
        .eq('id', gallery.photographer_id)
        .single();

      const { count: selectedCount } = await supabaseAdmin
        .from('selections')
        .select('id', { count: 'exact', head: true })
        .eq('gallery_id', galleryId)
        .eq('status', 'selected');

      if (photographer?.auth_user_id) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(photographer.auth_user_id);
        const photographerEmail = authUser?.user?.email;
        const clientName = (gallery as any).clients?.full_name ?? 'לקוחה';

        if (photographerEmail) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
          await sendSelectionCompleteEmail({
            to: photographerEmail,
            clientName,
            selectedCount: selectedCount ?? 0,
            dashboardUrl: `${siteUrl}/dashboard/galleries/${galleryId}/edit`,
          });
        }
      }
    } catch (err) {
      console.error('[finish] שליחת מייל לצלמת נכשלה:', err);
    }
  }

  return NextResponse.json({ success: true });
}
