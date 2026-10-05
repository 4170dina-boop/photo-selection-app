import { createClient as createAdminClient } from '@supabase/supabase-js';
import { toHebrewDateString } from '@/lib/hebrewDate';
import { formatShootDateLabel, formatShootTime } from '@/lib/shoots';

// שליחת מייל דרך Resend (REST API ישיר, בלי SDK נוסף). אם RESEND_API_KEY לא
// מוגדר - לא זורקים שגיאה, רק מדלגים ומדפיסים אזהרה. כך גם app/api/cron/tick/route.ts
// וגם app/api/galleries/route.ts ממשיכים לעבוד (בלי לשלוח בפועל) בסביבת פיתוח
// בלי שירות מייל מחובר.
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// כתובת השליחה: קודם app_settings בדאטהבייס (ניתנת לעריכה מ-/dashboard/admin
// אחרי שיש דומיין מאומת ב-Resend, בלי לגעת ב-Vercel), ואז נופלים חזרה
// למשתנה הסביבה, ואז לכתובת ה-sandbox הקבועה של Resend. נשמר ב-cache קצר
// (דקה) ברמת המודול - ריצת cron ששולחת עשרות מיילים לא צריכה שאילתה לכל
// מייל, ושינוי מ-/dashboard/admin עדיין נקלט תוך דקה לכל היותר.
const FROM_ADDRESS_CACHE_MS = 60 * 1000;
let fromAddressCache: { value: string; expiresAt: number } | null = null;

async function getFromAddress(): Promise<string> {
  if (fromAddressCache && fromAddressCache.expiresAt > Date.now()) return fromAddressCache.value;

  const fallback = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fallback;
  }

  let value = fallback;
  try {
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string
    );
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'resend_from_email').single();
    value = data?.value || fallback;
  } catch {
    // בכוונה שקט - עדיף לשלוח מהכתובת הישנה מאשר לא לשלוח בכלל
  }
  fromAddressCache = { value, expiresAt: Date.now() + FROM_ADDRESS_CACHE_MS };
  return value;
}

interface SendResult {
  sent: boolean;
  error?: string;
}

// בדיקת תקינות פשוטה (לא RFC מלא בכוונה) - משמשת את app/api/galleries/route.ts
// ו-app/api/galleries/[id]/route.ts כדי לסנן כתובות מייל נוספות (additional_invite_emails)
// לפני שמירה/שליחה, בלי לדרוש ספריית אימות חיצונית בשביל בדיקה כה בסיסית.
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export const MAX_ADDITIONAL_INVITE_EMAILS = 10;

// אימות additionalInviteEmails מגוף הבקשה (יצירה/עריכה של גלריה): חסר/null =
// רשימה ריקה; אחרת חייב להיות מערך של מחרוזות, כולן כתובות תקינות (אחרי
// trim, מחרוזות ריקות מסוננות), ועד MAX_ADDITIONAL_INVITE_EMAILS כתובות.
export function parseAdditionalInviteEmails(
  value: unknown
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((email) => typeof email !== 'string')) {
    return { ok: false, error: 'רשימת כתובות המייל הנוספות לא תקינה' };
  }
  const emails = (value as string[]).map((email) => email.trim()).filter((email) => email.length > 0);
  if (emails.length > MAX_ADDITIONAL_INVITE_EMAILS) {
    return { ok: false, error: `אפשר להוסיף עד ${MAX_ADDITIONAL_INVITE_EMAILS} כתובות מייל נוספות` };
  }
  if (emails.some((email) => !isValidEmail(email))) {
    return { ok: false, error: 'אחת מכתובות המייל הנוספות לא תקינה' };
  }
  return { ok: true, value: emails };
}

interface SendOptions {
  // שם התצוגה שמופיע אצל הנמען לצד הכתובת (למשל '"סטודיו דינה" <onboarding@resend.dev>') -
  // הכתובת עצמה נשארת קבועה (עד שיהיה דומיין מאומת ב-Resend), אבל שם התצוגה
  // הוא מה שרוב תוכנות המייל מציגות בפועל, ולכן זה מה שגורם למייל להיראות
  // כאילו הגיע "מהצלמת"/"מהאתר" ולא מכתובת גנרית.
  fromName?: string;
  // כדי שתשובה של לקוחה על המייל תגיע ישירות לתיבת הדואר של הצלמת, לא
  // לכתובת השליחה הטכנית של Resend.
  replyTo?: string;
}

