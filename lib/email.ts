// שליחת מייל דרך Resend (REST API ישיר, בלי SDK נוסף). אם RESEND_API_KEY לא
// מוגדר - לא זורקים שגיאה, רק מדלגים ומדפיסים אזהרה. כך גם app/api/cron/tick/route.ts
// וגם app/api/galleries/route.ts ממשיכים לעבוד (בלי לשלוח בפועל) בסביבת פיתוח
// בלי שירות מייל מחובר.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

interface SendResult {
  sent: boolean;
  error?: string;
}

async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY לא מוגדר - מדלג על שליחת מייל ל-${to}`);
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[email] שליחת מייל ל-${to} נכשלה: ${text}`);
    return { sent: false, error: text };
  }

  return { sent: true };
}

interface ExpiryReminderParams {
  to: string;
  clientName: string;
  businessName: string;
  galleryUrl: string;
  accessCode: string;
  expiresAt: string;
}

export async function sendExpiryReminderEmail(params: ExpiryReminderParams): Promise<SendResult> {
  const expiresDate = new Date(params.expiresAt).toLocaleDateString('he-IL');

  return sendEmail(
    params.to,
    `תזכורת: הגלריה שלך אצל ${params.businessName} עומדת לפוג`,
    `
      <div dir="rtl" style="font-family: sans-serif; line-height: 1.6;">
        <p>היי ${params.clientName},</p>
        <p>הגלריה שלך אצל ${params.businessName} עומדת לפוג בתאריך ${expiresDate}.</p>
        <p>אם עוד לא סיימת לבחור תמונות, זה הזמן:</p>
        <p><a href="${params.galleryUrl}">${params.galleryUrl}</a></p>
        <p>קוד גישה: <b>${params.accessCode}</b></p>
      </div>
    `
  );
}

interface GalleryInviteParams {
  to: string;
  clientName: string;
  businessName: string;
  galleryUrl: string;
  accessCode: string;
}

export async function sendGalleryInviteEmail(params: GalleryInviteParams): Promise<SendResult> {
  return sendEmail(
    params.to,
    `הגלריה שלך אצל ${params.businessName} מוכנה!`,
    `
      <div dir="rtl" style="font-family: sans-serif; line-height: 1.6;">
        <p>היי ${params.clientName},</p>
        <p>הגלריה שלך אצל ${params.businessName} מוכנה לבחירת תמונות:</p>
        <p><a href="${params.galleryUrl}">${params.galleryUrl}</a></p>
        <p>קוד גישה: <b>${params.accessCode}</b></p>
        <p>אפשר לסמן "אולי"/"נבחר" על כל תמונה, ולהוסיף הערות. בסיום, ללחוץ "סיימתי לבחור" כדי לשלוח את הבחירה.</p>
      </div>
    `
  );
}
