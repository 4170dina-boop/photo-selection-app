import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendExpiryReminderEmail, sendOriginalsDeletionWarningEmail } from '@/lib/email';
import { israelDateString, daysBetweenDateStrings } from '@/lib/israelTime';
import { toHebrewDateString } from '@/lib/hebrewDate';
import { deleteObjects } from '@/lib/r2';

// Endpoint אחד שמופעל ע"י תזמון חיצוני (Vercel Cron / Supabase pg_cron / כל
// שירות cron אחר) - ראו README.md ("תזכורות וסטטוס אוטומטי") להוראות הפעלה.
// לא קשור ל-session של אף משתמש - זו עבודת רקע שרצה על כל הגלריות, ולכן
// service_role (בדיוק כמו שאר ה-API routes תחת app/api/gallery/[id]/*).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true; // כך Vercel Cron שולח את הבקשה

  return req.nextUrl.searchParams.get('secret') === secret; // fallback לשירותי cron חיצוניים
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'לא מורשה' }, { status: 401 });
  }

  const now = new Date();

  // 1. גלריות שפג תוקפן עוברות ל-expired (מלבד כאלה שכבר הושלמו)
  const { data: expiredGalleries, error: expireError } = await supabaseAdmin
    .from('galleries')
    .update({ status: 'expired' })
    .not('expires_at', 'is', null)
    .lt('expires_at', now.toISOString())
    .in('status', ['draft', 'sent', 'in_progress'])
    .select('id');

  if (expireError) {
    return NextResponse.json({ error: 'עדכון גלריות שפג תוקפן נכשל' }, { status: 500 });
  }

  // 2. גלריות שמתקרבות לתוקף ועוד לא נשלחה עליהן תזכורת - שולחים אחת (חד-פעמית)
  const { data: candidates, error: candidatesError } = await supabaseAdmin
    .from('galleries')
    .select(
      'id, expires_at, reminder_days, status, clients(full_name, email, access_code), photographers(business_name, reminder_days_default, auth_user_id)'
    )
    .in('status', ['sent', 'in_progress'])
    .not('expires_at', 'is', null)
    .is('last_reminder_sent_at', null);

  if (candidatesError) {
    return NextResponse.json({ error: 'שליפת מועמדות לתזכורת נכשלה' }, { status: 500 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  let remindersSent = 0;

  for (const gallery of candidates ?? []) {
    const client = (gallery as any).clients;
    const photographer = (gallery as any).photographers;
    if (!client?.email || !photographer || !gallery.expires_at) continue;

    const reminderDays = gallery.reminder_days ?? photographer.reminder_days_default ?? 5;
    const expiresAt = new Date(gallery.expires_at);

    // משווים תאריכים אזרחיים בזמן ישראל (לא הפרש מדויק במילישניות) - expires_at
    // נשמר בערך כ-23:59:59 (או 21:59:59 בשעון חורף) בזמן ישראל, אז השוואת
    // timestamp מדויק מול "עכשיו" הייתה תלויה בשעה שבה ה-cron היומי רץ (ראו
    // vercel.json - 08:00 UTC) וגורמת לתזכורת להישלח יום אחרי המיועד.
    const daysUntilExpiry = daysBetweenDateStrings(israelDateString(now), israelDateString(expiresAt));

    if (daysUntilExpiry > reminderDays) continue; // עוד לא הגיע הזמן להזכיר

    // best-effort - כדי שתשובה של הלקוחה תגיע ישירות לצלמת. אם השליפה נכשלת
    // (למשל המשתמש כבר לא קיים), פשוט שולחים בלי reply-to במקום להפיל את כל הריצה.
    let photographerEmail: string | undefined;
    if (photographer.auth_user_id) {
      try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(photographer.auth_user_id);
        photographerEmail = authUser?.user?.email;
      } catch {
        // בכוונה שקט - ראו הערה למעלה
      }
    }

    const result = await sendExpiryReminderEmail({
      to: client.email,
      clientName: client.full_name,
      businessName: photographer.business_name,
      galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
      accessCode: client.access_code,
      expiresAt: gallery.expires_at,
      replyTo: photographerEmail,
    });

    if (result.sent) {
      await supabaseAdmin.from('galleries').update({ last_reminder_sent_at: now.toISOString() }).eq('id', gallery.id);
      remindersSent++;
    }
  }

  // 3. גלריות שיעברו 30 יום ממסירה בעוד 5 ימים או פחות (25+ יום שכבר עברו) -
  // התראת מייל חד-פעמית לצלמת, כדי שתספיק להוריד את המקור בעצמה אם היא
  // עוד לא עשתה את זה, לפני שהמחיקה הבלתי-הפיכה בשלב 4 למטה קורית.
  const ORIGINALS_WARNING_DAYS_BEFORE = 5;
  const ORIGINALS_GRACE_DAYS = 30;
  const warningThreshold = new Date(now.getTime() - (ORIGINALS_GRACE_DAYS - ORIGINALS_WARNING_DAYS_BEFORE) * 24 * 60 * 60 * 1000);

  const { data: warningCandidates, error: warningError } = await supabaseAdmin
    .from('galleries')
    .select('id, delivered_at, clients(full_name), photographers(auth_user_id)')
    .not('delivered_at', 'is', null)
    .lt('delivered_at', warningThreshold.toISOString())
    .is('originals_cleaned_up_at', null)
    .is('originals_deletion_warning_sent_at', null);

  if (warningError) {
    return NextResponse.json({ error: 'שליפת מועמדות להתראת מחיקת מקור נכשלה' }, { status: 500 });
  }

  let originalsWarningsSent = 0;

  for (const gallery of warningCandidates ?? []) {
    const client = (gallery as any).clients;
    const photographer = (gallery as any).photographers;
    if (!client?.full_name || !photographer?.auth_user_id || !gallery.delivered_at) continue;

    let photographerEmail: string | undefined;
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(photographer.auth_user_id);
      photographerEmail = authUser?.user?.email;
    } catch {
      // בכוונה שקט - ראו הערה דומה בשלב 2 למעלה
    }
    if (!photographerEmail) continue;

    const deletionDate = new Date(new Date(gallery.delivered_at).getTime() + ORIGINALS_GRACE_DAYS * 24 * 60 * 60 * 1000);

    const result = await sendOriginalsDeletionWarningEmail({
      to: photographerEmail,
      clientName: client.full_name,
      deletionDate: toHebrewDateString(deletionDate),
      dashboardUrl: `${siteUrl}/dashboard/galleries/${gallery.id}/edit`,
    });

    if (result.sent) {
      await supabaseAdmin.from('galleries').update({ originals_deletion_warning_sent_at: now.toISOString() }).eq('id', gallery.id);
      originalsWarningsSent++;
    }
  }

  // 4. גלריות שנמסרו לפני 30+ יום - מוחקות את קבצי המקור (לא הערוכים!) כדי
  // לפנות מקום באחסון (R2, ראו lib/r2.ts). בשלב הזה הלקוחה כבר בחרה והצלמת
  // כבר הורידה/ערכה את המקור אצלה, אז אין עוד סיבה שהעותק הזה יתפוס מקום.
  const cleanupThreshold = new Date(now.getTime() - ORIGINALS_GRACE_DAYS * 24 * 60 * 60 * 1000);

  const { data: deliveredGalleries, error: deliveredError } = await supabaseAdmin
    .from('galleries')
    .select('id')
    .not('delivered_at', 'is', null)
    .lt('delivered_at', cleanupThreshold.toISOString())
    .is('originals_cleaned_up_at', null);

  if (deliveredError) {
    return NextResponse.json({ error: 'שליפת גלריות לניקוי מקור נכשלה' }, { status: 500 });
  }

  let originalsCleanedGalleries = 0;
  let originalFilesDeleted = 0;

  for (const gallery of deliveredGalleries ?? []) {
    const { data: photos } = await supabaseAdmin
      .from('photos')
      .select('file_path, thumbnail_path')
      .eq('gallery_id', gallery.id);

    // מוחקים רק תמונות שבהן יש עותק שני עצמאי (thumbnail בנתיב אחר מהמקור) -
    // אם עיבוד סימן המים נכשל בזמנו (thumbnail_path == file_path, ראו
    // .../photos/[photoId]/process/route.ts), זה העותק היחיד של התמונה
    // ואסור למחוק אותו.
    const paths = (photos ?? [])
      .filter((p) => p.thumbnail_path && p.thumbnail_path !== p.file_path)
      .map((p) => p.file_path);

    if (paths.length > 0) {
      try {
        await deleteObjects(paths);
        originalFilesDeleted += paths.length;
      } catch (err) {
        console.error('[cron/tick] מחיקת קבצי מקור נכשלה עבור גלריה', gallery.id, err);
      }
    }

    // מסמנים "נוקה" גם אם לא היה מה למחוק (כל התמונות בגלריה נכשלו בעיבוד) -
    // כדי שלא נבדוק את אותה גלריה שוב בכל ריצה יומית.
    await supabaseAdmin.from('galleries').update({ originals_cleaned_up_at: now.toISOString() }).eq('id', gallery.id);
    originalsCleanedGalleries++;
  }

  return NextResponse.json({
    expiredCount: expiredGalleries?.length ?? 0,
    candidatesChecked: candidates?.length ?? 0,
    remindersSent,
    originalsWarningsSent,
    originalsCleanedGalleries,
    originalFilesDeleted,
  });
}
