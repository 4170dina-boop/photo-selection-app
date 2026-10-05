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
import {
  isCronAuthorized,
  resolveExpiryReminderDays,
  isExpiryReminderDue,
  expiryReminderQueryUpperBound,
  originalsWarningThreshold,
  originalsCleanupThreshold,
  originalsWarningSentQueryUpperBound,
  isOriginalsCleanupDue,
  originalsDeletionDate,
  deletableOriginalPaths,
  fetchAllPages,
  errorMessage,
} from '@/lib/cronTick';

// Endpoint אחד שמופעל ע"י תזמון חיצוני (Vercel Cron / Supabase pg_cron / כל
// שירות cron אחר) - ראו README.md ("תזכורות וסטטוס אוטומטי") להוראות הפעלה.
// לא קשור ל-session של אף משתמש - זו עבודת רקע שרצה על כל הגלריות, ולכן
// service_role (בדיוק כמו שאר ה-API routes תחת app/api/gallery/[id]/*).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// 60 שניות = המקסימום הבטוח בכל תוכניות Vercel (גם Hobby). ריצה ששולחת
// הרבה מיילים עוצרת את השליחות לפני הזמן (RUN_BUDGET_MS) ומשאירה את השאר
// לריצה הבאה - כל השלבים idempotent.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const RUN_BUDGET_MS = 50 * 1000;
// Resend מגביל כברירת מחדל ל-2 בקשות בשנייה - השהיה קטנה בין שליחות
// (ובנוסף ניסיון חוזר יחיד על 429 בתוך lib/email.ts).
const SEND_DELAY_MS = 600;
const PAGE_SIZE = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RunContext {
  now: Date;
  siteUrl: string;
  deadline: number;
  getPhotographerEmail: (authUserId: string | null | undefined) => Promise<string | undefined>;
  // כישלון של שלב שלם (שאילתה שנכשלה / חריגה) - מחזיר 500 בסוף הריצה
  stepErrors: { step: string; error: string }[];
  // כישלון של פריט בודד (מייל אחד שלא נשלח וכו') - מדווח, לא מכשיל את הריצה
  itemErrors: { step: string; id: string; error: string }[];
  stoppedEarly: boolean;
  sendsSoFar: number;
}

// השהיה לפני כל שליחה (חוץ מהראשונה), ובדיקת תקציב הזמן. false = לעצור.
async function beforeSend(ctx: RunContext): Promise<boolean> {
  if (Date.now() > ctx.deadline) {
    ctx.stoppedEarly = true;
    return false;
  }
  if (ctx.sendsSoFar > 0) await sleep(SEND_DELAY_MS);
  ctx.sendsSoFar++;
  return true;
}

