import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  sendAnniversaryEmail,
  sendExpiryReminderEmail,
  sendOriginalsDeletionWarningEmail,
  sendShootReminderEmail,
  sendShootsDailySummaryEmail,
  type DailySummaryDateReminder,
} from '@/lib/email';
import { israelDateString, daysBetweenDateStrings, addDaysToDateString } from '@/lib/israelTime';
import {
  selectShootsNeedingReminder,
  shouldSendDailySummary,
  israelTomorrowDateString,
  daysUntilLabel,
  formatShootDateLabel,
  MAX_SHOOT_REMINDER_DAYS,
} from '@/lib/shoots';
import { canSendClientEmailsToday, isShabbatOrYomTovIsrael } from '@/lib/jewishCalendar';
import {
  clientDatesDueIn,
  familyLabel,
  greetingSuggestion,
  CLIENT_DATE_REMINDER_DAYS,
  type ClientDateRow,
} from '@/lib/clientDates';
import { toHebrewDateString } from '@/lib/hebrewDate';
import { deleteObjects } from '@/lib/r2';
import { applyRowGuard } from '@/lib/rowGuard';
import { fetchGalleryLanguageOrDefault } from '@/lib/i18n/galleryLanguage';
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
  originalsCleanupClaimGuard,
  shouldReleaseCleanupClaim,
  canClaimOriginalsWarning,
  originalsWarningClaimGuard,
  originalsWarningAfterSendPatch,
  planExpiryActions,
  shabbatExtensionQueryUpperBound,
  isAnniversaryEmailDue,
  anniversaryQueryBounds,
  isMissingTableError,
  fetchAllPages,
  errorMessage,
} from '@/lib/cronTick';
import { fetchClientGender, isMissingColumnError } from '@/lib/gender';

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
  // photographers.respect_shabbat (חסר/שגיאה = true) - ראו createRespectShabbatLookup
  respectShabbat: RespectShabbatLookup;
  // היום (בישראל) שבת או יום טוב - רק אז בכלל צריך לבדוק respect_shabbat לשליחה
  todayIsRestDay: boolean;
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
    respectShabbat: createRespectShabbatLookup(),
    todayIsRestDay: isShabbatOrYomTovIsrael(israelDateString(now)),
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
  const anniversaries = await runStep(ctx, 'anniversaryEmails', () => sendAnniversaryEmails(ctx));

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
      ...anniversaries,
      todayIsRestDay: ctx.todayIsRestDay,
      stoppedEarly: ctx.stoppedEarly,
      ...(failed ? { stepErrors: ctx.stepErrors } : {}),
      ...(ctx.itemErrors.length ? { itemErrors: ctx.itemErrors } : {}),
    },
    { status: failed ? 500 : 200 }
  );
}

const ACTIVE_STATUSES = ['draft', 'sent', 'in_progress'];
const ID_CHUNK = 200;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// 1. גלריות שפג תוקפן עוברות ל-expired (מלבד כאלה שכבר הושלמו). תפוגה שנופלת
// בשבת/חג בישראל (לצלמות עם respect_shabbat, ברירת המחדל) נדחית קודם לסוף יום
// החול הבא - expires_at מתעדכן בפועל, כך שגם הגישה של הלקוחה וגם הדשבורד
// מציגים את התאריך החדש. ראו planExpiryActions ב-lib/cronTick.ts.
async function expireGalleries(ctx: RunContext) {
  const { now } = ctx;
  const { rows, error } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('galleries')
      .select('id, expires_at, photographer_id')
      .not('expires_at', 'is', null)
      .lt('expires_at', shabbatExtensionQueryUpperBound(now))
      .in('status', ACTIVE_STATUSES)
      .order('id', { ascending: true })
      .range(from, to)
  , PAGE_SIZE);
  if (error) throw new Error(`שליפת גלריות לתפוגה נכשלה: ${errorMessage(error)}`);

  await ctx.respectShabbat.preload(rows.map((r) => r.photographer_id));
  const plan = planExpiryActions(rows, (id) => ctx.respectShabbat.get(id), now);

  let expiryExtendedForShabbat = 0;
  for (const item of plan.extend) {
    // מותנה בערך שנקרא - אם הצלמת שינתה את התוקף בינתיים, לא דורסים
    const { data, error: extendError } = await supabaseAdmin
      .from('galleries')
      .update({ expires_at: item.to })
      .eq('id', item.id)
      .eq('expires_at', item.from)
      .in('status', ACTIVE_STATUSES)
      .select('id');
    if (extendError) itemError(ctx, 'expire', item.id, extendError);
    else if (data?.length) expiryExtendedForShabbat++;
  }

  let expiredCount = 0;
  for (const ids of chunks(plan.expire, ID_CHUNK)) {
    const { data, error: expireError } = await supabaseAdmin
      .from('galleries')
      .update({ status: 'expired' })
      .in('id', ids)
      .lt('expires_at', now.toISOString())
      .in('status', ACTIVE_STATUSES)
      .select('id');
    if (expireError) throw new Error(`עדכון גלריות שפג תוקפן נכשל: ${expireError.message}`);
    expiredCount += data?.length ?? 0;
  }
  return { expiredCount, expiryExtendedForShabbat };
}