// שם התצוגה נכנס לכותרת From בתוך מרכאות - מרכאות/לוכסן הפוך/סוגריים
// משולשים/ירידות שורה בשם העסק (טקסט חופשי של הצלמת) היו שוברים את הכותרת
// או מאפשרים להזריק כתובת אחרת, אז מסירים אותם לגמרי.
export function sanitizeDisplayName(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').replace(/["\\<>]/g, '').replace(/\s+/g, ' ').trim();
}

export function buildFromHeader(fromAddress: string, fromName?: string): string {
  const name = fromName ? sanitizeDisplayName(fromName) : '';
  return name ? `"${name}" <${fromAddress}>` : fromAddress;
}

// כמה לחכות לפני ניסיון חוזר יחיד אחרי 429 (rate limit של Resend) - לפי
// Retry-After אם קיים, עם תקרה כדי לא לתקוע בקשה/ריצת cron.
const MAX_RETRY_WAIT_MS = 5000;
export function retryDelayMs(retryAfterHeader: string | null | undefined): number {
  if (retryAfterHeader == null || retryAfterHeader.trim() === '') return 1000;
  const seconds = Number(retryAfterHeader);
  if (!Number.isFinite(seconds) || seconds < 0) return 1000;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postToResend(payload: string): Promise<Response> {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: payload,
  });
}

// לעולם לא זורקת - כל כישלון (רשת, timeout, תשובה לא תקינה) חוזר כ-
// { sent: false, error }. קריטי ל-cron: חריגה כאן הייתה משאירה שורות "תפוסות"
// (reminder_sent_at וכו') ומפילה את כל השלבים שאחריה.
async function sendEmail(to: string, subject: string, html: string, options: SendOptions = {}): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY לא מוגדר - מדלג על שליחת מייל ל-${to}`);
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const fromAddress = await getFromAddress();
    const from = buildFromHeader(fromAddress, options.fromName);

    const body: Record<string, unknown> = { from, to, subject, html };
    if (options.replyTo) body.reply_to = options.replyTo;
    const payload = JSON.stringify(body);

    let res = await postToResend(payload);
    if (res.status === 429) {
      await sleep(retryDelayMs(res.headers?.get?.('retry-after')));
      res = await postToResend(payload);
    }

    if (!res.ok) {
      let text = `HTTP ${res.status}`;
      try {
        text = (await res.text()) || text;
      } catch {
        // גוף התשובה לא קריא - נשארים עם קוד הסטטוס
      }
      console.error(`[email] שליחת מייל ל-${to} נכשלה: ${text}`);
      return { sent: false, error: text };
    }

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] שליחת מייל ל-${to} נכשלה (חריגה): ${message}`);
    return { sent: false, error: message };
  }
}

// ---------- נטרול ערכים בתוך HTML ----------

// כל ערך שמוכנס לתבנית HTML (שם לקוחה, שם עסק, קוד גישה, שמות קבצים, מיקום,
// הערות) הוא טקסט חופשי - מנטרלים תווים מיוחדים כדי שלא ישברו את המייל או
// יזריקו HTML/קישורים.
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// כתובת לשימוש בתוך href: רק http/https (לא javascript:, data: וכו'), ומנוטרלת
// לתוך attribute. null = כתובת לא תקינה - הכפתור פשוט לא יוצג.
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return escapeHtml(parsed.toString());
  } catch {
    return null;
  }
}

