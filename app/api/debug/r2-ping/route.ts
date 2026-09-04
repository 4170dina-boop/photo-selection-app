import { NextRequest, NextResponse } from 'next/server';
import { uploadBuffer, downloadToBuffer, deleteObjects, getPresignedUploadUrl } from '@/lib/r2';

// נתיב אבחון זמני - נועד לבדוד את הבעיה שנתקלנו בה (405/418 בהעלאה ישירה
// מהדפדפן דרך URL חתום) ולבדוק אם זו בעיה בקונפיגורציה של R2 עצמה, או
// משהו ספציפי לבקשה שמגיעה מדפדפן (למשל הגנת בוט של Cloudflare). יימחק
// אחרי שהאבחון יסתיים - לא חלק קבוע מהאפליקציה.
const DEBUG_SECRET = 'lolrX0NlggOSkJPUay8D9-TxIMtbrPE_';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('secret') !== DEBUG_SECRET) {
    return NextResponse.json({ error: 'לא מורשה' }, { status: 401 });
  }

  const testKey = `debug-ping/${Date.now()}.txt`;
  const result: Record<string, any> = {};

  // שלב 1: SDK ישיר (uploadBuffer/downloadToBuffer) - האם האישורים/ה-bucket תקינים בכלל
  try {
    await uploadBuffer(testKey, Buffer.from('ping'), 'text/plain');
    const back = await downloadToBuffer(testKey);
    result.sdkUpload = { ok: true, readBack: back?.toString() };
  } catch (err: any) {
    result.sdkUpload = { ok: false, name: err?.name, message: err?.message, status: err?.$metadata?.httpStatusCode };
  }

  // שלב 2: PUT גולמי מהשרת עצמו ל-URL חתום (בדיוק כמו שהדפדפן עושה) - כדי
  // לבדוד אם הבעיה ספציפית לבקשה שמגיעה מדפדפן (למשל הגנת בוט) או קיימת גם
  // מהשרת.
  try {
    const presignKey = `debug-ping/${Date.now()}-presigned.txt`;
    const url = await getPresignedUploadUrl(presignKey);
    const putRes = await fetch(url, { method: 'PUT', body: 'ping-presigned', headers: { 'Content-Type': 'text/plain' } });
    const bodyText = await putRes.text().catch(() => '');
    result.serverPresignedPut = { ok: putRes.ok, status: putRes.status, body: bodyText.slice(0, 500) };
    if (putRes.ok) await deleteObjects([presignKey]);
  } catch (err: any) {
    result.serverPresignedPut = { ok: false, name: err?.name, message: err?.message };
  }

  try {
    await deleteObjects([testKey]);
  } catch {
    // לא קריטי לניקוי - זה בכל מקרה קובץ בדיקה זעיר
  }

  return NextResponse.json(result);
}