// מיילים אוטומטיים ללקוחות לא יוצאים בשבת/חג (photographers.respect_shabbat) -
// הם פשוט לא נתפסים היום, וייצאו בריצה של יום החול הבא (כל השלבים idempotent).
async function clientSendBlockedToday(ctx: RunContext, photographerId: string | null | undefined): Promise<boolean> {
  if (!ctx.todayIsRestDay) return false;
  if (!photographerId) return true;
  await ctx.respectShabbat.preload([photographerId]);
  return !canSendClientEmailsToday(ctx.now, ctx.respectShabbat.get(photographerId));
}

// 2. גלריות שמתקרבות לתוקף ועוד לא נשלחה עליהן תזכורת - שולחים אחת (חד-פעמית).
// כולל גלריות 'completed' שהצלמת פתחה מחדש לבחירה (reopened_for_selection_at) -
// הלקוחה שוב בוחרת בהן, אז התזכורת רלוונטית.
// גלריות דוגמה (galleries.is_sample, מאשף הפתיחה) - הלקוחה בהן היא הצלמת
// עצמה, אז לא שולחים להן מיילים "ללקוחה" (תזכורת תפוגה, "לפני שנה").
// best-effort בשאילתה נפרדת: עמודה חסרה (מיגרציה שלא רצה) = אין גלריות
// דוגמה, במקום להפיל את שאילתות השלבים עצמם.
async function loadSampleGalleryIds(): Promise<Set<string>> {
  const { rows, error } = await fetchAllPages((from, to) =>
    supabaseAdmin.from('galleries').select('id').eq('is_sample', true).order('id', { ascending: true }).range(from, to)
  , PAGE_SIZE);
  if (error) {
    if (!isMissingColumnError(error as { code?: string; message?: string })) {
      console.warn('[cron/tick] שליפת גלריות דוגמה נכשלה - ממשיכים בלי סינון', errorMessage(error));
    }
    return new Set();
  }
  return new Set(rows.map((r) => r.id as string));
}