// כל שלב רץ בנפרד - שגיאה בשלב אחד לא מדלגת על השלבים שאחריו.
async function runStep<T extends Record<string, unknown>>(ctx: RunContext, step: string, fn: () => Promise<T>): Promise<Partial<T>> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[cron/tick] שלב ${step} נכשל`, err);
    ctx.stepErrors.push({ step, error: errorMessage(err) });
    return {};
  }
}

function itemError(ctx: RunContext, step: string, id: string, err: unknown) {
  console.error(`[cron/tick] ${step}: פריט ${id} נכשל`, err);
  ctx.itemErrors.push({ step, id, error: errorMessage(err) });
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'לא מורשה' }, { status: 401 });
  }

  const now = new Date();
  const ctx: RunContext = {
    now,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin,
    deadline: Date.now() + RUN_BUDGET_MS,
    getPhotographerEmail: createPhotographerEmailLookup(),
    stepErrors: [],
    itemErrors: [],
    stoppedEarly: false,
    sendsSoFar: 0,
  };

  const expire = await runStep(ctx, 'expire', () => expireGalleries(ctx));
  const reminders = await runStep(ctx, 'expiryReminders', () => sendExpiryReminders(ctx));
  const warnings = await runStep(ctx, 'originalsWarnings', () => sendOriginalsWarnings(ctx));
  const cleanup = await runStep(ctx, 'originalsCleanup', () => cleanupOriginals(ctx));
  const shootReminders = await runStep(ctx, 'shootReminders', () => sendShootReminders(ctx));
  const shootSummaries = await runStep(ctx, 'shootSummaries', () => sendShootSummaries(ctx));

  const failed = ctx.stepErrors.length > 0;
  return NextResponse.json(
    {
      ok: !failed,
      ...expire,
      ...reminders,
      ...warnings,
      ...cleanup,
      ...shootReminders,
      ...shootSummaries,
      stoppedEarly: ctx.stoppedEarly,
      ...(failed ? { stepErrors: ctx.stepErrors } : {}),
      ...(ctx.itemErrors.length ? { itemErrors: ctx.itemErrors } : {}),
    },
    { status: failed ? 500 : 200 }
  );
}

// 1. גלריות שפג תוקפן עוברות ל-expired (מלבד כאלה שכבר הושלמו)
async function expireGalleries(ctx: RunContext) {
  const { data, error } = await supabaseAdmin
    .from('galleries')
    .update({ status: 'expired' })
    .not('expires_at', 'is', null)
    .lt('expires_at', ctx.now.toISOString())
    .in('status', ['draft', 'sent', 'in_progress'])
    .select('id');
  if (error) throw new Error(`עדכון גלריות שפג תוקפן נכשל: ${error.message}`);
  return { expiredCount: data?.length ?? 0 };
}

// 2. גלריות שמתקרבות לתוקף ועוד לא נשלחה עליהן תזכורת - שולחים אחת (חד-פעמית).
// כולל גלריות 'completed' שהצלמת פתחה מחדש לבחירה (reopened_for_selection_at) -
// הלקוחה שוב בוחרת בהן, אז התזכורת רלוונטית.
async function sendExpiryReminders(ctx: RunContext) {
  const { now, siteUrl } = ctx;
  const { rows: candidates, error } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('galleries')
      .select(
        'id, expires_at, reminder_days, status, clients(full_name, email, access_code), photographers(business_name, reminder_days_default, auth_user_id)'
      )
      .or('status.in.(sent,in_progress),and(status.eq.completed,reopened_for_selection_at.not.is.null)')
      .not('expires_at', 'is', null)
      .gte('expires_at', now.toISOString())
      .lte('expires_at', expiryReminderQueryUpperBound(now))
      .is('last_reminder_sent_at', null)
      .order('expires_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  , PAGE_SIZE);
  if (error) throw new Error(`שליפת מועמדות לתזכורת נכשלה: ${errorMessage(error)}`);

  let remindersSent = 0;

  for (const gallery of candidates) {
    try {
      const client = (gallery as any).clients;
      const photographer = (gallery as any).photographers;
      if (!client?.email || !photographer || !gallery.expires_at) continue;

      const reminderDays = resolveExpiryReminderDays(gallery.reminder_days, photographer.reminder_days_default);
      if (!isExpiryReminderDue(gallery.expires_at, reminderDays, now)) continue;

      if (!(await beforeSend(ctx))) break;

      // "תופסים" את הגלריה לפני השליחה (כמו בשלב 5) - שתי ריצות מקבילות לא
      // ישלחו פעמיים. אם השליחה נכשלת, משחררים כדי שהריצה הבאה תנסה שוב.
      const claimedAt = now.toISOString();
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('galleries')
        .update({ last_reminder_sent_at: claimedAt })
        .eq('id', gallery.id)
        .is('last_reminder_sent_at', null)
        .select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) continue;

      const result = await sendExpiryReminderEmail({
        to: client.email,
        clientName: client.full_name,
        businessName: photographer.business_name,
        galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
        accessCode: client.access_code,
        expiresAt: gallery.expires_at,
        replyTo: await ctx.getPhotographerEmail(photographer.auth_user_id),
      });

      if (result.sent) {
        remindersSent++;
      } else {
        await supabaseAdmin
          .from('galleries')
          .update({ last_reminder_sent_at: null })
          .eq('id', gallery.id)
          .eq('last_reminder_sent_at', claimedAt);
        itemError(ctx, 'expiryReminders', gallery.id, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'expiryReminders', gallery.id, err);
    }
  }

  return { candidatesChecked: candidates.length, remindersSent };
}

// 3. גלריות שיעברו 30 יום ממסירה בעוד 5 ימים או פחות - התראת מייל חד-פעמית
// לצלמת, כדי שתספיק להוריד את המקור לפני המחיקה הבלתי-הפיכה בשלב 4.
async function sendOriginalsWarnings(ctx: RunContext) {
  const { now, siteUrl } = ctx;
  const { rows: candidates, error } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('galleries')
      .select('id, delivered_at, clients(full_name), photographers(auth_user_id)')
      // רק בחירה סופית (completed, לא פתוחה מחדש) - כמו isOriginalsCleanupDue
      .eq('status', 'completed')
      .is('reopened_for_selection_at', null)
      .not('delivered_at', 'is', null)
      .lt('delivered_at', originalsWarningThreshold(now))
      .is('originals_cleaned_up_at', null)
      .is('originals_deletion_warning_sent_at', null)
      .order('delivered_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  , PAGE_SIZE);
  if (error) throw new Error(`שליפת מועמדות להתראת מחיקת מקור נכשלה: ${errorMessage(error)}`);

  let originalsWarningsSent = 0;

  for (const gallery of candidates) {
    try {
      const client = (gallery as any).clients;
      const photographer = (gallery as any).photographers;
      if (!client?.full_name || !photographer?.auth_user_id || !gallery.delivered_at) continue;

      const photographerEmail = await ctx.getPhotographerEmail(photographer.auth_user_id);
      if (!photographerEmail) continue;

      if (!(await beforeSend(ctx))) break;

      const claimedAt = now.toISOString();
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('galleries')
        .update({ originals_deletion_warning_sent_at: claimedAt })
        .eq('id', gallery.id)
        .is('originals_deletion_warning_sent_at', null)
        .select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) continue;

      const result = await sendOriginalsDeletionWarningEmail({
        to: photographerEmail,
        clientName: client.full_name,
        deletionDate: toHebrewDateString(originalsDeletionDate(gallery.delivered_at, now)),
        dashboardUrl: `${siteUrl}/dashboard/galleries/${gallery.id}/edit`,
      });

      if (result.sent) {
        originalsWarningsSent++;
      } else {
        await supabaseAdmin
          .from('galleries')
          .update({ originals_deletion_warning_sent_at: null })
          .eq('id', gallery.id)
          .eq('originals_deletion_warning_sent_at', claimedAt);
        itemError(ctx, 'originalsWarnings', gallery.id, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'originalsWarnings', gallery.id, err);
    }
  }

  return { originalsWarningsSent };
}

// 4. גלריות שנמסרו לפני 30+ יום *וגם* שהצלמת קיבלה עליהן התראה לפני 5+ ימים -
// מוחקות את קבצי המקור (לא הערוכים!) כדי לפנות מקום באחסון (R2, ראו lib/r2.ts).
// מסמנים originals_cleaned_up_at רק אם כל השליפות והמחיקות הצליחו - אחרת
// הריצה הבאה תנסה שוב (מחיקה ב-R2 היא idempotent).
async function cleanupOriginals(ctx: RunContext) {
  const { now } = ctx;
  const { rows: galleries, error } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('galleries')
      .select('id, status, reopened_for_selection_at, delivered_at, originals_cleaned_up_at, originals_deletion_warning_sent_at')
      // רק בחירה סופית (completed, לא פתוחה מחדש) - נבדק שוב ב-isOriginalsCleanupDue
      .eq('status', 'completed')
      .is('reopened_for_selection_at', null)
      .not('delivered_at', 'is', null)
      .lt('delivered_at', originalsCleanupThreshold(now))
      .is('originals_cleaned_up_at', null)
      .not('originals_deletion_warning_sent_at', 'is', null)
      .lte('originals_deletion_warning_sent_at', originalsWarningSentQueryUpperBound(now))
      .order('id', { ascending: true })
      .range(from, to)
  , PAGE_SIZE);
  if (error) throw new Error(`שליפת גלריות לניקוי מקור נכשלה: ${errorMessage(error)}`);

  let originalsCleanedGalleries = 0;
  let originalFilesDeleted = 0;

  for (const gallery of galleries) {
    if (!isOriginalsCleanupDue(gallery, now)) continue;
    if (Date.now() > ctx.deadline) {
      ctx.stoppedEarly = true;
      break;
    }

    try {
      const { rows: photos, error: photosError } = await fetchAllPages((from, to) =>
        supabaseAdmin
          .from('photos')
          .select('id, file_path, thumbnail_path')
          .eq('gallery_id', gallery.id)
          .order('id', { ascending: true })
          .range(from, to)
      , 1000);
      if (photosError) throw new Error(`שליפת תמונות נכשלה: ${errorMessage(photosError)}`);

      const paths = deletableOriginalPaths(photos);
      if (paths.length > 0) {
        const result = await deleteObjects(paths);
        originalFilesDeleted += result.deletedCount;
        if (result.failed.length > 0) {
          const sample = result.failed.slice(0, 3).map((f) => `${f.key}: ${f.code ?? ''} ${f.message ?? ''}`.trim());
          throw new Error(`מחיקת ${result.failed.length} קבצים נכשלה (${sample.join('; ')})`);
        }
      }

      // מסמנים "נוקה" גם אם לא היה מה למחוק (כל התמונות נכשלו בעיבוד) - כדי
      // שלא נבדוק את אותה גלריה שוב בכל ריצה יומית.
      const { error: markError } = await supabaseAdmin
        .from('galleries')
        .update({ originals_cleaned_up_at: now.toISOString() })
        .eq('id', gallery.id);
      if (markError) throw markError;
      originalsCleanedGalleries++;
    } catch (err) {
      itemError(ctx, 'originalsCleanup', gallery.id, err);
    }
  }

  return { originalsCleanedGalleries, originalFilesDeleted };
}

// מייל הצלמת (מ-auth.users) עם cache לריצה הנוכחית - צלמת עם כמה גלריות/צילומים
// לא צריכה כמה קריאות auth admin. best-effort: כישלון = undefined (שולחים בלי
// reply-to במקום להפיל את הריצה).
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
      // בכוונה שקט - ראו הערה למעלה
    }
    cache.set(authUserId, email);
    return email;
  };
}

// 5. תזכורת ללקוחה N ימים לפני הצילום (photographers.shoot_reminder_days,
// ברירת מחדל 1). ההחלטה "האם עכשיו" היא לוגיקה טהורה ב-lib/shoots.ts.
async function sendShootReminders(ctx: RunContext) {
  const { now } = ctx;
  const todayIsrael = israelDateString(now);

  const { rows: shootCandidates, error } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('shoots')
      .select(
        'id, shoot_date, start_time, location, reminder_sent_at, clients(full_name, email), photographers(business_name, shoot_reminder_days, auth_user_id)'
      )
      .is('reminder_sent_at', null)
      .gte('shoot_date', todayIsrael)
      .lte('shoot_date', addDaysToDateString(todayIsrael, MAX_SHOOT_REMINDER_DAYS))
      .order('shoot_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  , PAGE_SIZE);
  if (error) throw new Error(`שליפת צילומים לתזכורת נכשלה: ${errorMessage(error)}`);

  const dueShoots = selectShootsNeedingReminder(shootCandidates, (shoot) => (shoot as any).photographers?.shoot_reminder_days, now);
  let shootRemindersSent = 0;

  for (const shoot of dueShoots) {
    try {
      const client = (shoot as any).clients;
      const photographer = (shoot as any).photographers;
      if (!client?.email || !photographer) continue;

      if (!(await beforeSend(ctx))) break;

      // "תופסים" את הצילום לפני השליחה (update מותנה ב-reminder_sent_at is null) -
      // כך שתי ריצות cron מקבילות לא ישלחו את אותה תזכורת פעמיים. אם השליחה
      // נכשלת, משחררים חזרה כדי שהריצה הבאה תנסה שוב.
      const claimedAt = now.toISOString();
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('shoots')
        .update({ reminder_sent_at: claimedAt })
        .eq('id', shoot.id)
        .is('reminder_sent_at', null)
        .select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) continue;

      const result = await sendShootReminderEmail({
        to: client.email,
        clientName: client.full_name,
        businessName: photographer.business_name,
        shootDate: shoot.shoot_date,
        startTime: shoot.start_time,
        location: shoot.location,
        whenLabel: daysUntilLabel(daysBetweenDateStrings(todayIsrael, shoot.shoot_date)),
        replyTo: await ctx.getPhotographerEmail(photographer.auth_user_id),
      });

      if (result.sent) {
        shootRemindersSent++;
      } else {
        await supabaseAdmin.from('shoots').update({ reminder_sent_at: null }).eq('id', shoot.id).eq('reminder_sent_at', claimedAt);
        itemError(ctx, 'shootReminders', shoot.id, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'shootReminders', shoot.id, err);
    }
  }

  return { shootReminderCandidates: shootCandidates.length, shootRemindersSent };
}

// 6. סיכום יומי לצלמת עם הצילומים של מחר - רק לצלמות שלא כיבו את זה
// (shoot_daily_summary_enabled) ורק פעם אחת ליום (shoot_summary_sent_on).
async function sendShootSummaries(ctx: RunContext) {
  const { now, siteUrl } = ctx;
  const todayIsrael = israelDateString(now);
  const tomorrowIsrael = israelTomorrowDateString(now);

  const { rows: tomorrowShoots, error } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('shoots')
      .select(
        'id, photographer_id, start_time, location, notes, clients(full_name), photographers(auth_user_id, shoot_daily_summary_enabled, shoot_summary_sent_on)'
      )
      .eq('shoot_date', tomorrowIsrael)
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  , PAGE_SIZE);
  if (error) throw new Error(`שליפת צילומי מחר נכשלה: ${errorMessage(error)}`);

  const byPhotographer = new Map<string, typeof tomorrowShoots>();
  for (const shoot of tomorrowShoots) {
    const list = byPhotographer.get(shoot.photographer_id) ?? [];
    list.push(shoot);
    byPhotographer.set(shoot.photographer_id, list);
  }

  let shootSummariesSent = 0;

  for (const [photographerId, shoots] of Array.from(byPhotographer.entries())) {
    try {
      const photographer = (shoots[0] as any).photographers;
      if (!photographer || !shouldSendDailySummary(photographer.shoot_daily_summary_enabled, photographer.shoot_summary_sent_on, now)) {
        continue;
      }

      const photographerEmail = await ctx.getPhotographerEmail(photographer.auth_user_id);
      if (!photographerEmail) continue;

      if (!(await beforeSend(ctx))) break;

      // אותה "תפיסה" מותנית כמו בשלב 5, כאן ליום: רק אם עוד לא סומן היום.
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('photographers')
        .update({ shoot_summary_sent_on: todayIsrael })
        .eq('id', photographerId)
        .or(`shoot_summary_sent_on.is.null,shoot_summary_sent_on.neq.${todayIsrael}`)
        .select('id');
      if (claimError) throw claimError;
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
        itemError(ctx, 'shootSummaries', photographerId, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'shootSummaries', photographerId, err);
    }
  }

  return { shootSummariesSent };
}
