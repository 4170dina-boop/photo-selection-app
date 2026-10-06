// בדיקת שפיות לפני העתקה/שליחה של ההזמנה ללקוחה - אזהרות "רכות" (לא חוסמות):
// הצלמת רואה מה נראה לא תקין ויכולה "להעתיק/לשלוח בכל זאת". פונקציה טהורה -
// התצוגה: components/InviteSanityWarnings.tsx (בדף עריכת הגלריה).

export type InviteWarningCode =
  | 'no-photos'
  | 'photos-processing'
  | 'extra-price-zero'
  | 'no-client-email'
  | 'expiry-soon'
  | 'expired'
  | 'no-access-code';

export interface InviteWarning {
  code: InviteWarningCode;
  message: string;
}

export interface InviteSanityInput {
  // null = עדיין לא נטען / לא ידוע - לא מזהירים על מה שלא יודעים
  photoCount: number | null;
  processingCount: number | null;
  includedPhotos: number | null;
  extraPhotoPrice: number | null;
  clientEmail: string | null | undefined;
  // YYYY-MM-DD (מהטופס) או ISO
  expiresAt: string | null | undefined;
  accessCode: string | null | undefined;
  now?: Date;
}

export const EXPIRY_SOON_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// תאריך בלבד (YYYY-MM-DD) = סוף היום - כמו israelEndOfDayIso בשמירה
function parseExpiry(value: string): number | null {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59`).getTime() : new Date(value).getTime();
  return isNaN(ms) ? null : ms;
}

export function inviteSanityWarnings(input: InviteSanityInput): InviteWarning[] {
  const warnings: InviteWarning[] = [];
  const now = (input.now ?? new Date()).getTime();

  if (input.photoCount === 0) {
    warnings.push({ code: 'no-photos', message: 'עדיין לא הועלו תמונות לגלריה - הלקוחה תיכנס לגלריה ריקה' });
  }
  if (input.processingCount != null && input.processingCount > 0) {
    warnings.push({
      code: 'photos-processing',
      message: `${input.processingCount} תמונות עדיין בעיבוד - הן לא יוצגו ללקוחה עד שהעיבוד יסתיים`,
    });
  }
  if (
    input.extraPhotoPrice === 0 &&
    input.photoCount != null &&
    input.includedPhotos != null &&
    input.photoCount > input.includedPhotos
  ) {
    warnings.push({
      code: 'extra-price-zero',
      message: `בגלריה ${input.photoCount} תמונות והחבילה כוללת ${input.includedPhotos}, אבל המחיר לתמונה נוספת הוא 0 - הלקוחה תוכל לבחור יותר בלי תשלום`,
    });
  }
  if (!input.clientEmail?.trim()) {
    warnings.push({ code: 'no-client-email', message: 'אין כתובת מייל ללקוחה - היא לא תקבל תזכורות ועדכונים במייל' });
  }
  if (input.expiresAt) {
    const expiry = parseExpiry(input.expiresAt);
    if (expiry !== null && expiry <= now) {
      warnings.push({ code: 'expired', message: 'תוקף הגלריה כבר עבר - הלקוחה לא תוכל לבחור. כדאי להאריך לפני השליחה' });
    } else if (expiry !== null && expiry - now < EXPIRY_SOON_DAYS * DAY_MS) {
      const days = Math.max(1, Math.ceil((expiry - now) / DAY_MS));
      warnings.push({
        code: 'expiry-soon',
        message: days === 1 ? 'הגלריה נסגרת לבחירה תוך יום - זמן קצר מאוד לבחירה' : `הגלריה נסגרת לבחירה בעוד ${days} ימים - זמן קצר לבחירה`,
      });
    }
  }
  if (!input.accessCode?.trim()) {
    warnings.push({ code: 'no-access-code', message: 'חסר קוד גישה - הלקוחה לא תוכל להיכנס לגלריה' });
  }

  return warnings;
}
