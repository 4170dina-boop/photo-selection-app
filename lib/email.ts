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

interface SelectionCompleteParams {
  to: string;
  clientName: string;
  selectedCount: number;
  dashboardUrl: string;
}

// מודיעה לצלמת שלקוחה סיימה לבחור - נשלחת מ-app/api/gallery/[id]/finish, לצד
// עדכון סטטוס הגלריה. בלי זה לצלמת אין שום דרך לדעת שהבחירה הסתיימה חוץ
// מלהיכנס ולבדוק ידנית.
export async function sendSelectionCompleteEmail(params: SelectionCompleteParams): Promise<SendResult> {
  return sendEmail(
    params.to,
    `${params.clientName} סיימה לבחור תמונות`,
    `
      <div dir="rtl" style="font-family: sans-serif; line-height: 1.6;">
        <p>היי,</p>
        <p>${params.clientName} סיימה לבחור תמונות בגלריה - נבחרו ${params.selectedCount} תמונות.</p>
        <p><a href="${params.dashboardUrl}">צפייה בבחירה ובהורדת התמונות</a></p>
      </div>
    `
  );
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
  return sendEmail(
    params.to,
    `${params.clientName} הגיעה למכסת התמונות בחבילה`,
    `
      <div dir="rtl" style="font-family: sans-serif; line-height: 1.6;">
        <p>היי,</p>
        <p>${params.clientName} בחרה ${params.includedPhotos} תמונות - בדיוק המכסה שכלולה בחבילה שלה.</p>
        <p>היא עדיין יכולה להמשיך לבחור (עם חיוב על חריגה), או שהיא כבר עומדת לסיים.</p>
        <p><a href="${params.dashboardUrl}">צפייה בגלריה</a></p>
      </div>
    `
  );
}

interface ClientSelectionSummaryParams {
  to: string;
  clientName: string;
  businessName: string;
  filenames: string[];
}

// אישור ללקוחה על הבחירה הסופית שלה, ברגע "סיימתי לבחור" - אותו trigger
// בדיוק כמו sendSelectionCompleteEmail (לצלמת), רק תוכן שונה. נשלחת רק
// ללקוחה עצמה (הבעלים) - לא לבני משפחה אחרים שרק תרמו קלט.
export async function sendClientSelectionSummaryEmail(params: ClientSelectionSummaryParams): Promise<SendResult> {
  const list = params.filenames.map((name) => `<li>${name}</li>`).join('');

  return sendEmail(
    params.to,
    `הבחירה שלך אצל ${params.businessName} נשלחה בהצלחה`,
    `
      <div dir="rtl" style="font-family: sans-serif; line-height: 1.6;">
        <p>היי ${params.clientName},</p>
        <p>הבחירה שלך אצל ${params.businessName} נשלחה בהצלחה - ${params.filenames.length} תמונות:</p>
        <ul>${list}</ul>
        <p>אין צורך לעשות עוד כלום, הצלמת תיצור איתך קשר להמשך.</p>
      </div>
    `
  );
}
