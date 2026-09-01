import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendGalleryInviteEmail } from '@/lib/email';

// שולחת שוב את מייל ההזמנה (קישור + קוד גישה) ללקוחה הקיימת של הגלריה - שימושי
// כשהלקוחה מדווחת שהיא לא מצאה/מחקה את המייל המקורי. רץ עם session הצלם (לא
// service key), אותו דפוס בעלות כמו app/api/galleries/[id]/route.ts.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, clients(full_name, email, access_code)')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const client = (gallery as any).clients;
  if (!client?.email || !client?.access_code) {
    return NextResponse.json({ error: 'חסרים פרטי לקוחה' }, { status: 500 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const { sent: emailSent } = await sendGalleryInviteEmail({
    to: client.email,
    clientName: client.full_name,
    businessName: photographer.business_name,
    galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
    accessCode: client.access_code,
    replyTo: user.email,
  });

  return NextResponse.json({ emailSent });
}
