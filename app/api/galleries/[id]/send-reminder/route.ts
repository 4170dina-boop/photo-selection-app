import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendExpiryReminderEmail } from '@/lib/email';
import { getManualEmailCooldown, recordManualEmailSend, cooldownResponse } from '@/lib/manualEmailLog';
import { fetchGalleryLanguageOrDefault } from '@/lib/i18n/galleryLanguage';

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
    .select('id, status, expires_at, reopened_for_selection_at, last_reminder_sent_at, clients(full_name, email, access_code)')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (!gallery.expires_at) {
    return NextResponse.json({ error: 'לגלריה הזו אין תאריך תוקף - אי אפשר לשלוח תזכורת תפוגה' }, { status: 400 });
  }

  // תזכורת "הגלריה עומדת לפוג" לא הגיונית אם התוקף כבר פג, או אם הלקוחה כבר
  // סיימה לבחור (אלא אם הצלמת פתחה לה מחדש את הבחירה).
  if (gallery.status === 'expired' || new Date(gallery.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'תוקף הגלריה כבר פג - אפשר להאריך את התוקף ואז לשלוח תזכורת' }, { status: 400 });
  }
  if (gallery.status === 'completed' && !gallery.reopened_for_selection_at) {
    return NextResponse.json({ error: 'הלקוחה כבר סיימה לבחור - אין צורך בתזכורת' }, { status: 400 });
  }

  const client = (gallery as any).clients;
  if (!client?.email || !client?.access_code) {
    return NextResponse.json({ error: 'חסרים פרטי לקוחה' }, { status: 500 });
  }

  // מגבלת קצב לשליחה ידנית. fallback (אם טבלת היומן עוד לא קיימת):
  // last_reminder_sent_at - כך שלפחות ה-60 שניות חלות גם לפני המיגרציה.
  const cooldown = await getManualEmailCooldown(supabase, { galleryId: gallery.id }, 'reminder', [
    (gallery as any).last_reminder_sent_at,
  ]);
  if (!cooldown.allowed) return cooldownResponse(cooldown);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const { sent: emailSent } = await sendExpiryReminderEmail({
    // שפת הגלריה (galleries.language) - עמודה חסרה = עברית
    language: await fetchGalleryLanguageOrDefault(supabase, gallery.id),
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
    await recordManualEmailSend(supabase, photographer.id, { galleryId: gallery.id }, 'reminder');
  }

  return NextResponse.json({ emailSent });
}
