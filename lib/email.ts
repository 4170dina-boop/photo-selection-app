import { createClient as createAdminClient } from '@supabase/supabase-js';
import { toHebrewDateString } from '@/lib/hebrewDate';
import { formatShootDateLabel, formatShootTime } from '@/lib/shoots';
import { googleMapsUrl, wazeUrl } from '@/lib/navLinks';
import { DEFAULT_CLIENT_GENDER, gt, type Gender } from '@/lib/gender';
import { DEFAULT_LANG, formatDateWithHebrew, formatGalleryDate, langDir, t, type Lang, type MessageKey } from '@/lib/i18n';
import { escapeHtml, safeHref } from '@/lib/htmlEscape';

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

interface EmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
  cid?: string;
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
  attachments?: EmailAttachment[];
  // מיילים עם הרבה קבצים מצורפים (בחירה במייל) לוקחים יותר זמן להעלות ל-Resend
  timeoutMs?: number;
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

export function parseSelectionNumbers(input: string, totalPhotos: number, includedPhotos?: number): {
  selected: number[];
  invalid: string[];
  extraPhotos: number;
  totalValidSelected: number;
} {
  const seen = new Set<number>();
  const invalid: string[] = [];
  const tokens = (input || '').split(/[\s,،]+/).filter(Boolean);

  for (const token of tokens) {
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end) {
        invalid.push(token);
        continue;
      }
      for (let n = start; n <= end; n++) {
        if (n >= 1 && n <= totalPhotos) seen.add(n);
        else invalid.push(String(n));
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n >= 1 && n <= totalPhotos) seen.add(n);
      else invalid.push(token);
    } else if (token.trim()) {
      invalid.push(token);
    }
  }

  const selected = [...seen].sort((a, b) => a - b);
  const totalValidSelected = selected.length;
  const extraPhotos = typeof includedPhotos === 'number' ? Math.max(0, totalValidSelected - includedPhotos) : 0;
  return {
    selected,
    invalid: [...new Set(invalid)],
    extraPhotos,
    totalValidSelected,
  };
}

export function extractSelectionFromReplyText(input: string, totalPhotos: number, includedPhotos?: number): {
  selected: number[];
  invalid: string[];
  extraPhotos: number;
  totalValidSelected: number;
} {
  const cleaned = (input ?? '')
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/[^0-9,\-\s]/g, ' ')
    .trim();

  if (!cleaned) {
    return { selected: [], invalid: [], extraPhotos: 0, totalValidSelected: 0 };
  }

  const tokens = cleaned
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => /^\d+(?:-\d+)?$/.test(value));

  return parseSelectionNumbers(tokens.join(', '), totalPhotos, includedPhotos);
}

function dataUrlToBase64(dataUrl: string): string {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return dataUrl;
  return match[2];
}

export interface SelectionEmailPhoto {
  number: number;
  filename: string;
  contentType?: string;
  dataUrl?: string;
  base64Content?: string;
}

