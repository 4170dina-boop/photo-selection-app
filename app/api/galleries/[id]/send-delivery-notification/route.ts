import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendFinalPhotosReadyEmail } from '@/lib/email';
import { getManualEmailCooldown, recordManualEmailSend, cooldownResponse } from '@/lib/manualEmailLog';
import { fetchGalleryLanguageOrDefault } from '@/lib/i18n/galleryLanguage';

// שליחה ידנית של התראה ללקוחה שהתמונות הסופיות מוכנות - בדיוק כמו
// send-reminder/route.ts (אימות בעלות עם session הצלם, שליחה עם lib/email.ts),
// בלי "פעם אחת ביום" אוטומטי (בניגוד ל-last_reminder_sent_at) - הצלמת יכולה
// ללחוץ שוב כשהיא מוסיפה עוד תמונות סופיות, בכפוף למגבלת הקצב הידנית
// (lib/manualEmailCooldown.ts: 60 שניות בין שליחות, עד 10 ב-24 שעות).
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
    .select('id, clients(full_name, email, access_code)')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const client = (gallery as any).clients;
  if (!client?.email) {
    return NextResponse.json({ error: 'חסרים פרטי לקוחה' }, { status: 500 });
  }

  const { count } = await supabase
    .from('delivered_photos')
    .select('id', { count: 'exact', head: true })
    .eq('gallery_id', gallery.id);

  if (!count) {
    return NextResponse.json({ error: 'עדיין לא הועלו תמונות סופיות' }, { status: 400 });
  }

  const cooldown = await getManualEmailCooldown(supabase, { galleryId: gallery.id }, 'delivery');
  if (!cooldown.allowed) return cooldownResponse(cooldown);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const { sent: emailSent } = await sendFinalPhotosReadyEmail({
    // שפת הגלריה (galleries.language) - עמודה חסרה = עברית
    language: await fetchGalleryLanguageOrDefault(supabase, gallery.id),
    to: client.email,
    clientName: client.full_name,
    businessName: photographer.business_name,
    count,
    galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
    replyTo: user.email,
  });

  if (emailSent) {
    await recordManualEmailSend(supabase, photographer.id, { galleryId: gallery.id }, 'delivery');
  }

  return NextResponse.json({ emailSent });
}
