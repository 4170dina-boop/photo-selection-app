import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// שכבת גישה ל-Cloudflare R2, תואם S3 - מחליפה בהדרגה את Supabase Storage
// (חשבון החינמי שם מלא ב-100%, ראו סעיף המעבר ב-README). R2 הוא S3-compatible,
// אז אפשר להשתמש ב-SDK הרשמי של AWS בלי שינויים - רק endpoint ו-region שונים.
// ה-bucket ב-R2 נשאר **פרטי** (לא מפעילים r2.dev ציבורי) - אותו מודל אבטחה
// בדיוק כמו gallery-photos היום: כל גישה עוברת חתימת URL זמנית בצד שרת.
//
// חשוב: המודול הזה נבנה להיות תוסף בלבד בשלב הזה - אף touchpoint קיים
// (UploadProvider, process/route, ai-picks, וכו') לא משתמש בו עדיין. הוא
// ישמש רק ב-routes החדשים ובמיגרציה החד-פעמית, עד למעבר האטומי (deploy אחד).
//
// R2_ENDPOINT_OVERRIDE מאפשר להצביע את אותו קוד בדיוק על שרת S3-compatible
// מקומי (למשל MinIO/s3rver) לבדיקות, בלי לגעת בלוגיקה - forcePathStyle נדרש
// כי שרתים מקומיים כאלה בדרך כלל לא תומכים ב-virtual-hosted-style URLs
// (bucket.endpoint.com) כמו R2/S3 עצמם.
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID as string;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY as string;
export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME as string;

const endpoint = process.env.R2_ENDPOINT_OVERRIDE || `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

const s3 = new S3Client({
  region: 'auto', // R2 לא משתמש ב-regions אמיתיים של AWS, אבל ה-SDK דורש ערך - 'auto' זה מה ש-Cloudflare מתעדים
  endpoint,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
  forcePathStyle: !!process.env.R2_ENDPOINT_OVERRIDE,
});

// כמה זמן ה-URL החתום תקף - אותו טווח שהיה בשימוש מול Supabase Storage
// (createSignedUrl) בכל מקומות הקריאה הקיימים.
const DEFAULT_EXPIRES_SECONDS = 60 * 60;

// חותם URL להעלאה ישירה מהדפדפן (PUT) - ה-key נקבע בצד שרת ע"י ה-route
// שקורא לפונקציה הזו (לא מתקבל מהלקוח), בדיוק כמו שהיה בהעלאה הישירה
// ל-Supabase Storage היום.
export async function getPresignedUploadUrl(key: string, contentType?: string, expiresIn = DEFAULT_EXPIRES_SECONDS): Promise<string> {
  const command = new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn });
}

// חותם URL להורדה/צפייה (GET) - עם בדיקת קיום מקדימה כדי לשמר בדיוק את
// ההתנהגות של Supabase Storage שכל קוד קריאה קיים כבר סומך עליה
// (signed?.signedUrl ?? null): אם הקובץ לא קיים (למשל נוקה ע"י ניקוי המקור
// האוטומטי, ראו app/api/cron/tick/route.ts), מחזירים null במקום URL חתום
// ל"כלום" שרק ייכשל מאוחר יותר בדפדפן.
export async function getPresignedDownloadUrl(key: string, expiresIn = DEFAULT_EXPIRES_SECONDS): Promise<string | null> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  } catch {
    return null;
  }

  const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

// העלאה ישירה בצד שרת (לא דרך URL חתום) - בשימוש במיגרציה החד-פעמית
// (מעבירה בייטים מ-Supabase ל-R2) ובכל מקום עתידי שכבר מחזיק את הקובץ
// בזיכרון בצד שרת (כמו thumbnail אחרי עיבוד סימן מים).
export async function uploadBuffer(key: string, buffer: Buffer, contentType?: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType }));
}

// מורידה אובייקט לזיכרון בצד שרת. מחזירה null על 404 במקום לזרוק - קריטי
// למיגרציה: קובץ שכבר לא קיים ב-Supabase (למשל נוקה ע"י ניקוי המקור
// האוטומטי, ראו app/api/cron/tick/route.ts) הוא מצב תקין וצפוי, לא שגיאה.
export async function downloadToBuffer(key: string): Promise<Buffer | null> {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// בודקת קיום + גודל בלי להוריד את הקובץ עצמו - בשימוש במיגרציה לאימות
// שהגודל שהועלה ל-R2 תואם למקור לפני שמסמנים שורה כ"הועברה".
export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return { size: result.ContentLength ?? 0 };
  } catch (err: any) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// DeleteObjectsCommand מוגבל ל-1000 מפתחות בבקשה אחת (מגבלה קשיחה של S3/R2) -
// מחלקים לקבוצות כדי שמחיקה של גלריה גדולה (הרבה יותר מ-1000 קבצים) לא תיכשל.
const DELETE_CHUNK_SIZE = 1000;

export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_CHUNK_SIZE) {
    const chunk = keys.slice(i, i + DELETE_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET_NAME,
        Delete: { Objects: chunk.map((Key) => ({ Key })) },
      })
    );
  }
}

// רשימת כל המפתחות תחת prefix נתון - pagination אמיתי עם ContinuationToken
// (לא offset כמו הפגינציה הקודמת של Supabase Storage ב-storage-usage/route.ts
// שהייתה מוגבלת לעמוד יחיד בפועל) - כדי שגם תיקייה עם יותר מ-1000 קבצים
// תיספר עד הסוף.
export async function listAllKeys(prefix?: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await s3.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: prefix, ContinuationToken: continuationToken })
    );
    for (const obj of result.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}