// עטיפת HTML אחידה לכל המיילים - כרטיס לבן ממורכז על רקע בהיר (לא הרקע הכהה
// של האתר עצמו: תוכנות מייל רבות מתעלמות/דורסות CSS מורכב, ורקע כהה עם טקסט
// שחזוי-אוטומטית עלול להיראות שבור אצל חלק מהנמענים) עם באנר עליון כהה+זהב
// שממותג כמו הכותרת העליונה באתר (theme.ts: theme.bg + theme.gold),
// וכפתור קריאה-לפעולה בגרדיאנט הזהב של goldButtonStyle - כדי שהמייל ירגיש
// כהמשך ישיר של חוויית האתר, לא כמו מייל אוטומטי גנרי.
// headerText/ctaText הם טקסט רגיל (מנוטרלים כאן), bodyHtml הוא HTML שכל
// ערך דינמי בו כבר עבר escapeHtml אצל הקורא.
function wrapEmailHtml(params: { headerText: string; bodyHtml: string; ctaText?: string; ctaUrl?: string }): string {
  const href = safeHref(params.ctaUrl);
  const cta =
    params.ctaText && href
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto 0;">
          <tr>
            <td style="border-radius: 8px; background: linear-gradient(135deg, #e3b3ac, #c98f89);">
              <a href="${href}" style="display: inline-block; padding: 14px 32px; font-family: sans-serif; font-size: 15px; font-weight: 700; color: #20120f; text-decoration: none;">
                ${escapeHtml(params.ctaText)}
              </a>
            </td>
          </tr>
        </table>
      `
      : '';

  return `
    <div dir="rtl" style="font-family: sans-serif; background: #f4f1ec; padding: 32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e7e0d5;">
        <tr>
          <td style="background: #0f1626; padding: 20px 28px; text-align: center;">
            <span style="font-family: sans-serif; font-size: 18px; font-weight: 700; color: #e3b3ac;">✨ ${escapeHtml(params.headerText)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 28px; text-align: center; color: #2a2420; font-size: 15px; line-height: 1.7;">
            ${params.bodyHtml}
            ${cta}
          </td>
        </tr>
        <tr>
          <td style="padding: 16px 28px; text-align: center; border-top: 1px solid #eee6d8; color: #9a8f7d; font-size: 12px;">
            נשלח דרך אזור צלמים ✨
          </td>
        </tr>
      </table>
    </div>
  `;
}

// תג קוד גישה בעיצוב "קופון" - קריא ובולט יותר מטקסט רגיל, מתאים למה
// שהלקוחה בפועל צריכה להעתיק כדי להיכנס.
// במייל אי אפשר להריץ JS (אין כפתור "העתקה" אמיתי) - במקום זה user-select:all
// על הקוד: הקשה/לחיצה ארוכה בוחרת את כל הקוד בבת אחת. בלי רווחים בתוך ה-span
// כדי שהטקסט המועתק יהיה בדיוק הקוד. הקוד בכוונה לא בתוך הקישור (בקשת הצלמת,
// וגם כדי שלא ידלוף ל-URL/לוגים).
function accessCodeBadge(code: string): string {
  return `
    <div style="margin: 18px 0; padding: 12px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block;">
      <span style="font-size: 12px; color: #9a8f7d;">קוד גישה</span><br />
      <span dir="ltr" style="font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #a06a63; font-family: monospace; user-select: all; -webkit-user-select: all;">${escapeHtml(code)}</span><br />
      <span style="font-size: 11px; color: #9a8f7d;">לחיצה ארוכה על הקוד להעתקה</span>
    </div>
  `;
}

interface ExpiryReminderParams {
  to: string;
  clientName: string;
  businessName: string;
  galleryUrl: string;
  accessCode: string;
  expiresAt: string;
  replyTo?: string;
}

export async function sendExpiryReminderEmail(params: ExpiryReminderParams): Promise<SendResult> {
  const expiresDate = toHebrewDateString(new Date(params.expiresAt));

  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">הגלריה שלך אצל <b>${escapeHtml(params.businessName)}</b> עומדת לפוג בתאריך <b>${escapeHtml(expiresDate)}</b>.</p>
      <p style="margin: 0;">אם עוד לא סיימת לבחור תמונות, זה הזמן 💛</p>
      ${accessCodeBadge(params.accessCode)}
    `,
    ctaText: 'כניסה לגלריה',
    ctaUrl: params.galleryUrl,
  });

  return sendEmail(params.to, `תזכורת: הגלריה שלך אצל ${params.businessName} עומדת לפוג`, html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface GalleryInviteParams {
  to: string;
  clientName: string;
  businessName: string;
  galleryUrl: string;
  accessCode: string;
  replyTo?: string;
}

export async function sendGalleryInviteEmail(params: GalleryInviteParams): Promise<SendResult> {
  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">הגלריה שלך אצל <b>${escapeHtml(params.businessName)}</b> מוכנה לבחירת תמונות! ✨</p>
      ${accessCodeBadge(params.accessCode)}
      <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">
        אפשר לסמן "אולי"/"נבחר" על כל תמונה, ולהוסיף הערות. בסיום, ללחוץ "סיימתי לבחור" כדי לשלוח את הבחירה.
      </p>
    `,
    ctaText: 'כניסה לגלריה',
    ctaUrl: params.galleryUrl,
  });

  return sendEmail(params.to, `הגלריה שלך אצל ${params.businessName} מוכנה!`, html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface SelectionCompleteParams {
  to: string;
  clientName: string;
  selectedCount: number;
  dashboardUrl: string;
}

// מודיעה לצלמת שלקוחה סיימה לבחור - נשלחת מ-app/api/gallery/[id]/finish, לצד
// עדכון סטטוס הגלריה. בלי זה לצלמת אין שום דרך לדעת שהבחירה הסתיימה חוץ
// מלהיכנס ולבדוק ידנית. שם התצוגה כאן "אזור צלמים" ולא שם הלקוחה/הצלמת -
// זו התראה מהמערכת עצמה, לא מייל בשם הלקוחה.
export async function sendSelectionCompleteEmail(params: SelectionCompleteParams): Promise<SendResult> {
  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      <p style="margin: 0;"><b>${escapeHtml(params.clientName)}</b> סיימה לבחור תמונות בגלריה - נבחרו <b>${escapeHtml(params.selectedCount)}</b> תמונות.</p>
    `,
    ctaText: 'צפייה בבחירה ובהורדת התמונות',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `${params.clientName} סיימה לבחור תמונות`, html, { fromName: 'אזור צלמים ✨' });
}