async function sendExpiryReminders(ctx: RunContext) {
  const { now, siteUrl } = ctx;
  const sampleIds = await loadSampleGalleryIds();
  const { rows: candidates, error } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('galleries')
      .select(
        'id, photographer_id, expires_at, reminder_days, status, clients(full_name, email, access_code), photographers(business_name, reminder_days_default, auth_user_id)'
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
  let remindersDeferredForShabbat = 0;
  if (ctx.todayIsRestDay) await ctx.respectShabbat.preload(candidates.map((g) => g.photographer_id));

  for (const gallery of candidates) {
    let claimedAt: string | null = null;
    try {
      const client = (gallery as any).clients;
      const photographer = (gallery as any).photographers;
      if (!client?.email || !photographer || !gallery.expires_at) continue;
      if (sampleIds.has(gallery.id)) continue;

      const reminderDays = resolveExpiryReminderDays(gallery.reminder_days, photographer.reminder_days_default);
      if (!isExpiryReminderDue(gallery.expires_at, reminderDays, now)) continue;
      if (await clientSendBlockedToday(ctx, gallery.photographer_id)) {
        remindersDeferredForShabbat++;
        continue;
      }

      if (!(await beforeSend(ctx))) break;

      // "תופסים" את הגלריה לפני השליחה (כמו בשלב 5) - שתי ריצות מקבילות לא
      // ישלחו פעמיים. אם השליחה נכשלת, משחררים כדי שהריצה הבאה תנסה שוב.
      const attemptAt = now.toISOString();
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('galleries')
        .update({ last_reminder_sent_at: attemptAt })
        .eq('id', gallery.id)
        .is('last_reminder_sent_at', null)
        .select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) continue;
      claimedAt = attemptAt;

      const result = await sendExpiryReminderEmail({
        // שפת הגלריה (galleries.language) - עמודה חסרה = עברית
        language: await fetchGalleryLanguageOrDefault(supabaseAdmin, gallery.id),
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
        claimedAt = null;
      } else {
        itemError(ctx, 'expiryReminders', gallery.id, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'expiryReminders', gallery.id, err);
    }
    // לא נשלח אחרי שנתפס (כישלון או חריגה) - משחררים כדי שהריצה הבאה תנסה שוב
    if (claimedAt) {
      const releaseAt = claimedAt;
      await releaseClaim(ctx, 'expiryReminders', gallery.id, () =>
        supabaseAdmin
          .from('galleries')
          .update({ last_reminder_sent_at: null })
          .eq('id', gallery.id)
          .eq('last_reminder_sent_at', releaseAt)
          .select('id')
      );
    }
  }

  return { candidatesChecked: candidates.length, remindersSent, remindersDeferredForShabbat };
}

// 3. גלריות שיעברו 30 יום ממסירה בעוד 5 ימים או פחות - התראת מייל חד-פעמית
// לצלמת, כדי שתספיק להוריד את המקור לפני המחיקה הבלתי-הפיכה בשלב 4.
// originals_deletion_warning_sent_at נכתב רק אחרי שליחה מוצלחת (שלב 4 דורש אותו);
// התפיסה נגד שליחה כפולה היא בעמודה נפרדת - ראו canClaimOriginalsWarning ב-lib/cronTick.ts.
async function sendOriginalsWarnings(ctx: RunContext) {
  const { now, siteUrl } = ctx;
  const fetchCandidates = (withClaim: boolean) =>
    fetchAllPages((from, to) =>
      supabaseAdmin
        .from('galleries')
        .select(
          `id, delivered_at, originals_deletion_warning_sent_at${withClaim ? ', originals_deletion_warning_claimed_at' : ''}, clients(full_name), photographers(auth_user_id)`
        )
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

  // העמודה originals_deletion_warning_claimed_at נוספה במיגרציה (סוף supabase/schema.sql).
  // עד שמריצים אותה - שולחים בלי תפיסה (במקרה נדיר: התראה כפולה), אבל עדיין
  // מסמנים "נשלחה" רק אחרי שליחה מוצלחת.
  let claimSupported = true;
  let { rows: candidates, error } = await fetchCandidates(true);
  if (error && isMissingColumnError(error as { code?: string; message?: string })) {
    console.warn('[cron/tick] originals_deletion_warning_claimed_at חסרה - שולחים התראות בלי תפיסה (הריצי את המיגרציה ב-supabase/schema.sql)');
    claimSupported = false;
    ({ rows: candidates, error } = await fetchCandidates(false));
  }
  if (error) throw new Error(`שליפת מועמדות להתראת מחיקת מקור נכשלה: ${errorMessage(error)}`);

  let originalsWarningsSent = 0;

  for (const gallery of candidates as any[]) {
    let claimedAt: string | null = null;
    try {
      const client = gallery.clients;
      const photographer = gallery.photographers;
      if (!client?.full_name || !photographer?.auth_user_id || !gallery.delivered_at) continue;
      if (claimSupported && !canClaimOriginalsWarning(gallery, now)) continue;

      const photographerEmail = await ctx.getPhotographerEmail(photographer.auth_user_id);
      if (!photographerEmail) continue;

      if (!(await beforeSend(ctx))) break;

      if (claimSupported) {
        const attemptAt = new Date().toISOString();
        const { data: claimed, error: claimError } = await applyRowGuard(
          supabaseAdmin.from('galleries').update({ originals_deletion_warning_claimed_at: attemptAt }).eq('id', gallery.id),
          originalsWarningClaimGuard(gallery)
        ).select('id');
        if (claimError) throw claimError;
        if (!claimed?.length) continue;
        claimedAt = attemptAt;
      }

      const result = await sendOriginalsDeletionWarningEmail({
        to: photographerEmail,
        clientName: client.full_name,
        deletionDate: toHebrewDateString(originalsDeletionDate(gallery.delivered_at, now)),
        dashboardUrl: `${siteUrl}/dashboard/galleries/${gallery.id}/edit`,
      });

      const patch = originalsWarningAfterSendPatch(result.sent, new Date().toISOString(), claimSupported);
      if (patch) {
        // מותנה בתפיסה שלנו (או, בלי תפיסה, בכך שעוד לא סומנה) - לא דורסים מצב שהשתנה.
        const base = supabaseAdmin.from('galleries').update(patch).eq('id', gallery.id);
        const guarded = claimedAt
          ? base.eq('originals_deletion_warning_claimed_at', claimedAt)
          : base.is('originals_deletion_warning_sent_at', null);
        const { data: written, error: writeError } = await guarded.select('id');
        if (writeError || !written?.length) {
          // אחרי שליחה: לא סומן "נשלחה" -> אין מחיקה (בטוח), לכל היותר התראה כפולה מחר.
          // אחרי כישלון: התפיסה תתיישן לבד (WARNING_CLAIM_STALE_MS).
          itemError(ctx, 'originalsWarnings', gallery.id, writeError ?? `עדכון אחרי שליחה (sent=${result.sent}) לא תאם אף שורה`);
        }
      }
      claimedAt = null;

      if (result.sent) {
        originalsWarningsSent++;
      } else {
        itemError(ctx, 'originalsWarnings', gallery.id, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'originalsWarnings', gallery.id, err);
      if (claimedAt) {
        await releaseClaim(ctx, 'originalsWarnings', gallery.id, () =>
          supabaseAdmin
            .from('galleries')
            .update({ originals_deletion_warning_claimed_at: null })
            .eq('id', gallery.id)
            .eq('originals_deletion_warning_claimed_at', claimedAt as string)
            .select('id')
        );
      }
    }
  }

  return { originalsWarningsSent };
}

// שחרור "תפיסה" אחרי שליחה שנכשלה - בודקים את התוצאה ומדווחים. שחרור שנכשל
// בתזכורות משמעו שהתזכורת לא תישלח שוב (לא מסוכן, אבל צריך לדעת על זה).
async function releaseClaim(
  ctx: RunContext,
  step: string,
  id: string,
  run: () => PromiseLike<{ data: unknown[] | null; error: unknown }>
) {
  try {
    const { data, error } = await run();
    if (error) itemError(ctx, step, id, `שחרור התפיסה נכשל: ${errorMessage(error)}`);
    else if (!data?.length) console.warn(`[cron/tick] ${step}: שחרור התפיסה של ${id} לא תאם אף שורה (השורה השתנתה בינתיים)`);
  } catch (err) {
    itemError(ctx, step, id, `שחרור התפיסה נכשל: ${errorMessage(err)}`);
  }
}

// 4. גלריות שנמסרו לפני 30+ יום *וגם* שהצלמת קיבלה עליהן התראה לפני 5+ ימים -
// מוחקות את קבצי המקור (לא הערוכים!) כדי לפנות מקום באחסון (R2, ראו lib/r2.ts).
// originals_cleaned_up_at מסומן *לפני* המחיקה, כתפיסה מותנית (ראו
// originalsCleanupClaimGuard) - כך פתיחה מחדש של הבחירה באמצע לא יכולה להיגמר
// במחיקת המקור של גלריה פעילה. אם הניקוי נכשל לפני שנמחק קובץ כלשהו, התפיסה
// משתחררת והריצה הבאה תנסה שוב (מחיקה ב-R2 היא idempotent).
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
  // גלריות שהיו זכאיות בשליפה אבל השתנו לפני התפיסה (למשל נפתחו מחדש לבחירה)
  let originalsCleanupSkipped = 0;

  for (const gallery of galleries) {
    if (!isOriginalsCleanupDue(gallery, now)) continue;
    if (Date.now() > ctx.deadline) {
      ctx.stoppedEarly = true;
      break;
    }

    // קודם "תופסים" (UPDATE מותנה במצב שנקרא - originalsCleanupClaimGuard), ורק
    // אז מוחקים: אם הצלמת פתחה מחדש את הבחירה / ביטלה מסירה מאז השליפה, ה-UPDATE
    // לא תואם אף שורה ולא נוגעים בקבצים. מסמנים "נוקה" גם אם לא היה מה למחוק
    // (כל התמונות נכשלו בעיבוד) - כדי שלא נבדוק את אותה גלריה שוב בכל ריצה יומית.
    const claimedAt = now.toISOString();
    let claimed = false;
    let deletedForGallery = 0;
    try {
      const { data: claimedRows, error: claimError } = await applyRowGuard(
        supabaseAdmin.from('galleries').update({ originals_cleaned_up_at: claimedAt }).eq('id', gallery.id),
        originalsCleanupClaimGuard(gallery)
      ).select('id');
      if (claimError) throw claimError;
      if (!claimedRows?.length) {
        originalsCleanupSkipped++;
        continue;
      }
      claimed = true;

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
        deletedForGallery = result.deletedCount;
        originalFilesDeleted += result.deletedCount;
        if (result.failed.length > 0) {
          const sample = result.failed.slice(0, 3).map((f) => `${f.key}: ${f.code ?? ''} ${f.message ?? ''}`.trim());
          throw new Error(`מחיקת ${result.failed.length} קבצים נכשלה (${sample.join('; ')})`);
        }
      }
      originalsCleanedGalleries++;
    } catch (err) {
      itemError(ctx, 'originalsCleanup', gallery.id, err);
      // ראו shouldReleaseCleanupClaim: משחררים רק אם המקור עדיין שלם
      if (claimed && shouldReleaseCleanupClaim(deletedForGallery)) {
        const { error: releaseError } = await supabaseAdmin
          .from('galleries')
          .update({ originals_cleaned_up_at: null })
          .eq('id', gallery.id)
          .eq('originals_cleaned_up_at', claimedAt);
        if (releaseError) itemError(ctx, 'originalsCleanup', gallery.id, releaseError);
      }
    }
  }

  return { originalsCleanedGalleries, originalFilesDeleted, originalsCleanupSkipped };
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
        'id, photographer_id, shoot_date, start_time, location, reminder_sent_at, clients(full_name, email), photographers(business_name, shoot_reminder_days, auth_user_id)'
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
  let shootRemindersDeferredForShabbat = 0;
  if (ctx.todayIsRestDay) await ctx.respectShabbat.preload(dueShoots.map((s) => s.photographer_id));

  for (const shoot of dueShoots) {
    let claimedAt: string | null = null;
    try {
      const client = (shoot as any).clients;
      const photographer = (shoot as any).photographers;
      if (!client?.email || !photographer) continue;
      if (await clientSendBlockedToday(ctx, shoot.photographer_id)) {
        shootRemindersDeferredForShabbat++;
        continue;
      }

      if (!(await beforeSend(ctx))) break;

      // "תופסים" את הצילום לפני השליחה (update מותנה ב-reminder_sent_at is null) -
      // כך שתי ריצות cron מקבילות לא ישלחו את אותה תזכורת פעמיים. אם השליחה
      // נכשלת, משחררים חזרה כדי שהריצה הבאה תנסה שוב.
      const attemptAt = now.toISOString();
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('shoots')
        .update({ reminder_sent_at: attemptAt })
        .eq('id', shoot.id)
        .is('reminder_sent_at', null)
        .select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) continue;
      claimedAt = attemptAt;

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
        claimedAt = null;
      } else {
        itemError(ctx, 'shootReminders', shoot.id, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'shootReminders', shoot.id, err);
    }
    // לא נשלח אחרי שנתפס (כישלון או חריגה) - משחררים כדי שהריצה הבאה תנסה שוב
    if (claimedAt) {
      const releaseAt = claimedAt;
      await releaseClaim(ctx, 'shootReminders', shoot.id, () =>
        supabaseAdmin.from('shoots').update({ reminder_sent_at: null }).eq('id', shoot.id).eq('reminder_sent_at', releaseAt).select('id')
      );
    }
  }

  return { shootReminderCandidates: shootCandidates.length, shootRemindersSent, shootRemindersDeferredForShabbat };
}

// 6. סיכום יומי לצלמת עם הצילומים של מחר ותאריכים חשובים של לקוחות בעוד 30
// יום - רק לצלמות שלא כיבו את זה (shoot_daily_summary_enabled) ורק פעם אחת ליום
// (shoot_summary_sent_on). מייל לצלמת, לא ללקוחה - לא תלוי ב-respect_shabbat.
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

  // תאריכים חשובים של לקוחות שחלים בעוד 30 יום (client_dates, lib/clientDates.ts) -
  // הסיכום נשלח גם לצלמת שאין לה צילומים מחר אבל יש לה תזכורת כזו.
  const datesByPhotographer = await loadDueClientDates(todayIsrael);

  // פרטי הצלמת: מה-join של הצילומים, ולצלמות עם תאריכים בלבד - שאילתה נפרדת
  type SummaryPhotographer = { auth_user_id: string | null; shoot_daily_summary_enabled: boolean | null; shoot_summary_sent_on: string | null };
  const photographerInfo = new Map<string, SummaryPhotographer>();
  for (const [id, shoots] of Array.from(byPhotographer.entries())) {
    const p = (shoots[0] as any).photographers;
    if (p) photographerInfo.set(id, p);
  }
  const missingInfo = Array.from(datesByPhotographer.keys()).filter((id) => !photographerInfo.has(id));
  for (const ids of chunks(missingInfo, ID_CHUNK)) {
    const { data, error: infoError } = await supabaseAdmin
      .from('photographers')
      .select('id, auth_user_id, shoot_daily_summary_enabled, shoot_summary_sent_on')
      .in('id', ids);
    if (infoError) throw new Error(`שליפת צלמות לסיכום היומי נכשלה: ${infoError.message}`);
    for (const p of data ?? []) photographerInfo.set(p.id, p);
  }

  const photographerIds = Array.from(new Set([...Array.from(byPhotographer.keys()), ...Array.from(datesByPhotographer.keys())]));
  let shootSummariesSent = 0;

  for (const photographerId of photographerIds) {
    const shoots = byPhotographer.get(photographerId) ?? [];
    const dateReminders = datesByPhotographer.get(photographerId) ?? [];
    try {
      const photographer = photographerInfo.get(photographerId);
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
        dateReminders,
        dashboardUrl: `${siteUrl}/dashboard/calendar`,
        datesDashboardUrl: `${siteUrl}/dashboard/clients`,
      });

      if (result.sent) {
        shootSummariesSent++;
      } else {
        await supabaseAdmin
          .from('photographers')
          .update({ shoot_summary_sent_on: photographer.shoot_summary_sent_on ?? null })
          .eq('id', photographerId)
          // רק אם הסימון עדיין "היום" שכתבנו - לא לדרוס סימון של ריצה מקבילה/מאוחרת יותר
          .eq('shoot_summary_sent_on', todayIsrael);
        itemError(ctx, 'shootSummaries', photographerId, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'shootSummaries', photographerId, err);
    }
  }

  return { shootSummariesSent };
}

