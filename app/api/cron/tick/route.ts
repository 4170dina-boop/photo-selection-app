import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  sendExpiryReminderEmail,
  sendOriginalsDeletionWarningEmail,
  sendShootReminderEmail,
  sendShootsDailySummaryEmail,
} from '@/lib/email';
import { israelDateString, daysBetweenDateStrings, addDaysToDateString } from '@/lib/israelTime';
import {
  selectShootsNeedingReminder,
  shouldSendDailySummary,
  israelTomorrowDateString,
  daysUntilLabel,
  MAX_SHOOT_REMINDER_DAYS,
} from '@/lib/shoots';
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

  // 2. גלריות שמתקרבות לתוקף ועוד לא נשלחה עליהן תזכורת - שולחים אחת (חד-פעמית).
  // כולל גלריות שהצלמת פתחה מחדש לבחירה (completed + reopened_for_selection_at) -
  // הלקוחה שוב באמצע בחירה, ותוקף שפג חוסם אותה גם שם (checkGalleryWritable).
  const { data: candidates, error: candidatesError } = await supabaseAdmin
    .from('galleries')
    .select(
      'id, expires_at, reminder_days, status, clients(full_name, email, access_code), photographers(business_name, reminder_days_default, auth_user_id)'
    )
    .or('status.in.(sent,in_progress),and(status.eq.completed,reopened_for_selection_at.not.is.null)')
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

  // 5+6: יומן צילומים (טבלת shoots). בכוונה לא מחזירים 500 על שגיאת שליפה כאן
  // (בניגוד לשלבים 1-4): השלבים הקודמים כבר רצו ונכתבו, ושגיאה כאן (למשל אם
  // המיגרציה של shoots עוד לא הורצה) לא אמורה להיראות כמו כישלון של כל הריצה.
  const shootResults = await runShootJobs(now, siteUrl);

  return NextResponse.json({
    expiredCount: expiredGalleries?.length ?? 0,
    candidatesChecked: candidates?.length ?? 0,
    remindersSent,
    originalsWarningsSent,
    originalsCleanedGalleries,
    originalFilesDeleted,
    ...shootResults,
  });
}

// מייל הצלמת (מ-auth.users) עם cache לריצה הנוכחית - צלמת עם כמה צילומים לא
// צריכה כמה קריאות auth admin. best-effort כמו בשלב 2: כישלון = undefined.
function createPhotographerEmailLookup() {
  const cache = new Map<string, string | undefined>();
  return async (authUserId: string | null | undefined): Promise<string | undefined> => {
    if (!authUserId) return undefined;
    if (cache.has(authUserId)) return cache.get(authUserId);
    let email: string | undefined;
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(authUserId);
      email = data?.user?.email;
    } catch {
      // בכוונה שקט - ראו הערה דומה בשלב 2
    }
    cache.set(authUserId, email);
    return email;
  };
}