interface QuotaReachedParams {
  to: string;
  clientName: string;
  includedPhotos: number;
  dashboardUrl: string;
}

// מודיעה לצלמת שלקוחה הגיעה בדיוק למכסת החבילה (לא ל"סיימתי לבחור" - זו
// פעולה מפורשת אחרת, ראו sendSelectionCompleteEmail) - סימן עסקי שכדאי לשים
// לב אליו, לא קריאה לפעולה. נשלחת פעם אחת בדיוק ברגע החציה, ראו
// app/api/gallery/[id]/selection/route.ts.
export async function sendQuotaReachedEmail(params: QuotaReachedParams): Promise<SendResult> {
  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      <p style="margin: 0 0 8px;"><b>${escapeHtml(params.clientName)}</b> בחרה ${escapeHtml(params.includedPhotos)} תמונות - בדיוק המכסה שכלולה בחבילה שלה.</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">היא עדיין יכולה להמשיך לבחור (עם חיוב על חריגה), או שהיא כבר עומדת לסיים.</p>
    `,
    ctaText: 'צפייה בגלריה',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `${params.clientName} הגיעה למכסת התמונות בחבילה`, html, { fromName: 'אזור צלמים ✨' });
}

interface FinalPhotosReadyParams {
  to: string;
  clientName: string;
  businessName: string;
  count: number;
  galleryUrl: string;
  replyTo?: string;
}

// מודיעה ללקוחה שהתמונות הערוכות הסופיות (delivered_photos) מוכנות לצפייה/הורדה
// באותו קישור/קוד גישה שהיא כבר מכירה - נשלחת ביוזמת הצלמת (כפתור "שליחת
// התראה" ב-app/dashboard/galleries/[id]/edit/page.tsx), לא אוטומטית בכל
// העלאה, כי הצלמת בדרך כלל מעלה כמה תמונות בכמה פעימות ולא רוצה הצפה של מיילים.
export async function sendFinalPhotosReadyEmail(params: FinalPhotosReadyParams): Promise<SendResult> {
  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">התמונות הערוכות הסופיות שלך אצל <b>${escapeHtml(params.businessName)}</b> מוכנות! ✨</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">${escapeHtml(params.count)} תמונות מחכות לך לצפייה ולהורדה, באותו קישור וקוד גישה שכבר יש לך.</p>
    `,
    ctaText: 'כניסה לגלריה',
    ctaUrl: params.galleryUrl,
  });

  return sendEmail(params.to, `התמונות הסופיות שלך אצל ${params.businessName} מוכנות!`, html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface OriginalsDeletionWarningParams {
  to: string;
  clientName: string;
  deletionDate: string;
  dashboardUrl: string;
}

// מודיעה לצלמת שתמונות המקור (הלא-ערוכות) של גלריה עומדות להימחק אוטומטית
// בעוד כ-5 ימים (ראו app/api/cron/tick/route.ts, "שלב 4") - כדי שתספיק
// להוריד אותן בעצמה אם היא עוד לא עשתה את זה, לפני שהמחיקה הבלתי-הפיכה
// קורית. אותו "אזור צלמים" ולא שם הלקוחה - זו התראה מהמערכת, לא מייל
// בשם הלקוחה.
export async function sendOriginalsDeletionWarningEmail(params: OriginalsDeletionWarningParams): Promise<SendResult> {
  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      <p style="margin: 0 0 8px;">תמונות המקור (הלא-ערוכות) בגלריה של <b>${escapeHtml(params.clientName)}</b> יימחקו אוטומטית לצמיתות בתאריך <b>${escapeHtml(params.deletionDate)}</b>, כדי לפנות מקום באחסון.</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">התמונות הערוכות הסופיות שהעלית ללקוחה לא נמחקות - זה רק על קבצי המקור המקוריים. אם את עדיין צריכה אותן, זה הזמן להוריד.</p>
    `,
    ctaText: 'צפייה בגלריה',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `תמונות המקור של ${params.clientName} יימחקו בקרוב`, html, { fromName: 'אזור צלמים ✨' });
}

interface ClientSelectionSummaryParams {
  to: string;
  clientName: string;
  businessName: string;
  filenames: string[];
  replyTo?: string;
}

// אישור ללקוחה על הבחירה הסופית שלה, ברגע "סיימתי לבחור" - אותו trigger
// בדיוק כמו sendSelectionCompleteEmail (לצלמת), רק תוכן שונה. נשלחת רק
// ללקוחה עצמה (הבעלים) - לא לבני משפחה אחרים שרק תרמו קלט.
export async function sendClientSelectionSummaryEmail(params: ClientSelectionSummaryParams): Promise<SendResult> {
  const list = params.filenames
    .map((name) => `<li style="text-align: right; margin: 2px 0;">${escapeHtml(name)}</li>`)
    .join('');

  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">הבחירה שלך אצל <b>${escapeHtml(params.businessName)}</b> נשלחה בהצלחה ✓ - ${params.filenames.length} תמונות:</p>
      <ul style="margin: 12px auto; padding-right: 20px; text-align: right; display: inline-block; font-size: 13px; color: #4a4238;">${list}</ul>
      <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">אין צורך לעשות עוד כלום, הצלמת תיצור איתך קשר להמשך.</p>
    `,
  });

  return sendEmail(params.to, `הבחירה שלך אצל ${params.businessName} נשלחה בהצלחה`, html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface ReviewRequestParams {
  to: string;
  clientName: string;
  businessName: string;
  reviewLink: string;
  replyTo?: string;
}

// נשלחת ידנית מדף עריכת הגלריה, רק אחרי שהצלמת סימנה את הגלריה כ"נמסרה"
// (delivered_at) - לא אוטומטית, כי התזמון הנכון תלוי במתי התמונות המוגמרות
// באמת יצאו, לא במתי הלקוחה סיימה לבחור. reviewLink מוגדר פעם אחת בהגדרות
// (photographers.review_link) - ראו app/api/galleries/[id]/send-review-request.
export async function sendReviewRequestEmail(params: ReviewRequestParams): Promise<SendResult> {
  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">מקווה שאת נהנית מהתמונות! 💛</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">
        אם יש לך רגע, ביקורת קצרה ממך תעזור לי המון להמשיך לצלם עוד אירועים כמו שלך.
      </p>
    `,
    ctaText: 'כתיבת ביקורת',
    ctaUrl: params.reviewLink,
  });

  return sendEmail(params.to, `אפשר לבקש ממך טובה קטנה, ${params.clientName}?`, html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

// ---------- יומן צילומים (טבלת shoots, ראו lib/shoots.ts) ----------

// "יום ראשון, 11.10.2026 · י״ט בתשרי תשפ״ז" - תאריך לועזי (מה שהצלמת הזינה)
// לצד התאריך העברי, כמו שאר המיילים ללקוחה (toHebrewDateString). צהריים UTC
// כדי שאזור הזמן של השרת לא יזיז את היום.
function shootDateText(shootDate: string): string {
  return `${formatShootDateLabel(shootDate)} · ${toHebrewDateString(new Date(`${shootDate}T12:00:00Z`))}`;
}

// כרטיס פרטי הצילום - באותו סגנון "קופון" כמו accessCodeBadge.
function shootDetailsCard(params: { shootDate: string; startTime: string; location: string }): string {
  return `
    <div style="margin: 18px 0; padding: 14px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block; text-align: right;">
      <div style="margin: 2px 0;">📅 <b>${escapeHtml(shootDateText(params.shootDate))}</b></div>
      <div style="margin: 2px 0;">🕐 בשעה <b dir="ltr">${escapeHtml(formatShootTime(params.startTime))}</b></div>
      <div style="margin: 2px 0;">📍 ${escapeHtml(params.location)}</div>
    </div>
  `;
}

interface ShootClientEmailParams {
  to: string;
  clientName: string;
  businessName: string;
  shootDate: string; // "YYYY-MM-DD" בזמן ישראל
  startTime: string; // "HH:MM" / "HH:MM:SS"
  location: string;
  replyTo?: string;
}

// אישור קביעת צילום ללקוחה - נשלח מ-app/api/shoots/route.ts ביצירת צילום
// (אם הצלמת השאירה את "שליחת אישור ללקוחה" מסומן, ברירת המחדל). ההערות
// (shoots.notes) לא נכללות בכוונה - הן פרטיות של הצלמת, כמו photographer_notes בגלריה.
export async function sendShootConfirmationEmail(params: ShootClientEmailParams): Promise<SendResult> {
  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">הצילום שלך אצל <b>${escapeHtml(params.businessName)}</b> נקבע! ✨</p>
      ${shootDetailsCard(params)}
      <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">
        נשלח לך תזכורת לפני הצילום. אם משהו משתנה, אפשר פשוט להשיב למייל הזה.
      </p>
    `,
  });

  return sendEmail(params.to, `הצילום שלך אצל ${params.businessName} נקבע`, html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

// תזכורת אוטומטית ללקוחה N ימים לפני הצילום (photographers.shoot_reminder_days) -
// נשלחת מ-app/api/cron/tick/route.ts, חד-פעמית (shoots.reminder_sent_at).
export async function sendShootReminderEmail(params: ShootClientEmailParams & { whenLabel: string }): Promise<SendResult> {
  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">רק מזכירה - הצילום שלך אצל <b>${escapeHtml(params.businessName)}</b> ${escapeHtml(params.whenLabel)} 💛</p>
      ${shootDetailsCard(params)}
      <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">
        מחכה לראות אותך! אם משהו השתנה, אפשר פשוט להשיב למייל הזה.
      </p>
    `,
  });

  return sendEmail(params.to, `תזכורת: הצילום שלך אצל ${params.businessName} ${params.whenLabel}`, html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface ShootsDailySummaryParams {
  to: string;
  shootDate: string; // "מחר" - YYYY-MM-DD
  shoots: { clientName: string; startTime: string; location: string; notes?: string | null }[];
  dashboardUrl: string;
}

// סיכום יומי לצלמת עם הצילומים של מחר - נשלח מ-app/api/cron/tick/route.ts,
// פעם אחת ליום לכל היותר (photographers.shoot_summary_sent_on), רק אם יש
// בכלל צילומים מחר ורק אם הצלמת לא כיבתה את זה בהגדרות. "אזור צלמים" ולא שם
// העסק - זו התראה מהמערכת לצלמת, כמו sendSelectionCompleteEmail.
export async function sendShootsDailySummaryEmail(params: ShootsDailySummaryParams): Promise<SendResult> {
  const rows = params.shoots
    .map(
      (s) => `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #eee6d8; font-weight: 700; white-space: nowrap; vertical-align: top;" dir="ltr">${escapeHtml(formatShootTime(s.startTime))}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #eee6d8; text-align: right;">
            <b>${escapeHtml(s.clientName)}</b><br />
            <span style="font-size: 13px; color: #6b6156;">📍 ${escapeHtml(s.location)}</span>
            ${s.notes ? `<br /><span style="font-size: 12px; color: #9a8f7d;">${escapeHtml(s.notes)}</span>` : ''}
          </td>
        </tr>
      `
    )
    .join('');

  const countText = params.shoots.length === 1 ? 'צילום אחד' : `${params.shoots.length} צילומים`;

  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      <p style="margin: 0 0 8px;">מחר (${escapeHtml(shootDateText(params.shootDate))}) יש לך ${countText}:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 12px auto 0; border-collapse: collapse; font-size: 14px;">${rows}</table>
    `,
    ctaText: 'פתיחת היומן',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `הצילומים שלך מחר: ${countText}`, html, { fromName: 'אזור צלמים ✨' });
}

