// שליחת מייל דרך Resend (REST API ישיר, בלי SDK נוסף). אם RESEND_API_KEY לא
// מוגדר - לא זורקים שגיאה, רק מדלגים ומדפיסים אזהרה. כך app/api/cron/tick/route.ts
// ממשיך לעבוד (ומעדכן סטטוסים) גם בסביבת פיתוח בלי שירות מייל מחובר.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

interface ExpiryReminderParams {
  to: string;
  clientName: string;
  businessName: string;
  galleryUrl: string;
  accessCode: string;
  expiresAt: string;
}

export async function sendExpiryReminderEmail(
  params: ExpiryReminderParams
): Promise<{ sent: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY לא מוגדר - מדלג על שליחת תזכורת ל-${params.to}`);
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const expiresDate = new Date(params.expiresAt).toLocaleDateString('he-IL');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: params.to,
      subject: `תזכורת: הגלריה שלך אצל ${params.businessName} עומדת לפוג`,
      html: `
        <div dir="rtl" style="font-family: sans-serif; line-height: 1.6;">
          <p>היי ${params.clientName},</p>
          <p>הגלריה שלך אצל ${params.businessName} עומדת לפוג בתאריך ${expiresDate}.</p>
          <p>אם עוד לא סיימת לבחור תמונות, זה הזמן:</p>
          <p><a href="${params.galleryUrl}">${params.galleryUrl}</a></p>
          <p>קוד גישה: <b>${params.accessCode}</b></p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[email] שליחת תזכורת ל-${params.to} נכשלה: ${text}`);
    return { sent: false, error: text };
  }

  return { sent: true };
}