export async function sendSelectionEmailWithInlinePhotos(params: {
  to: string;
  clientName: string;
  businessName: string;
  includedPhotos: number;
  extraPhotoPrice: number;
  photos: SelectionEmailPhoto[];
  dueDate: string;
  replyTo?: string;
}): Promise<SendResult> {
  const htmlPhotos = params.photos
    .map((photo) => {
      const cid = `photo-${photo.number}`;
      return `<div style="text-align:center; margin: 0 0 12px;">
        <img src="cid:${cid}" alt="תמונה ${photo.number}" style="display:block; width:100%; max-width:180px; border-radius:8px; margin:0 auto 8px; border:1px solid #e9dfd5;" />
        <div style="font-size:18px; font-weight:700; color:#2e2e2e;">${escapeHtml(String(photo.number))}</div>
      </div>`;
    })
    .join('');

  const extraPhotos = Math.max(0, params.photos.length - params.includedPhotos);
  const totalText = params.photos.length > 0 ? `נבחרו ${params.photos.length} תמונות` : 'לא נבחרו תמונות עדיין';
  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">שלום ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">התמונות מהצילום מוכנות לבחירה! 🌸</p>
      <div style="background:#faf4f2;border:1px solid #efd7d3;border-radius:8px;padding:10px 12px;line-height:1.8;margin:12px 0 14px;">
        <div>✔ כלולות בחבילה: <b>${escapeHtml(String(params.includedPhotos))} תמונות</b></div>
        <div>➕ כל תמונה נוספת: <b>${escapeHtml(String(params.extraPhotoPrice))} ₪</b></div>
        <div>📅 נשמח לתשובה עד: <b>${escapeHtml(params.dueDate)}</b></div>
      </div>
      <div style="background:#fff8e6;border:1px solid #ebd7a0;border-radius:8px;padding:10px 12px;line-height:1.7;margin-bottom:14px;">
        <b>איך בוחרים?</b><br>
        פשוט משיבים למייל הזה עם המספרים של התמונות שאהבת.<br>
        לדוגמה: <b dir="ltr">3, 7, 12-15</b>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">${htmlPhotos}</div>
      <div style="text-align:center; color:#6c6c6c; font-size:12px; margin-top:12px;">${escapeHtml(totalText)}</div>
      <div style="margin-top:10px; font-size:13px; color:#4a4238;">תשלום נוסף: <b>${escapeHtml(String(extraPhotos * params.extraPhotoPrice))} ₪</b></div>
    `,
  });

  const attachments = params.photos.map((photo) => {
    const content = photo.base64Content ?? (photo.dataUrl ? dataUrlToBase64(photo.dataUrl) : '');
    const cid = `photo-${photo.number}`;
    return {
      filename: photo.filename,
      content,
      contentType: photo.contentType || 'image/jpeg',
      cid,
    };
  });

  return sendEmail(
    params.to,
    `התמונות שלך מהצילום 📸`,
    html,
    {
      fromName: params.businessName,
      replyTo: params.replyTo,
      attachments,
    }
  );
}

// בחירה במייל עם קבצים מצורפים רגילים (לא cid בגוף ההודעה) - ראו
// lib/emailSelectionBatches.ts למה: בנטפרי תמונות מצורפות בג'ימייל נפתחות בלי
// סינון. גלריה גדולה נשלחת בכמה מיילים; כל קובץ נקרא לפי מספר התמונה בגלריה.
export async function sendSelectionEmailWithAttachments(params: {
  to: string;
  clientName: string;
  businessName: string;
  includedPhotos: number;
  extraPhotoPrice: number;
  dueDate?: string | null;
  totalPhotos: number;
  rangeFrom: number;
  rangeTo: number;
  isTest?: boolean;
  photos: { filename: string; base64Content: string }[];
  replyTo?: string;
}): Promise<SendResult> {
  const range = params.rangeFrom === params.rangeTo ? `תמונה ${params.rangeFrom}` : `תמונות ${params.rangeFrom}–${params.rangeTo}`;
  const isSplit = params.rangeFrom > 1 || params.rangeTo < params.totalPhotos;
  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      ${params.isTest ? '<p style="margin:0 0 10px;padding:8px 12px;background:#eef6ef;border:1px solid #cfe3d2;border-radius:8px;">🧪 זה מייל ניסיון - רק את רואה אותו. בדקי שהתמונות המצורפות נפתחות.</p>' : ''}
      <p style="margin: 0 0 8px;">שלום ${escapeHtml(params.clientName)},</p>
      <p style="margin: 0 0 8px;">התמונות מהצילום מוכנות לבחירה! 🌸 הן מצורפות למטה, ובשם של כל תמונה מופיע המספר שלה.</p>
      <div style="background:#faf4f2;border:1px solid #efd7d3;border-radius:8px;padding:10px 12px;line-height:1.8;margin:12px 0 14px;">
        <div>✔ כלולות בחבילה: <b>${escapeHtml(String(params.includedPhotos))} תמונות</b></div>
        <div>➕ כל תמונה נוספת: <b>${escapeHtml(String(params.extraPhotoPrice))} ₪</b></div>
        ${params.dueDate ? `<div>📅 נשמח לתשובה עד: <b>${escapeHtml(params.dueDate)}</b></div>` : ''}
      </div>
      <div style="background:#fff8e6;border:1px solid #ebd7a0;border-radius:8px;padding:10px 12px;line-height:1.7;margin-bottom:14px;">
        <b>איך בוחרים?</b><br>
        משיבים למייל הזה עם המספרים של התמונות שאהבת.<br>
        לדוגמה: <b dir="ltr">3, 7, 12-15</b>
        ${isSplit ? `<br><span style="font-size:13px;color:#7a6a40;">במייל הזה: ${escapeHtml(range)} מתוך ${escapeHtml(String(params.totalPhotos))}. שאר התמונות נמצאות במיילים נפרדים - אפשר לענות פעם אחת על כולן יחד.</span>` : ''}
      </div>
    `,
  });

  return sendEmail(
    params.to,
    `${params.isTest ? '[ניסיון] ' : ''}התמונות שלך מהצילום 📸 · ${range}${isSplit ? ` (מתוך ${params.totalPhotos})` : ''}`,
    html,
    {
      fromName: params.businessName,
      replyTo: params.replyTo,
      attachments: params.photos.map((p) => ({ filename: p.filename, content: p.base64Content, contentType: 'image/jpeg' })),
      timeoutMs: 45_000,
    }
  );
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