// ---------- בקשת הארכה לתקופת הבחירה (gallery_extension_requests) ----------

// "12.10.2026 · כ״ט בתשרי תשפ״ז" - לועזי (לפי היום בישראל) לצד העברי
export function extensionDateText(iso: string): string {
  return `${new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })} · ${toHebrewDateString(new Date(iso))}`;
}

interface ExtensionRequestedParams {
  to: string;
  clientName: string;
  days: number;
  currentExpiresAt: string | null;
  dashboardUrl: string;
}

// מודיעה לצלמת שהלקוחה ביקשה הארכה (app/api/gallery/[id]/extension-request) -
// התראה מהמערכת ("אזור צלמים"), כמו sendSelectionCompleteEmail. האישור/הדחייה
// נעשים בדף עריכת הגלריה.
export async function sendExtensionRequestedEmail(params: ExtensionRequestedParams): Promise<SendResult> {
  const daysText = params.days === 1 ? 'יום אחד' : `${params.days} ימים`;
  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      <p style="margin: 0 0 8px;">הלקוחה <b>${escapeHtml(params.clientName)}</b> ביקשה הארכה של <b>${escapeHtml(daysText)}</b> לבחירת התמונות.</p>
      ${params.currentExpiresAt ? `<p style="margin: 0; font-size: 13px; color: #6b6156;">תאריך הסיום הנוכחי: ${escapeHtml(extensionDateText(params.currentExpiresAt))}</p>` : ''}
    `,
    ctaText: 'לאישור או דחייה',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `הלקוחה ${params.clientName} ביקשה הארכה של ${daysText}`, html, { fromName: 'אזור צלמים ✨' });
}

interface ExtensionDecisionParams {
  to: string;
  clientName: string;
  businessName: string;
  galleryUrl: string;
  approved: boolean;
  newExpiresAt?: string | null;
  replyTo?: string;
}

// מודיעה ללקוחה על ההחלטה של הצלמת לגבי בקשת ההארכה - נשלחת מ-
// app/api/galleries/[id]/extension-requests/[requestId] (אישור או דחייה).
export async function sendExtensionDecisionEmail(params: ExtensionDecisionParams): Promise<SendResult> {
  const approvedWithDate = params.approved && !!params.newExpiresAt;
  const dateText = approvedWithDate ? extensionDateText(params.newExpiresAt as string) : '';
  const html = wrapEmailHtml({
    headerText: params.businessName || 'אזור צלמים',
    bodyHtml: approvedWithDate
      ? `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">הצלמת האריכה את הבחירה עד <b>${escapeHtml(dateText)}</b> 💛</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">אפשר להמשיך לבחור באותו קישור וקוד גישה.</p>
    `
      : `
      <p style="margin: 0 0 8px;">היי ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0;">הפעם לא ניתן להאריך את תקופת הבחירה - כדאי לסיים לבחור עד התאריך שנקבע. לשאלות אפשר להשיב למייל הזה.</p>
    `,
    ctaText: 'כניסה לגלריה',
    ctaUrl: params.galleryUrl,
  });

  const subject = approvedWithDate
    ? `הצלמת האריכה את הבחירה עד ${dateText}`
    : `עדכון לגבי בקשת ההארכה שלך${params.businessName ? ` אצל ${params.businessName}` : ''}`;
  return sendEmail(params.to, subject, html, { fromName: params.businessName || undefined, replyTo: params.replyTo });
}
