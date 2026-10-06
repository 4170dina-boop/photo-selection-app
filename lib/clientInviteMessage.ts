import { DEFAULT_CLIENT_GENDER, type Gender } from './gender';
import { DEFAULT_LANG, formatGalleryDate, langDir, t, type Lang } from './i18n';
import { escapeHtml, safeHref } from './htmlEscape';

// "הודעה מוכנה לשליחה" ללקוחה (קישור + קוד גישה) - הגיבוי הידני כשמייל
// ההזמנה האוטומטי לא נשלח/הגיע. הוצא מ-app/dashboard/galleries/[id]/edit
// (handleCopyFormattedMessage/buildInviteEmailHtml) כדי שגם מסך "הגלריה
// נוצרה!" ישתמש באותה הודעה בדיוק. פונקציות טהורות (בלי window/navigator) -
// הקומפוננטה שמעתיקה: components/ClientInviteMessageCopy.tsx.
//
// ה-HTML באותו סגנון כמו המיילים האוטומטיים הממותגים (lib/email.ts:
// wrapEmailHtml/accessCodeBadge). לא ניתן לייבא את lib/email.ts בדפדפן (הוא
// משתמש ב-service_role client) אז זה כפול בכוונה.

// אותה בנייה כמו בשרת (app/api/galleries/route.ts, resend-invite):
// NEXT_PUBLIC_SITE_URL אם הוגדר, אחרת ה-origin הנוכחי.
export function buildGalleryUrl(siteUrl: string, galleryId: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/gallery/${galleryId}`;
}

export interface InviteMessageParams {
  clientName?: string | null;
  // לשון פנייה (galleries.client_gender) - חסר = נקבה, כמו ברירת המחדל בגלריה
  clientGender?: Gender | null;
  galleryUrl: string;
  accessCode: string;
  // expires_at כמו שהוא בטופס (YYYY-MM-DD) או ISO - אופציונלי
  expiresAt?: string | null;
  businessName?: string | null;
  logoUrl?: string | null;
  // שפת הגלריה (galleries.language) - חסר = עברית
  language?: Lang | null;
}

function waitingLine(lang: Lang, gender: Gender | null | undefined): string {
  return t(lang, 'inv.waiting', undefined, gender ?? DEFAULT_CLIENT_GENDER);
}

// תאריך עברי בעברית/יידיש, לועזי בשאר השפות (lib/i18n/format.ts)
function expiryDateText(lang: Lang, expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  return isNaN(date.getTime()) ? null : formatGalleryDate(lang, date);
}

// הקוד לבד בשורה משלו - לחיצה ארוכה בוואטסאפ/SMS מסמנת רק אותו (בלי
// "קוד גישה:" לפניו). התווית נשארת בשורה שמעל, כדי שהדבקת ההודעה כולה במסך
// הקוד תחלץ ממנה את הקוד (extractAccessCode ב-lib/accessCodePaste.ts).
export function buildInviteMessageText(params: InviteMessageParams): string {
  const lang = params.language ?? DEFAULT_LANG;
  const expiry = expiryDateText(lang, params.expiresAt);
  const expiryLine = expiry ? `\n\n${t(lang, 'inv.expiry', { date: expiry })}` : '';
  return `${t(lang, 'inv.hi', { name: params.clientName || '' })}\n\n${t(lang, 'inv.ready')}\n\n${t(lang, 'inv.link', { url: params.galleryUrl })}\n\n${t(lang, 'inv.codeLabel')}\n${params.accessCode}${expiryLine}\n\n${waitingLine(lang, params.clientGender)}`;
}

export function buildInviteMessageHtml(params: InviteMessageParams): string {
  const lang = params.language ?? DEFAULT_LANG;
  const expiry = expiryDateText(lang, params.expiresAt);
  const expiryLine = expiry ? `<br />${t(lang, 'inv.expiry', { date: expiry })}` : '';
  // שם לקוחה/עסק הם טקסט חופשי, והלוגו/הקישור נכנסים ל-attribute - מנטרלים
  // הכול (ולוגו/קישור רק http/https), כמו במיילים האוטומטיים
  const logoUrl = safeHref(params.logoUrl);
  const businessName = params.businessName ? escapeHtml(params.businessName) : '';
  const clientName = escapeHtml(params.clientName);
  const accessCode = escapeHtml(params.accessCode);
  const galleryUrl = safeHref(params.galleryUrl) ?? escapeHtml(params.galleryUrl);
  const fallbackName = escapeHtml(t(lang, 'inv.yourGallery'));
  return `
      <div dir="${langDir(lang)}" lang="${lang}" style="font-family: sans-serif; background: #f4f1ec; padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e7e0d5;">
          <tr>
            <td style="background: #0f1626; padding: 20px 28px; text-align: center;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="${businessName || fallbackName}" width="44" height="44" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #e3b3ac; display: block; margin: 0 auto 8px;" />`
                  : ''
              }
              <span style="font-family: sans-serif; font-size: 18px; font-weight: 700; color: #e3b3ac;">${logoUrl ? '' : '✨ '}${businessName || fallbackName}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px; text-align: center; color: #2a2420; font-size: 15px; line-height: 1.7;">
              <p style="margin: 0 0 8px;">${t(lang, 'inv.hi', { name: clientName || '' })}</p>
              <p style="margin: 0 0 8px;">${t(lang, 'inv.ready')}${expiryLine}</p>
              <div style="margin: 18px 0; padding: 12px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block;">
                <span style="font-size: 12px; color: #9a8f7d;">${t(lang, 'mail.codeLabel')}</span><br />
                <span dir="ltr" style="font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #a06a63; font-family: monospace; user-select: all; -webkit-user-select: all;">${accessCode}</span><br />
                <span style="font-size: 11px; color: #9a8f7d;">${t(lang, 'mail.codeHint')}</span>
              </div>
              <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">${waitingLine(lang, params.clientGender)}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto 0;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #e3b3ac, #c98f89);">
                    <a href="${galleryUrl}" style="display: inline-block; padding: 14px 32px; font-family: sans-serif; font-size: 15px; font-weight: 700; color: #20120f; text-decoration: none;">
                      ${t(lang, 'mail.enterCta')}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;
}

// ---------- "💬 הודעות מוכנות" לפי שלב ----------
//
// אותו רעיון כמו הודעת ההזמנה: טקסט לוואטסאפ + HTML ממותג למייל, בשפת
// הגלריה ובלשון הפנייה של הלקוח/ה, בגרסה חמה או רשמית. המחרוזות:
// lib/i18n/*/stages.ts. הקומפוננטה: components/StageMessagesMenu.tsx.

export const MESSAGE_STAGES = ['reminder', 'editing', 'reopened', 'ready'] as const;
export type MessageStage = (typeof MESSAGE_STAGES)[number];
export type MessageTone = 'warm' | 'formal';

// תוויות לצלמת (הממשק בעברית בלבד)
export const MESSAGE_STAGE_LABELS: Record<MessageStage, string> = {
  reminder: '🔔 תזכורת עדינה',
  editing: '💛 התחלתי לערוך',
  reopened: '🔓 הגלריה נפתחה מחדש לבחירה',
  ready: '🎉 התמונות מוכנות',
};

export interface StageMessageParams extends InviteMessageParams {
  stage: MessageStage;
  tone?: MessageTone;
  // כמות התמונות הסופיות (שלב "התמונות מוכנות")
  deliveredCount?: number;
}

// אילו חלקים בכל שלב: קישור / קוד גישה ותוקף (רק כשעוד בוחרים)
const STAGE_PARTS: Record<MessageStage, { link: boolean; code: boolean }> = {
  reminder: { link: true, code: true },
  editing: { link: false, code: false },
  reopened: { link: true, code: true },
  ready: { link: true, code: false },
};


interface StageContent {
  lang: Lang;
  hi: string;
  body: string;
  signoff: string | null;
  link: boolean;
  code: boolean;
  expiry: string | null;
}

function stageContent(params: StageMessageParams): StageContent {
  const lang = params.language ?? DEFAULT_LANG;
  const tone = params.tone ?? 'warm';
  const gender = params.clientGender ?? DEFAULT_CLIENT_GENDER;
  const parts = STAGE_PARTS[params.stage];
  const expiryDate = parts.code ? expiryDateText(lang, params.expiresAt) : null;
  const business = params.businessName?.trim();
  // בלי שם לקוח/ה: "היי ! 💛" -> "היי! 💛"
  const hi = t(lang, `stg.hi.${tone}`, { name: params.clientName?.trim() || '' }).replace(/\s+([!,:])/, '$1');
  return {
    lang,
    hi,
    body: t(lang, `stg.${params.stage}.${tone}`, { count: params.deliveredCount ?? 0 }, gender),
    signoff: business ? t(lang, `stg.signoff.${tone}`, { business }) : null,
    link: parts.link,
    code: parts.code && !!params.accessCode,
    expiry: expiryDate ? t(lang, 'inv.expiry', { date: expiryDate }) : null,
  };
}

export function buildStageMessageText(params: StageMessageParams): string {
  const c = stageContent(params);
  const blocks = [c.hi, c.body];
  if (c.link) blocks.push(t(c.lang, 'inv.link', { url: params.galleryUrl }));
  // הקוד לבד בשורה משלו - כמו בהודעת ההזמנה (לחיצה ארוכה מסמנת רק אותו)
  if (c.code) blocks.push(`${t(c.lang, 'inv.codeLabel')}\n${params.accessCode}`);
  if (c.expiry) blocks.push(c.expiry);
  if (c.signoff) blocks.push(c.signoff);
  return blocks.join('\n\n');
}

export function buildStageMessageHtml(params: StageMessageParams): string {
  const c = stageContent(params);
  const lang = c.lang;
  const brand = escapeHtml(params.businessName || t(lang, 'inv.yourGallery'));
  const logoUrl = safeHref(params.logoUrl) ?? '';
  const url = escapeHtml(params.galleryUrl);
  const cta = params.stage === 'ready' ? t(lang, 'stg.cta.view') : t(lang, 'mail.enterCta');
  const logo = logoUrl
    ? `<img src="${logoUrl}" alt="${brand}" width="44" height="44" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #e3b3ac; display: block; margin: 0 auto 8px;" />`
    : '';
  const codeBadge = c.code
    ? `<div style="margin: 18px 0; padding: 12px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block;">
                <span style="font-size: 12px; color: #9a8f7d;">${t(lang, 'mail.codeLabel')}</span><br />
                <span dir="ltr" style="font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #a06a63; font-family: monospace; user-select: all; -webkit-user-select: all;">${escapeHtml(params.accessCode)}</span>
              </div>`
    : '';
  const button = c.link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto 0;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #e3b3ac, #c98f89);">
                    <a href="${url}" style="display: inline-block; padding: 14px 32px; font-family: sans-serif; font-size: 15px; font-weight: 700; color: #20120f; text-decoration: none;">${cta}</a>
                  </td>
                </tr>
              </table>`
    : '';
  const signoff = c.signoff ? `<p style="margin: 24px 0 0; font-size: 13px; color: #6b6156;">${escapeHtml(c.signoff)}</p>` : '';
  return `
      <div dir="${langDir(lang)}" lang="${lang}" style="font-family: sans-serif; background: #f4f1ec; padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e7e0d5;">
          <tr>
            <td style="background: #0f1626; padding: 20px 28px; text-align: center;">
              ${logo}
              <span style="font-family: sans-serif; font-size: 18px; font-weight: 700; color: #e3b3ac;">${logoUrl ? '' : '✨ '}${brand}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px; text-align: center; color: #2a2420; font-size: 15px; line-height: 1.7;">
              <p style="margin: 0 0 8px;">${escapeHtml(c.hi)}</p>
              <p style="margin: 0 0 8px;">${escapeHtml(c.body)}${c.expiry ? `<br />${escapeHtml(c.expiry)}` : ''}</p>
              ${codeBadge}
              ${button}
              ${signoff}
            </td>
          </tr>
        </table>
      </div>
    `;
}
