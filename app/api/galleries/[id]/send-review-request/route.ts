import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendReviewRequestEmail } from '@/lib/email';
import { fetchClientGender } from '@/lib/gender';
import { getManualEmailCooldown, recordManualEmailSend, cooldownResponse } from '@/lib/manualEmailLog';

// שליחת בקשת ביקורת - זמינה רק אחרי שהצלמת סימנה את הגלריה כ"נמסרה"
// (delivered_at, ראו app/api/galleries/[id]/toggle-delivered) וגם הגדירה
// קישור ביקורת בהגדרות (photographers.review_link). לא אוטומטי בכוונה -
// הצלמת יודעת הכי טוב מתי הלקוחה באמת ראתה את התוצר הסופי.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name, review_link')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  if (!photographer.review_link) {
    return NextResponse.json({ error: 'צריך קודם להגדיר קישור לביקורת בהגדרות' }, { status: 400 });
  }

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, delivered_at, clients(full_name, email)')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (!gallery.delivered_at) {
    return NextResponse.json({ error: 'אפשר לבקש ביקורת רק אחרי שהגלריה סומנה כנמסרה' }, { status: 400 });
  }

  const client = (gallery as any).clients;
  if (!client?.email) {
    return NextResponse.json({ error: 'חסרים פרטי לקוחה' }, { status: 500 });
  }

  const cooldown = await getManualEmailCooldown(supabase, { galleryId: gallery.id }, 'review');
  if (!cooldown.allowed) return cooldownResponse(cooldown);

  const { sent: emailSent } = await sendReviewRequestEmail({
    to: client.email,
    clientName: client.full_name,
    clientGender: await fetchClientGender(supabase, gallery.id),
    businessName: photographer.business_name,
    reviewLink: photographer.review_link,
    replyTo: user.email,
  });

  if (emailSent) {
    await recordManualEmailSend(supabase, photographer.id, { galleryId: gallery.id }, 'review');
  }

  return NextResponse.json({ emailSent });
}