// תקרת זמן לבקשה אחת ל-Resend: בלי זה בקשה תקועה הייתה מחזיקה את ריצת ה-cron
// עד maxDuration, הפונקציה נהרגת באמצע - ושורות שכבר "נתפסו" לשליחה (תזכורת /
// התראת מחיקת מקור) נשארות מסומנות בלי שהמייל יצא. timeout נתפס ב-sendEmail
// וחוזר כ-{ sent: false } כמו כל כישלון רשת.
export const RESEND_TIMEOUT_MS = 10_000;

async function postToResend(payload: string, timeoutMs = RESEND_TIMEOUT_MS): Promise<Response> {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
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
    if (options.attachments && options.attachments.length > 0) {
      body.attachments = options.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
        ...(attachment.cid ? { cid: attachment.cid } : {}),
      }));
    }
    const payload = JSON.stringify(body);

    let res = await postToResend(payload, options.timeoutMs);
    if (res.status === 429) {
      await sleep(retryDelayMs(res.headers?.get?.('retry-after')));
      res = await postToResend(payload, options.timeoutMs);
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

// המימוש ב-lib/htmlEscape.ts (בלי תלויות - משותף גם לדפדפן)
export { escapeHtml, safeHref };

// ערכים דינמיים בתוך תבנית מתורגמת - כולם עוברים escapeHtml (התבנית עצמה
// מהמילון, lib/i18n, ומותר בה <b>).
function tm(lang: Lang, key: MessageKey, params: Record<string, string | number | null | undefined> = {}, gender?: Gender | null): string {
  const escaped: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) escaped[k] = escapeHtml(v);
  if (typeof params.count === 'number') return t(lang, key, { ...escaped, count: params.count }, gender);
  return t(lang, key, escaped, gender);
}

