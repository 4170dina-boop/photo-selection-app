import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendExpiryReminderEmail } from '@/lib/email';

// service_role - חובה כאן כדי לעדכן last_reminder_sent_at, אחרי אימות הבעלות
// עם ה-session של הצלם. אותו דגם כמו app/api/admin/photographers/[id]/route.ts:
// אימות עם anon/session, פעולה בפועל עם service key.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// שליחה ידנית של תזכורת תפוגה - בנוסף לתזכורת האוטומטית החד-פעמית שכבר
// שולח app/api/cron/tick/route.ts. שימושי כשהצלמת רוצה לדחוף עכשיו (למשל
// יומיים לפני הדדליין, בלי לחכות לריצת ה-cron היומית), גם אם כבר נשלחה
// תזכורת אוטומטית בעבר - last_reminder_sent_at מתעדכן כאן גם כן, כדי שה-cron
// לא ישלח עוד תזכורת "כפולה" מיד אחרי זה.
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
    .select('id, business_name')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, expires_at, clients(full_name, email, access_code)')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (!gallery.expires_at) {
    return NextResponse.json({ error: 'לגלריה הזו אין תאריך תוקף - אי אפשר לשלוח תזכורת תפוגה' }, { status: 400 });
  }

  const client = (gallery as any).clients;
  if (!client?.email || !client?.access_code) {
    return NextResponse.json({ error: 'חסרים פרטי לקוחה' }, { status: 500 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const { sent: emailSent } = await sendExpiryReminderEmail({
    to: client.email,
    clientName: client.full_name,
    businessName: photographer.business_name,
    galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
    accessCode: client.access_code,
    expiresAt: gallery.expires_at,
    replyTo: user.email,
  });

  if (emailSent) {
    await supabaseAdmin.from('galleries').update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', gallery.id);
  }

  return NextResponse.json({ emailSent });
}
