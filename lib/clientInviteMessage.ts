import { toHebrewDateString } from './hebrewDate';

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
  galleryUrl: string;
  accessCode: string;
  // expires_at כמו שהוא בטופס (YYYY-MM-DD) או ISO - אופציונלי
  expiresAt?: string | null;
  businessName?: string | null;
  logoUrl?: string | null;
}

function expiryDateText(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  return isNaN(date.getTime()) ? null : toHebrewDateString(date);
}

export function buildInviteMessageText(params: InviteMessageParams): string {
  const expiry = expiryDateText(params.expiresAt);
  const expiryLine = expiry ? `\nהגלריה פתוחה לבחירה עד ${expiry}.` : '';
  return `היי ${params.clientName || ''}! 📸\n\nהגלריה שלך עם התמונות מוכנה לבחירה.\n\nקישור: ${params.galleryUrl}\nקוד גישה: ${params.accessCode}${expiryLine}\n\nמחכה לראות מה תבחרי! ✨`;
}

export function buildInviteMessageHtml(params: InviteMessageParams): string {
  const expiry = expiryDateText(params.expiresAt);
  const expiryLine = expiry ? `<br />הגלריה פתוחה לבחירה עד ${expiry}.` : '';
  const { logoUrl, businessName, clientName, accessCode, galleryUrl } = params;
  return `
      <div dir="rtl" style="font-family: sans-serif; background: #f4f1ec; padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e7e0d5;">
          <tr>
            <td style="background: #0f1626; padding: 20px 28px; text-align: center;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="${businessName || 'הגלריה שלך'}" width="44" height="44" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #e3b3ac; display: block; margin: 0 auto 8px;" />`
                  : ''
              }
              <span style="font-family: sans-serif; font-size: 18px; font-weight: 700; color: #e3b3ac;">${logoUrl ? '' : '✨ '}${businessName || 'הגלריה שלך'}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px; text-align: center; color: #2a2420; font-size: 15px; line-height: 1.7;">
              <p style="margin: 0 0 8px;">היי ${clientName || ''}! 📸</p>
              <p style="margin: 0 0 8px;">הגלריה שלך עם התמונות מוכנה לבחירה.${expiryLine}</p>
              <div style="margin: 18px 0; padding: 12px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block;">
                <span style="font-size: 12px; color: #9a8f7d;">קוד גישה</span><br />
                <span style="font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #a06a63; font-family: monospace;">${accessCode}</span>
              </div>
              <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">מחכה לראות מה תבחרי! ✨</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto 0;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #e3b3ac, #c98f89);">
                    <a href="${galleryUrl}" style="display: inline-block; padding: 14px 32px; font-family: sans-serif; font-size: 15px; font-weight: 700; color: #20120f; text-decoration: none;">
                      כניסה לגלריה
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