async function runShootJobs(now: Date, siteUrl: string) {
  const getPhotographerEmail = createPhotographerEmailLookup();
  const todayIsrael = israelDateString(now);

  // 5. תזכורת ללקוחה N ימים לפני הצילום (photographers.shoot_reminder_days,
  // ברירת מחדל 1). ההחלטה "האם עכשיו" היא לוגיקה טהורה ב-lib/shoots.ts
  // (selectShootsNeedingReminder, עם טסטים), כאן רק שליפה ושליחה.
  let shootRemindersSent = 0;
  let shootRemindersError: string | undefined;

  const { data: shootCandidates, error: shootCandidatesError } = await supabaseAdmin
    .from('shoots')
    .select(
      'id, shoot_date, start_time, location, reminder_sent_at, clients(full_name, email), photographers(business_name, shoot_reminder_days, auth_user_id)'
    )
    .is('reminder_sent_at', null)
    .gte('shoot_date', todayIsrael)
    .lte('shoot_date', addDaysToDateString(todayIsrael, MAX_SHOOT_REMINDER_DAYS));

  if (shootCandidatesError) {
    console.error('[cron/tick] שליפת צילומים לתזכורת נכשלה', shootCandidatesError);
    shootRemindersError = 'שליפת צילומים לתזכורת נכשלה';
  }

  const dueShoots = selectShootsNeedingReminder(
    shootCandidates ?? [],
    (shoot) => (shoot as any).photographers?.shoot_reminder_days,
    now
  );

  for (const shoot of dueShoots) {
    const client = (shoot as any).clients;
    const photographer = (shoot as any).photographers;
    if (!client?.email || !photographer) continue;

    // "תופסים" את הצילום לפני השליחה (update מותנה ב-reminder_sent_at is null) -
    // כך שתי ריצות cron מקבילות לא ישלחו את אותה תזכורת פעמיים. אם השליחה
    // נכשלת, משחררים חזרה כדי שהריצה הבאה תנסה שוב.
    const { data: claimed } = await supabaseAdmin
      .from('shoots')
      .update({ reminder_sent_at: now.toISOString() })
      .eq('id', shoot.id)
      .is('reminder_sent_at', null)
      .select('id');
    if (!claimed?.length) continue;

    const result = await sendShootReminderEmail({
      to: client.email,
      clientName: client.full_name,
      businessName: photographer.business_name,
      shootDate: shoot.shoot_date,
      startTime: shoot.start_time,
      location: shoot.location,
      whenLabel: daysUntilLabel(daysBetweenDateStrings(todayIsrael, shoot.shoot_date)),
      replyTo: await getPhotographerEmail(photographer.auth_user_id),
    });

    if (result.sent) {
      shootRemindersSent++;
    } else {
      await supabaseAdmin.from('shoots').update({ reminder_sent_at: null }).eq('id', shoot.id);
    }
  }

  // 6. סיכום יומי לצלמת עם הצילומים של מחר - רק לצלמות שלא כיבו את זה
  // (shoot_daily_summary_enabled) ורק פעם אחת ליום (shoot_summary_sent_on).
  let shootSummariesSent = 0;
  let shootSummariesError: string | undefined;
  const tomorrowIsrael = israelTomorrowDateString(now);

  const { data: tomorrowShoots, error: tomorrowError } = await supabaseAdmin
    .from('shoots')
    .select(
      'photographer_id, start_time, location, notes, clients(full_name), photographers(auth_user_id, shoot_daily_summary_enabled, shoot_summary_sent_on)'
    )
    .eq('shoot_date', tomorrowIsrael)
    .order('start_time', { ascending: true });

  if (tomorrowError) {
    console.error('[cron/tick] שליפת צילומי מחר נכשלה', tomorrowError);
    shootSummariesError = 'שליפת צילומי מחר נכשלה';
  }

  const byPhotographer = new Map<string, NonNullable<typeof tomorrowShoots>>();
  for (const shoot of tomorrowShoots ?? []) {
    const list = byPhotographer.get(shoot.photographer_id) ?? [];
    list.push(shoot);
    byPhotographer.set(shoot.photographer_id, list);
  }

  for (const [photographerId, shoots] of Array.from(byPhotographer.entries())) {
    const photographer = (shoots[0] as any).photographers;
    if (!photographer || !shouldSendDailySummary(photographer.shoot_daily_summary_enabled, photographer.shoot_summary_sent_on, now)) {
      continue;
    }

    const photographerEmail = await getPhotographerEmail(photographer.auth_user_id);
    if (!photographerEmail) continue;

    // אותו "תפיסה" מותנית כמו בשלב 5, כאן ליום: רק אם עוד לא סומן היום.
    const { data: claimed } = await supabaseAdmin
      .from('photographers')
      .update({ shoot_summary_sent_on: todayIsrael })
      .eq('id', photographerId)
      .or(`shoot_summary_sent_on.is.null,shoot_summary_sent_on.neq.${todayIsrael}`)
      .select('id');
    if (!claimed?.length) continue;

    const result = await sendShootsDailySummaryEmail({
      to: photographerEmail,
      shootDate: tomorrowIsrael,
      shoots: shoots.map((s) => ({
        clientName: (s as any).clients?.full_name ?? '',
        startTime: s.start_time,
        location: s.location,
        notes: s.notes,
      })),
      dashboardUrl: `${siteUrl}/dashboard/calendar`,
    });

    if (result.sent) {
      shootSummariesSent++;
    } else {
      await supabaseAdmin
        .from('photographers')
        .update({ shoot_summary_sent_on: photographer.shoot_summary_sent_on ?? null })
        .eq('id', photographerId);
    }
  }

  return {
    shootReminderCandidates: shootCandidates?.length ?? 0,
    shootRemindersSent,
    shootSummariesSent,
    ...(shootRemindersError ? { shootRemindersError } : {}),
    ...(shootSummariesError ? { shootSummariesError } : {}),
  };
}