// עטיפת HTML אחידה לכל המיילים - כרטיס לבן ממורכז על רקע בהיר (לא הרקע הכהה
// של האתר עצמו: תוכנות מייל רבות מתעלמות/דורסות CSS מורכב, ורקע כהה עם טקסט
// שחזוי-אוטומטית עלול להיראות שבור אצל חלק מהנמענים) עם באנר עליון כהה+זהב
// שממותג כמו הכותרת העליונה באתר (theme.ts: theme.bg + theme.gold),
// וכפתור קריאה-לפעולה בגרדיאנט הזהב של goldButtonStyle - כדי שהמייל ירגיש
// כהמשך ישיר של חוויית האתר, לא כמו מייל אוטומטי גנרי.
// headerText/ctaText הם טקסט רגיל (מנוטרלים כאן), bodyHtml הוא HTML שכל
// ערך דינמי בו כבר עבר escapeHtml אצל הקורא. lang קובע dir/lang ואת שורת
// התחתית (ברירת מחדל עברית - כל המיילים לצלמת).
// logoUrl (אופציונלי) - photographers.logo_url, מוצג מעל שם העסק בבאנר (רק
// http/https, ראו safeHref; בלעדיו - רק השם, כמו תמיד).
function wrapEmailHtml(params: { headerText: string; bodyHtml: string; ctaText?: string; ctaUrl?: string; lang?: Lang; logoUrl?: string | null }): string {
  const lang = params.lang ?? DEFAULT_LANG;
  const href = safeHref(params.ctaUrl);
  const logoSrc = safeHref(params.logoUrl);
  const logo = logoSrc
    ? `<img src="${logoSrc}" alt="" width="56" height="56" style="display: block; margin: 0 auto 8px; width: 56px; height: 56px; border-radius: 50%; object-fit: contain; background: #ffffff;" />`
    : '';
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
    <div dir="${langDir(lang)}" lang="${lang}" style="font-family: sans-serif; background: #f4f1ec; padding: 32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e7e0d5;">
        <tr>
          <td style="background: #0f1626; padding: 20px 28px; text-align: center;">
            ${logo}
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
            ${escapeHtml(t(lang, 'mail.footer'))}
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
function accessCodeBadge(code: string, lang: Lang = DEFAULT_LANG): string {
  return `
    <div style="margin: 18px 0; padding: 12px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block;">
      <span style="font-size: 12px; color: #9a8f7d;">${escapeHtml(t(lang, 'mail.codeLabel'))}</span><br />
      <span dir="ltr" style="font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #a06a63; font-family: monospace; user-select: all; -webkit-user-select: all;">${escapeHtml(code)}</span><br />
      <span style="font-size: 11px; color: #9a8f7d;">${escapeHtml(t(lang, 'mail.codeHint'))}</span>
    </div>
  `;
}

// שפת המיילים ללקוח/ה = galleries.language (lib/i18n/galleryLanguage.ts);
// חסר = עברית. מיילים לצלמת תמיד בעברית.
interface ClientLanguageParam {
  language?: Lang | null;
}

interface ExpiryReminderParams extends ClientLanguageParam {
  to: string;
  clientName: string;
  businessName: string;
  galleryUrl: string;
  accessCode: string;
  expiresAt: string;
  replyTo?: string;
}

export async function sendExpiryReminderEmail(params: ExpiryReminderParams): Promise<SendResult> {
  const lang = params.language ?? DEFAULT_LANG;
  const expiresDate = formatGalleryDate(lang, params.expiresAt);

  const html = wrapEmailHtml({
    lang,
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.hi', { name: params.clientName })}</p>
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.reminder.expires', { business: params.businessName, date: expiresDate })}</p>
      <p style="margin: 0;">${tm(lang, 'mail.reminder.nudge')}</p>
      ${accessCodeBadge(params.accessCode, lang)}
    `,
    ctaText: t(lang, 'mail.enterCta'),
    ctaUrl: params.galleryUrl,
  });

  return sendEmail(params.to, t(lang, 'mail.reminder.subject', { business: params.businessName }), html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface GalleryInviteParams extends ClientLanguageParam {
  to: string;
  clientName: string;
  businessName: string;
  galleryUrl: string;
  accessCode: string;
  replyTo?: string;
}

export async function sendGalleryInviteEmail(params: GalleryInviteParams): Promise<SendResult> {
  const lang = params.language ?? DEFAULT_LANG;
  const html = wrapEmailHtml({
    lang,
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.hi', { name: params.clientName })}</p>
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.invite.ready', { business: params.businessName })}</p>
      ${accessCodeBadge(params.accessCode, lang)}
      <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">
        ${tm(lang, 'mail.invite.howto')}
      </p>
    `,
    ctaText: t(lang, 'mail.enterCta'),
    ctaUrl: params.galleryUrl,
  });

  return sendEmail(params.to, t(lang, 'mail.invite.subject', { business: params.businessName }), html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface SelectionCompleteParams {
  to: string;
  clientName: string;
  // לשון על הלקוח/ה בגוף שלישי ("סיימה"/"סיים") - galleries.client_gender
  clientGender?: Gender | null;
  selectedCount: number;
  dashboardUrl: string;
}

// מודיעה לצלמת שלקוחה סיימה לבחור - נשלחת מ-app/api/gallery/[id]/finish, לצד
// עדכון סטטוס הגלריה. בלי זה לצלמת אין שום דרך לדעת שהבחירה הסתיימה חוץ
// מלהיכנס ולבדוק ידנית. שם התצוגה כאן "אזור צלמים" ולא שם הלקוחה/הצלמת -
// זו התראה מהמערכת עצמה, לא מייל בשם הלקוחה.
export async function sendSelectionCompleteEmail(params: SelectionCompleteParams): Promise<SendResult> {
  const finished = gt(params.clientGender ?? DEFAULT_CLIENT_GENDER, 'סיימה', 'סיים');
  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      <p style="margin: 0;"><b>${escapeHtml(params.clientName)}</b> ${finished} לבחור תמונות בגלריה - נבחרו <b>${escapeHtml(params.selectedCount)}</b> תמונות.</p>
    `,
    ctaText: 'צפייה בבחירה ובהורדת התמונות',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `${params.clientName} ${finished} לבחור תמונות`, html, { fromName: 'אזור צלמים ✨' });
}

interface QuotaReachedParams {
  to: string;
  clientName: string;
  clientGender?: Gender | null;
  includedPhotos: number;
  dashboardUrl: string;
}

// מודיעה לצלמת שלקוחה הגיעה בדיוק למכסת החבילה (לא ל"סיימתי לבחור" - זו
// פעולה מפורשת אחרת, ראו sendSelectionCompleteEmail) - סימן עסקי שכדאי לשים
// לב אליו, לא קריאה לפעולה. נשלחת פעם אחת בדיוק ברגע החציה, ראו
// app/api/gallery/[id]/selection/route.ts.
export async function sendQuotaReachedEmail(params: QuotaReachedParams): Promise<SendResult> {
  const gender = params.clientGender ?? DEFAULT_CLIENT_GENDER;
  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      <p style="margin: 0 0 8px;"><b>${escapeHtml(params.clientName)}</b> ${gt(gender, 'בחרה', 'בחר')} ${escapeHtml(params.includedPhotos)} תמונות - בדיוק המכסה שכלולה בחבילה ${gt(gender, 'שלה', 'שלו')}.</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">${gt(
        gender,
        'היא עדיין יכולה להמשיך לבחור (עם חיוב על חריגה), או שהיא כבר עומדת לסיים.',
        'הוא עדיין יכול להמשיך לבחור (עם חיוב על חריגה), או שהוא כבר עומד לסיים.'
      )}</p>
    `,
    ctaText: 'צפייה בגלריה',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `${params.clientName} ${gt(gender, 'הגיעה', 'הגיע')} למכסת התמונות בחבילה`, html, { fromName: 'אזור צלמים ✨' });
}

interface FinalPhotosReadyParams extends ClientLanguageParam {
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
  const lang = params.language ?? DEFAULT_LANG;
  const html = wrapEmailHtml({
    lang,
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.hi', { name: params.clientName })}</p>
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.final.ready', { business: params.businessName })}</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">${tm(lang, 'mail.final.count', { count: params.count })}</p>
    `,
    ctaText: t(lang, 'mail.enterCta'),
    ctaUrl: params.galleryUrl,
  });

  return sendEmail(params.to, t(lang, 'mail.final.subject', { business: params.businessName }), html, {
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

interface ClientSelectionSummaryParams extends ClientLanguageParam {
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
  const lang = params.language ?? DEFAULT_LANG;
  // יישור הרשימה לפי כיוון השפה (תוכנות מייל לא תמיד מכירות padding-inline)
  const side = langDir(lang) === 'rtl' ? 'right' : 'left';
  const list = params.filenames
    .map((name) => `<li style="text-align: ${side}; margin: 2px 0;">${escapeHtml(name)}</li>`)
    .join('');

  const html = wrapEmailHtml({
    lang,
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.hi', { name: params.clientName })}</p>
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.summary.sent', { business: params.businessName, count: params.filenames.length })}</p>
      <ul style="margin: 12px auto; padding-${side}: 20px; text-align: ${side}; display: inline-block; font-size: 13px; color: #4a4238;">${list}</ul>
      <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">${tm(lang, 'mail.summary.next')}</p>
    `,
  });

  return sendEmail(params.to, t(lang, 'mail.summary.subject', { business: params.businessName }), html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface ReviewRequestParams extends ClientLanguageParam {
  to: string;
  clientName: string;
  clientGender?: Gender | null;
  businessName: string;
  reviewLink: string;
  replyTo?: string;
}

// נשלחת ידנית מדף עריכת הגלריה, רק אחרי שהצלמת סימנה את הגלריה כ"נמסרה"
// (delivered_at) - לא אוטומטית, כי התזמון הנכון תלוי במתי התמונות המוגמרות
// באמת יצאו, לא במתי הלקוחה סיימה לבחור. reviewLink מוגדר פעם אחת בהגדרות
// (photographers.review_link) - ראו app/api/galleries/[id]/send-review-request.
export async function sendReviewRequestEmail(params: ReviewRequestParams): Promise<SendResult> {
  const lang = params.language ?? DEFAULT_LANG;
  const gender = params.clientGender ?? DEFAULT_CLIENT_GENDER;
  const html = wrapEmailHtml({
    lang,
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.hi', { name: params.clientName })}</p>
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.review.hope', {}, gender)}</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">
        ${tm(lang, 'mail.review.ask')}
      </p>
    `,
    ctaText: t(lang, 'mail.review.cta'),
    ctaUrl: params.reviewLink,
  });

  return sendEmail(params.to, t(lang, 'mail.review.subject', { name: params.clientName }), html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}

interface AnniversaryParams extends ClientLanguageParam {
  to: string;
  clientName: string;
  clientGender?: Gender | null;
  businessName: string;
  logoUrl?: string | null;
  galleryUrl: string;
  accessCode?: string | null;
  replyTo?: string;
}

// "לפני שנה צילמנו 💛" - נשלח אוטומטית מ-app/api/cron/tick/route.ts כ-11 חודשים
// אחרי המסירה (photographers.anniversary_emails, opt-in), פעם אחת לגלריה
// (galleries.anniversary_sent_at). הזמנה לתאם צילום נוסף - התשובה מגיעה ישר
// לצלמת (replyTo). בלי תמונות מוטמעות בכוונה: התמונות הסופיות הן קבצים מלאים
// (בלי thumbnail) ב-bucket פרטי, וקישור חתום פג תוך זמן קצר - תמונה שבורה במייל
// גרועה יותר מבלי תמונה. במקום זה - כפתור לגלריה עצמה (נשארת זמינה אחרי מסירה).
export async function sendAnniversaryEmail(params: AnniversaryParams): Promise<SendResult> {
  const lang = params.language ?? DEFAULT_LANG;
  const gender = params.clientGender ?? DEFAULT_CLIENT_GENDER;
  const html = wrapEmailHtml({
    lang,
    headerText: params.businessName,
    logoUrl: params.logoUrl,
    bodyHtml: `
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.hi', { name: params.clientName })}</p>
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.anniv.memory', { business: params.businessName })}</p>
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.anniv.hope', {}, gender)}</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">${tm(lang, 'mail.anniv.invite', {}, gender)}</p>
      ${params.accessCode ? accessCodeBadge(params.accessCode, lang) : ''}
    `,
    ctaText: t(lang, 'mail.anniv.cta'),
    ctaUrl: params.galleryUrl,
  });

  return sendEmail(params.to, t(lang, 'mail.anniv.subject'), html, {
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

// קישורי ניווט קטנים (Waze / Google Maps) מתחת למיקום הצילום.
function navLinksHtml(location: string): string {
  if (!location.trim()) return '';
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="color: #a5706a; text-decoration: underline;">${label}</a>`;
  return `<div style="margin: 4px 0 0; font-size: 12px;">${link(wazeUrl(location), '🧭 Waze')} · ${link(googleMapsUrl(location), '🗺️ Google Maps')}</div>`;
}

// כרטיס פרטי הצילום - באותו סגנון "קופון" כמו accessCodeBadge.
function shootDetailsCard(params: { shootDate: string; startTime: string; location: string }): string {
  return `
    <div style="margin: 18px 0; padding: 14px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block; text-align: right;">
      <div style="margin: 2px 0;">📅 <b>${escapeHtml(shootDateText(params.shootDate))}</b></div>
      <div style="margin: 2px 0;">🕐 בשעה <b dir="ltr">${escapeHtml(formatShootTime(params.startTime))}</b></div>
      <div style="margin: 2px 0;">📍 ${escapeHtml(params.location)}</div>
      ${navLinksHtml(params.location)}
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
      <p style="margin: 0 0 8px;">תזכורת קטנה - הצילום שלך אצל <b>${escapeHtml(params.businessName)}</b> ${escapeHtml(params.whenLabel)} 💛</p>
      ${shootDetailsCard(params)}
      <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">
        מחכים לראות אותך! אם משהו השתנה, אפשר פשוט להשיב למייל הזה.
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
  // תזכורות לתאריכים חשובים - הסיכום נשלח גם כשיש רק אותן (בלי צילומים מחר)
  dateReminders?: DailySummaryDateReminder[];
  dashboardUrl: string;
  // לאן הכפתור מוביל כשאין צילומים מחר (רק תאריכים) - דף הלקוחות
  datesDashboardUrl?: string;
}

// תאריך חשוב של לקוחה (client_dates, lib/clientDates.ts) שחל בעוד daysAhead ימים
export interface DailySummaryDateReminder {
  label: string; // "יום ההולדת של יוסי"
  clientLabel: string; // "משפחת כהן" (familyLabel)
  daysAhead: number;
  dateText: string; // "5.11.2026 · כ״ה בחשון תשפ״ז"
  suggestion: string; // greetingSuggestion
}

function dateRemindersHtml(reminders: DailySummaryDateReminder[]): string {
  if (reminders.length === 0) return '';
  const items = reminders
    .map(
      (r) => `
        <div style="margin: 0 0 10px; padding: 10px 14px; background: #f4f1ec; border-radius: 8px; text-align: right;">
          <div>📅 בעוד ${escapeHtml(r.daysAhead)} יום: <b>${escapeHtml(r.label)}</b> (${escapeHtml(r.clientLabel)})</div>
          <div style="font-size: 12px; color: #9a8f7d;">${escapeHtml(r.dateText)}</div>
          <div style="font-size: 13px; color: #6b6156; margin-top: 4px;">💡 ${escapeHtml(r.suggestion)}</div>
        </div>
      `
    )
    .join('');
  return `<p style="margin: 20px 0 8px; font-weight: 700;">תאריכים חשובים של לקוחות</p>${items}`;
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
            ${navLinksHtml(s.location)}
            ${s.notes ? `<br /><span style="font-size: 12px; color: #9a8f7d;">${escapeHtml(s.notes)}</span>` : ''}
          </td>
        </tr>
      `
    )
    .join('');

  const countText = params.shoots.length === 1 ? 'צילום אחד' : `${params.shoots.length} צילומים`;
  const reminders = params.dateReminders ?? [];
  const hasShoots = params.shoots.length > 0;

  const shootsHtml = hasShoots
    ? `
      <p style="margin: 0 0 8px;">מחר (${escapeHtml(shootDateText(params.shootDate))}) יש לך ${countText}:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 12px auto 0; border-collapse: collapse; font-size: 14px;">${rows}</table>
    `
    : '';

  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      ${shootsHtml}
      ${dateRemindersHtml(reminders)}
    `,
    ctaText: hasShoots ? 'פתיחת היומן' : 'לדף הלקוחות',
    ctaUrl: hasShoots ? params.dashboardUrl : params.datesDashboardUrl ?? params.dashboardUrl,
  });

  return sendEmail(params.to, dailySummarySubject(params.shoots.length, reminders), html, { fromName: 'אזור צלמים ✨' });
}

// נושא הסיכום היומי: צילומים (ואם יש - גם מספר התאריכים), או רק תאריכים.
export function dailySummarySubject(shootCount: number, reminders: Pick<DailySummaryDateReminder, 'label' | 'daysAhead'>[]): string {
  const countText = shootCount === 1 ? 'צילום אחד' : `${shootCount} צילומים`;
  const datesText = reminders.length === 1 ? 'תאריך חשוב אחד' : `${reminders.length} תאריכים חשובים`;
  if (shootCount > 0) return `הצילומים שלך מחר: ${countText}${reminders.length ? ` · ${datesText}` : ''}`;
  if (reminders.length === 1) return `📅 בעוד ${reminders[0].daysAhead} יום: ${reminders[0].label}`;
  return `📅 ${datesText} של לקוחות מתקרבים`;
}

// ---------- בקשת הארכה לתקופת הבחירה (gallery_extension_requests) ----------

// "12.10.2026 · כ״ט בתשרי תשפ״ז" - לועזי (לפי היום בישראל) לצד העברי
export function extensionDateText(iso: string): string {
  return `${new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })} · ${toHebrewDateString(new Date(iso))}`;
}

interface ExtensionRequestedParams {
  to: string;
  clientName: string;
  clientGender?: Gender | null;
  days: number;
  currentExpiresAt: string | null;
  dashboardUrl: string;
}

// מודיעה לצלמת שהלקוחה ביקשה הארכה (app/api/gallery/[id]/extension-request) -
// התראה מהמערכת ("אזור צלמים"), כמו sendSelectionCompleteEmail. האישור/הדחייה
// נעשים בדף עריכת הגלריה.
export async function sendExtensionRequestedEmail(params: ExtensionRequestedParams): Promise<SendResult> {
  const daysText = params.days === 1 ? 'יום אחד' : `${params.days} ימים`;
  const gender = params.clientGender ?? DEFAULT_CLIENT_GENDER;
  const who = gt(gender, 'הלקוחה', 'הלקוח');
  const asked = gt(gender, 'ביקשה', 'ביקש');
  const html = wrapEmailHtml({
    headerText: 'אזור צלמים',
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי,</p>
      <p style="margin: 0 0 8px;">${who} <b>${escapeHtml(params.clientName)}</b> ${asked} הארכה של <b>${escapeHtml(daysText)}</b> לבחירת התמונות.</p>
      ${params.currentExpiresAt ? `<p style="margin: 0; font-size: 13px; color: #6b6156;">תאריך הסיום הנוכחי: ${escapeHtml(extensionDateText(params.currentExpiresAt))}</p>` : ''}
    `,
    ctaText: 'לאישור או דחייה',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `${who} ${params.clientName} ${asked} הארכה של ${daysText}`, html, { fromName: 'אזור צלמים ✨' });
}

interface ExtensionDecisionParams extends ClientLanguageParam {
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
  const lang = params.language ?? DEFAULT_LANG;
  const approvedWithDate = params.approved && !!params.newExpiresAt;
  // עברית/יידיש: לועזי + עברי (כמו extensionDateText); אחרות: לועזי לפי השפה
  const dateText = approvedWithDate ? formatDateWithHebrew(lang, params.newExpiresAt as string) : '';
  const html = wrapEmailHtml({
    lang,
    headerText: params.businessName || t(lang, 'mail.brand'),
    bodyHtml: approvedWithDate
      ? `
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.hi', { name: params.clientName })}</p>
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.ext.approved', { date: dateText })}</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">${tm(lang, 'mail.ext.approvedNext')}</p>
    `
      : `
      <p style="margin: 0 0 8px;">${tm(lang, 'mail.hi', { name: params.clientName })}</p>
      <p style="margin: 0;">${tm(lang, 'mail.ext.declined')}</p>
    `,
    ctaText: t(lang, 'mail.enterCta'),
    ctaUrl: params.galleryUrl,
  });

  const subject = approvedWithDate
    ? t(lang, 'mail.ext.subjectApproved', { date: dateText })
    : params.businessName
      ? t(lang, 'mail.ext.subjectDeclinedAt', { business: params.businessName })
      : t(lang, 'mail.ext.subjectDeclined');
  return sendEmail(params.to, subject, html, { fromName: params.businessName || undefined, replyTo: params.replyTo });
}
