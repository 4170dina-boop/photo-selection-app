import crypto from 'crypto';

// טוקן session חתום (HMAC-SHA256), לא JWT מלא כי אין כאן claims מורכבים -
// אבל אותו עיקרון: payload + חתימה, ולא אפשר לזייף בלי SESSION_SECRET.
//
// הסוד נקרא בעצלתיים (בשימוש הראשון) ולא ברמת המודול, כדי ש-next build
// (שמייבא את ה-routes בלי סביבת ריצה מלאה) לא ייפול - אבל בשימוש הראשון
// בפועל זורקים שגיאה ברורה אם הסוד חסר/קצר מדי, במקום לחתום בשקט עם
// "undefined" או עם סוד חלש שקל לנחש (ואז אפשר לזייף session לכל גלריה).
export const MIN_SESSION_SECRET_LENGTH = 32;

export function assertValidSessionSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error('SESSION_SECRET חסר - יש להגדיר ערך אקראי חזק (לפחות 32 תווים) במשתני הסביבה');
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET קצר מדי (${secret.length} תווים) - נדרשים לפחות ${MIN_SESSION_SECRET_LENGTH}, למשל: openssl rand -base64 32`
    );
  }
  return secret;
}

function getSecret(): string {
  return assertValidSessionSecret(process.env.SESSION_SECRET);
}

export interface SessionPayload {
  galleryId: string;
  clientId: string;
  // מי מסתכל/ת בגלריה עכשיו (שיתוף גלריה משפחתי) - null מיד אחרי אימות קוד
  // הגישה, עד שנבחרת זהות (ראו app/api/gallery/[id]/identify/route.ts).
  // session ישן (לפני הפיצ'ר הזה) לא יכיל את השדה בכלל - מטופל כמו null.
  participantId: string | null;
  iat: number; // Date.now() בזמן היצירה
}

function hmac(body: string): string {
  return crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
}

export function signSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function verifySession(
  token: string | undefined,
  galleryId: string,
  maxAgeMs: number
): SessionPayload | null {
  if (!token) return null;

  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = hmac(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }

  if (payload.galleryId !== galleryId) return null;
  if (Date.now() - payload.iat > maxAgeMs) return null;

  // session שנחתם לפני שיתוף הגלריה המשפחתי לא יכיל participantId בכלל -
  // מנרמלים ל-null במקום undefined, כדי שבדיקת "עדיין לא זוהה" תהיה אחידה.
  return { ...payload, participantId: payload.participantId ?? null };
}

// השוואת קודים בזמן קבוע - מונע timing attack על אורך/תוכן קוד הגישה
export function safeCompare(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

// קודי הגישה נוצרים באותיות גדולות (hex, ראו generateAccessCode ב-
// app/api/galleries/route.ts), אבל לקוחה שמקלידה ממובייל מקבלת לרוב אותיות
// קטנות - משווים בלי תלות ברישיות ובלי רווחים בקצוות, עדיין בזמן קבוע.
export function accessCodesMatch(expected: string | null | undefined, provided: string | null | undefined): boolean {
  if (!expected || !provided) return false;
  return safeCompare(expected.trim().toUpperCase(), provided.trim().toUpperCase());
}
