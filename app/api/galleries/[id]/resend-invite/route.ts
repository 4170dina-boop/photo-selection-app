import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendGalleryInviteEmail } from '@/lib/email';
import { reserveManualEmailSend, releaseManualEmailReservations, cooldownResponse } from '@/lib/manualEmailLog';
import { fetchGalleryLanguageOrDefault } from '@/lib/i18n/galleryLanguage';

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
    .select('id, additional_invite_emails, clients(full_name, email, access_code)')
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

  // הלקוחה הראשית ואז הכתובות הנוספות (additional_invite_emails), בדיוק כמו
  // ביצירה (app/api/galleries/route.ts). ברצף ולא במקביל - כדי לא לחרוג
  // ממגבלת הקצב של Resend - ועם תוצאה לכל נמען, כדי שהצלמת תדע למי לא הגיע.
  const additionalInviteEmails: string[] = (gallery as any).additional_invite_emails ?? [];
  const recipients = [client.email as string, ...additionalInviteEmails];

  // מגבלת קצב לשליחה ידנית (lib/manualEmailCooldown.ts) - לפני השליחה בפועל.
  // שורה לכל נמען (count), כך שהמכסה היומית סופרת מיילים שיצאו ולא לחיצות.
  const reservation = await reserveManualEmailSend(supabase, photographer.id, { galleryId: gallery.id }, 'invite', {
    count: recipients.length,
  });
  if (!reservation.decision.allowed) return cooldownResponse(reservation.decision);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const results: { to: string; sent: boolean; error?: string }[] = [];

  for (const to of recipients) {
    const result = await sendGalleryInviteEmail({
      // שפת הגלריה (galleries.language) - עמודה חסרה = עברית
      language: await fetchGalleryLanguageOrDefault(supabase, gallery.id),
      to,
      clientName: client.full_name,
      businessName: photographer.business_name,
      galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
      accessCode: client.access_code,
      replyTo: user.email,
    });
    results.push({ to, sent: result.sent, ...(result.error ? { error: result.error } : {}) });
  }

  const emailSent = results[0]?.sent ?? false;
  // משחררות את השריון של נמענים שהשליחה אליהם נכשלה (נשארות שורות רק למה שיצא)
  const failedCount = results.filter((r) => !r.sent).length;
  await releaseManualEmailReservations(reservation.reservationIds.slice(0, failedCount));
  const failedAdditional = results.slice(1).filter((r) => !r.sent).map((r) => r.to);

  return NextResponse.json({ emailSent, results, failedAdditional });
}