// כל התאריכים החשובים, מקובצים לפי צלמת, רק אלה שחלים בדיוק בעוד
// CLIENT_DATE_REMINDER_DAYS ימים. טבלה חסרה (מיגרציה שלא רצה) = מפה ריקה.
async function loadDueClientDates(todayIsrael: string): Promise<Map<string, DailySummaryDateReminder[]>> {
  const result = new Map<string, DailySummaryDateReminder[]>();
  const { rows, error } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('client_dates')
      .select('id, client_id, photographer_id, label, date_greg, hebrew_month, hebrew_day, clients(full_name)')
      .order('id', { ascending: true })
      .range(from, to)
  , 1000);
  if (error) {
    if (isMissingTableError(error as { code?: string; message?: string })) {
      console.warn('[cron/tick] client_dates חסרה - הסיכום היומי בלי תאריכים חשובים (הריצי את המיגרציה ב-supabase/schema.sql)');
      return result;
    }
    throw new Error(`שליפת תאריכים חשובים נכשלה: ${errorMessage(error)}`);
  }

  const target = addDaysToDateString(todayIsrael, CLIENT_DATE_REMINDER_DAYS);
  const dateText = `${formatShootDateLabel(target)} · ${toHebrewDateString(new Date(`${target}T12:00:00Z`))}`;
  for (const row of clientDatesDueIn(rows as (ClientDateRow & { photographer_id: string })[], todayIsrael)) {
    const clientName = ((row as any).clients?.full_name as string | undefined) ?? '';
    const list = result.get(row.photographer_id) ?? [];
    list.push({
      label: row.label,
      clientLabel: familyLabel(clientName),
      daysAhead: CLIENT_DATE_REMINDER_DAYS,
      dateText,
      suggestion: greetingSuggestion(row.label),
    });
    result.set(row.photographer_id, list);
  }
  return result;
}

