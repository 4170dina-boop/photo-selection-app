// שליחת מייל דרך Resend (REST API ישיר, בלי SDK נוסף). אם RESEND_API_KEY לא
// מוגדר - לא זורקים שגיאה, רק מדלגים ומדפיסים אזהרה. כך גם app/api/cron/tick/route.ts
// וגם app/api/galleries/route.ts ממשיכים לעבוד (בלי לשלוח בפועל) בסביבת פיתוח
// בלי שירות מייל מחובר.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

interface SendResult {
  sent: boolean;
  error?: string;
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

async function sendEmail(to: string, subject: string, html: string, options: SendOptions = {}): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY לא מוגדר - מדלג על שליחת מייל ל-${to}`);
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const from = options.fromName ? `"${options.fromName}" <${FROM_ADDRESS}>` : FROM_ADDRESS;

  const body: Record<string, unknown> = { from, to, subject, html };
  if (options.replyTo) body.reply_to = options.replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[email] שליחת מייל ל-${to} נכשלה: ${text}`);
    return { sent: false, error: text };
  }

  return { sent: true };
}

// עטיפת HTML אחידה לכל המיילים - כרטיס לבן ממורכז על רקע בהיר (לא הרקע הכהה
// של האתר עצמו: תוכנות מייל רבות מתעלמות/דורסות CSS מורכב, ורקע כהה עם טקסט
// שחזוי-אוטומטית עלול להיראות שבור אצל חלק מהנמענים) עם באנר עליון כהה+זהב
// שממותג כמו הכותרת העליונה באתר (theme.ts: theme.bg + theme.gold),
// וכפתור קריאה-לפעולה בגרדיאנט הזהב של goldButtonStyle - כדי שהמייל ירגיש
// כהמשך ישיר של חוויית האתר, לא כמו מייל אוטומטי גנרי.
function wrapEmailHtml(params: { headerText: string; bodyHtml: string; ctaText?: string; ctaUrl?: string }): string {
  const cta =
    params.ctaText && params.ctaUrl
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto 0;">
          <tr>
            <td style="border-radius: 8px; background: linear-gradient(135deg, #e3b3ac, #c98f89);">
              <a href="${params.ctaUrl}" style="display: inline-block; padding: 14px 32px; font-family: sans-serif; font-size: 15px; font-weight: 700; color: #20120f; text-decoration: none;">
                ${params.ctaText}
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
            <span style="font-family: sans-serif; font-size: 18px; font-weight: 700; color: #e3b3ac;">✨ ${params.headerText}</span>
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
function accessCodeBadge(code: string): string {
  return `
    <div style="margin: 18px 0; padding: 12px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block;">
      <span style="font-size: 12px; color: #9a8f7d;">קוד גישה</span><br />
      <span style="font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #a06a63; font-family: monospace;">${code}</span>
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
  const expiresDate = new Date(params.expiresAt).toLocaleDateString('he-IL');

  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${params.clientName},</p>
      <p style="margin: 0 0 8px;">הגלריה שלך אצל <b>${params.businessName}</b> עומדת לפוג בתאריך <b>${expiresDate}</b>.</p>
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
      <p style="margin: 0 0 8px;">היי ${params.clientName},</p>
      <p style="margin: 0 0 8px;">הגלריה שלך אצל <b>${params.businessName}</b> מוכנה לבחירת תמונות! ✨</p>
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
      <p style="margin: 0;"><b>${params.clientName}</b> סיימה לבחור תמונות בגלריה - נבחרו <b>${params.selectedCount}</b> תמונות.</p>
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
      <p style="margin: 0 0 8px;"><b>${params.clientName}</b> בחרה ${params.includedPhotos} תמונות - בדיוק המכסה שכלולה בחבילה שלה.</p>
      <p style="margin: 0; font-size: 13px; color: #6b6156;">היא עדיין יכולה להמשיך לבחור (עם חיוב על חריגה), או שהיא כבר עומדת לסיים.</p>
    `,
    ctaText: 'צפייה בגלריה',
    ctaUrl: params.dashboardUrl,
  });

  return sendEmail(params.to, `${params.clientName} הגיעה למכסת התמונות בחבילה`, html, { fromName: 'אזור צלמים ✨' });
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
    .map((name) => `<li style="text-align: right; margin: 2px 0;">${name}</li>`)
    .join('');

  const html = wrapEmailHtml({
    headerText: params.businessName,
    bodyHtml: `
      <p style="margin: 0 0 8px;">היי ${params.clientName},</p>
      <p style="margin: 0 0 8px;">הבחירה שלך אצל <b>${params.businessName}</b> נשלחה בהצלחה ✓ - ${params.filenames.length} תמונות:</p>
      <ul style="margin: 12px auto; padding-right: 20px; text-align: right; display: inline-block; font-size: 13px; color: #4a4238;">${list}</ul>
      <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">אין צורך לעשות עוד כלום, הצלמת תיצור איתך קשר להמשך.</p>
    `,
  });

  return sendEmail(params.to, `הבחירה שלך אצל ${params.businessName} נשלחה בהצלחה`, html, {
    fromName: params.businessName,
    replyTo: params.replyTo,
  });
}