// 7. "לפני שנה צילמנו 💛" - ללקוחה כ-11 חודשים אחרי המסירה, רק לצלמות שהפעילו
// (photographers.anniversary_emails), פעם אחת לגלריה (galleries.anniversary_sent_at):
// תפיסה מותנית (is null) -> שליחה (עם timeout, ראו RESEND_TIMEOUT_MS) -> סימון
// זמן השליחה בפועל -> שחרור אם נכשלה. מכבד שבת/חג, שפת הגלריה ולשון הפנייה.
async function sendAnniversaryEmails(ctx: RunContext) {
  const { now, siteUrl } = ctx;

  const { rows: photographers, error: photographersError } = await fetchAllPages((from, to) =>
    supabaseAdmin
      .from('photographers')
      .select('id, business_name, logo_url, auth_user_id')
      .eq('anniversary_emails', true)
      .order('id', { ascending: true })
      .range(from, to)
  , PAGE_SIZE);
  if (photographersError) {
    if (isMissingColumnError(photographersError as { code?: string; message?: string })) {
      console.warn('[cron/tick] anniversary_emails חסרה - מדלגים על מיילי "לפני שנה" (הריצי את המיגרציה ב-supabase/schema.sql)');
      return { anniversaryEmailsSent: 0 };
    }
    throw new Error(`שליפת צלמות למייל "לפני שנה" נכשלה: ${errorMessage(photographersError)}`);
  }
  if (photographers.length === 0) return { anniversaryEmailsSent: 0 };

  const photographerById = new Map(photographers.map((p) => [p.id, p]));
  const bounds = anniversaryQueryBounds(now);
  const candidates: any[] = [];
  for (const ids of chunks(Array.from(photographerById.keys()), ID_CHUNK)) {
    const { rows, error } = await fetchAllPages((from, to) =>
      supabaseAdmin
        .from('galleries')
        .select('id, photographer_id, delivered_at, anniversary_sent_at, clients(full_name, email, access_code)')
        .in('photographer_id', ids)
        .not('delivered_at', 'is', null)
        .gte('delivered_at', bounds.from)
        .lte('delivered_at', bounds.to)
        .is('anniversary_sent_at', null)
        .order('delivered_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    , PAGE_SIZE);
    if (error) {
      if (isMissingColumnError(error as { code?: string; message?: string })) {
        console.warn('[cron/tick] anniversary_sent_at חסרה - מדלגים על מיילי "לפני שנה"');
        return { anniversaryEmailsSent: 0 };
      }
      throw new Error(`שליפת גלריות למייל "לפני שנה" נכשלה: ${errorMessage(error)}`);
    }
    candidates.push(...rows);
  }

  const sampleIds = await loadSampleGalleryIds();
  let anniversaryEmailsSent = 0;
  let anniversaryDeferredForShabbat = 0;
  if (ctx.todayIsRestDay) await ctx.respectShabbat.preload(candidates.map((g) => g.photographer_id));

  for (const gallery of candidates) {
    let claimedAt: string | null = null;
    try {
      const client = gallery.clients;
      const photographer = photographerById.get(gallery.photographer_id);
      if (!client?.email || !photographer) continue;
      if (sampleIds.has(gallery.id)) continue;
      if (!isAnniversaryEmailDue(gallery.delivered_at, gallery.anniversary_sent_at, now)) continue;
      if (await clientSendBlockedToday(ctx, gallery.photographer_id)) {
        anniversaryDeferredForShabbat++;
        continue;
      }

      if (!(await beforeSend(ctx))) break;

      const attemptAt = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('galleries')
        .update({ anniversary_sent_at: attemptAt })
        .eq('id', gallery.id)
        .is('anniversary_sent_at', null)
        .select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) continue;
      claimedAt = attemptAt;

      const result = await sendAnniversaryEmail({
        language: await fetchGalleryLanguageOrDefault(supabaseAdmin, gallery.id),
        clientGender: await fetchClientGender(supabaseAdmin, gallery.id),
        to: client.email,
        clientName: client.full_name,
        businessName: photographer.business_name,
        logoUrl: photographer.logo_url,
        galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
        accessCode: client.access_code,
        replyTo: await ctx.getPhotographerEmail(photographer.auth_user_id),
      });

      if (result.sent) {
        anniversaryEmailsSent++;
        // זמן השליחה בפועל במקום זמן התפיסה (מותנה בתפיסה שלנו)
        const { error: markError } = await supabaseAdmin
          .from('galleries')
          .update({ anniversary_sent_at: new Date().toISOString() })
          .eq('id', gallery.id)
          .eq('anniversary_sent_at', attemptAt);
        if (markError) console.warn(`[cron/tick] anniversaryEmails: עדכון זמן השליחה של ${gallery.id} נכשל (המייל כבר סומן כנשלח)`, markError);
        claimedAt = null;
      } else {
        itemError(ctx, 'anniversaryEmails', gallery.id, result.error ?? 'send failed');
      }
    } catch (err) {
      itemError(ctx, 'anniversaryEmails', gallery.id, err);
    }
    if (claimedAt) {
      const releaseAt = claimedAt;
      await releaseClaim(ctx, 'anniversaryEmails', gallery.id, () =>
        supabaseAdmin
          .from('galleries')
          .update({ anniversary_sent_at: null })
          .eq('id', gallery.id)
          .eq('anniversary_sent_at', releaseAt)
          .select('id')
      );
    }
  }

  return { anniversaryEmailsSent, anniversaryDeferredForShabbat };
}

// photographers.respect_shabbat לפי צלמת, עם cache לריצה. preload טוען כמה
// בבת אחת; get מחזיר true לכל מה שלא נטען / עמודה חסרה / שגיאה - כשלא בטוחים,
// עדיף לא לשלוח ללקוחה בשבת (המייל ייצא ממילא ביום החול הבא).
interface RespectShabbatLookup {
  preload: (photographerIds: (string | null | undefined)[]) => Promise<void>;
  get: (photographerId: string | null | undefined) => boolean;
}

function createRespectShabbatLookup(): RespectShabbatLookup {
  const cache = new Map<string, boolean>();
  let columnMissing = false;
  return {
    async preload(photographerIds) {
      if (columnMissing) return;
      const ids = Array.from(new Set(photographerIds.filter((id): id is string => !!id && !cache.has(id))));
      for (const chunk of chunks(ids, ID_CHUNK)) {
        try {
          const { data, error } = await supabaseAdmin.from('photographers').select('id, respect_shabbat').in('id', chunk);
          if (error) {
            if (isMissingColumnError(error)) {
              columnMissing = true;
              return;
            }
            console.warn('[cron/tick] טעינת respect_shabbat נכשלה - מניחים true', error);
            continue;
          }
          for (const row of data ?? []) cache.set(row.id, row.respect_shabbat !== false);
        } catch (err) {
          console.warn('[cron/tick] טעינת respect_shabbat נכשלה - מניחים true', err);
        }
      }
    },
    get(photographerId) {
      if (!photographerId) return true;
      return cache.get(photographerId) ?? true;
    },
  };
}
