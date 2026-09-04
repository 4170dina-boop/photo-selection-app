import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { uploadBuffer, headObject } from '@/lib/r2';

// מעביר בהדרגה (batch אחרי batch, מונע ע"י מי שמריץ את זה מהטרמינל - ראו
// תוכנית המעבר) קבצים קיימים מ-Supabase Storage ל-Cloudflare R2, בלי לגעת
// בשום touchpoint קיים באפליקציה - כל עוד המיגרציה לא הושלמה ואומתה, כל
// הקריאה/כתיבה בפועל ממשיכה לעבוד מול Supabase בדיוק כמו היום. הנתיבים
// עצמם (file_path/thumbnail_path ב-DB) לא משתנים בכלל - ה-key ב-R2 זהה
// לחלוטין לנתיב הקיים ב-Supabase, רק ה-backend שפותר אותו משתנה בעתיד.
export const maxDuration = 60;

const BUCKET = 'gallery-photos';

// service_role לשני הצדדים: קריאה/עדכון DB (לא קשור ל-session/RLS - זו
// עבודת רקע כמו app/api/cron/tick/route.ts) והורדה מה-bucket הפרטי.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// אותו דפוס בדיוק כמו isAuthorized ב-app/api/cron/tick/route.ts, עם סוד
// נפרד (MIGRATION_SECRET) - זה לא cron אמיתי (מי שמריץ את זה זה אני, לא
// שירות תזמון), אבל אותו צורך בדיוק: אימות מבוסס bearer token ולא session/עוגייה,
// כי requireAdmin הרגיל (lib/requireAdmin.ts) לא ניתן להפעלה מ-curl.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.MIGRATION_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  return req.nextUrl.searchParams.get('secret') === secret; // fallback נוח לבדיקה ידנית מהדפדפן
}

const DEFAULT_BATCH = 20;
// תקרה קשיחה - גם אם מבקשים ?batch גדול בטעות, כדי לא לחרוג מ-maxDuration
// למעלה (60 שניות) כשכל יחידה כוללת הורדה+העלאה שלמות של קובץ תמונה.
const MAX_BATCH = 200;

type Table = 'photos' | 'delivered_photos';

interface Unit {
  id: string;
  path: string;
  table: Table;
  column: 'file_migrated_at' | 'thumbnail_migrated_at';
}

// מורידה מה-Storage הישן (Supabase) בצד שרת עם service_role - אותו דפוס
// בדיוק כמו .../photos/[photoId]/process/route.ts. null = הקובץ לא קיים
// יותר (למשל נוקה ע"י ניקוי המקור האוטומטי, ראו app/api/cron/tick/route.ts) -
// זה מצב תקין וצפוי, לא שגיאה: פשוט אין מה להעביר, מסמנים "הועבר" בכל זאת.
async function downloadFromSupabase(path: string): Promise<{ buffer: Buffer; contentType?: string } | null> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return { buffer: Buffer.from(await data.arrayBuffer()), contentType: data.type || undefined };
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'לא מורשה' }, { status: 401 });
  }

  const requestedBatch = parseInt(req.nextUrl.searchParams.get('batch') ?? '', 10);
  const batch = Math.min(MAX_BATCH, requestedBatch > 0 ? requestedBatch : DEFAULT_BATCH);

  const units: Unit[] = [];

  // 1. photos.file_migrated_at - שאילתת count נפרדת מ-head:true (בלי הגבלת
  // limit) כדי לדעת את הכמות הכוללת הנותרת גם כשהבאטש הזה כבר מלא ולא
  // שולפים בפועל אף שורה מהקטגוריה הזו (limit(0) לא נתמך היטב ב-query builder).
  const { count: photosFileCount } = await supabaseAdmin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .is('file_migrated_at', null);
  if (units.length < batch) {
    const { data: photosFileRows } = await supabaseAdmin
      .from('photos')
      .select('id, file_path')
      .is('file_migrated_at', null)
      .limit(batch - units.length);
    for (const row of photosFileRows ?? []) {
      units.push({ id: row.id, path: row.file_path, table: 'photos', column: 'file_migrated_at' });
    }
  }

  // 2. delivered_photos.file_migrated_at
  const { count: deliveredFileCount } = await supabaseAdmin
    .from('delivered_photos')
    .select('id', { count: 'exact', head: true })
    .is('file_migrated_at', null);
  if (units.length < batch) {
    const { data: deliveredFileRows } = await supabaseAdmin
      .from('delivered_photos')
      .select('id, file_path')
      .is('file_migrated_at', null)
      .limit(batch - units.length);
    for (const row of deliveredFileRows ?? []) {
      units.push({ id: row.id, path: row.file_path, table: 'delivered_photos', column: 'file_migrated_at' });
    }
  }

  // 3. photos.thumbnail_migrated_at - רק תמונות שבהן ה-thumbnail הוא עותק
  // עצמאי (נתיב שונה מה-file_path) - אם עיבוד סימן המים נכשל בזמנו,
  // thumbnail_path == file_path (ראו .../photos/[photoId]/process/route.ts),
  // וזה בדיוק אותו קובץ שכבר עובר תחת photosFile למעלה - אין טעם להעביר
  // אותו פעמיים. השוואת שתי עמודות מאותה שורה לא אפשרית ישירות ב-query
  // builder של supabase-js (רק השוואה מול ערך קבוע) - אותו פתרון בדיוק
  // כמו app/api/cron/tick/route.ts (שלב 4): שולפים מועמדות ומסננים ב-JS.
  const { data: thumbCandidates } = await supabaseAdmin
    .from('photos')
    .select('id, file_path, thumbnail_path')
    .is('thumbnail_migrated_at', null)
    .not('thumbnail_path', 'is', null);

  const thumbNeeding = (thumbCandidates ?? []).filter((p) => p.thumbnail_path && p.thumbnail_path !== p.file_path);
  const photosThumbCount = thumbNeeding.length;

  for (const row of thumbNeeding) {
    if (units.length >= batch) break;
    units.push({ id: row.id, path: row.thumbnail_path as string, table: 'photos', column: 'thumbnail_migrated_at' });
  }

  let migrated = 0;
  let skippedMissing = 0;
  // כמה שורות בפועל סומנו "הועבר" (migrated + skippedMissing יחד) בכל אחת
  // משלוש הקטגוריות - כדי לחשב remaining למטה בלי שאילתת ספירה נוספת. נספר
  // ישירות בלולאה (לא בהנחה שהיחידות ה-N הראשונות הן אלה שהצליחו) כי יחידה
  // שנכשלת באימות הגודל באמצע הבאטש לא מסומנת בכלל, אז הסדר לא שומר על "כל
  // הכישלונות בסוף".
  const settledByColumn = { photosFile: 0, photosThumb: 0, deliveredFile: 0 };
  const now = new Date().toISOString();

  function columnKey(unit: Unit): keyof typeof settledByColumn {
    if (unit.table === 'delivered_photos') return 'deliveredFile';
    return unit.column === 'file_migrated_at' ? 'photosFile' : 'photosThumb';
  }

  for (const unit of units) {
    const original = await downloadFromSupabase(unit.path);

    if (!original) {
      // אין מה להעביר (כבר לא קיים ב-Supabase) - מסמנים "הועבר" כדי לא
      // לבדוק את אותה שורה שוב בכל ריצה, אבל לא סופרים כשגיאה.
      await supabaseAdmin.from(unit.table).update({ [unit.column]: now }).eq('id', unit.id);
      skippedMissing++;
      settledByColumn[columnKey(unit)]++;
      continue;
    }

    await uploadBuffer(unit.path, original.buffer, original.contentType);

    // מוודאים גודל תואם לפני שמסמנים "הועבר" - רשת ביטחון נגד העלאה חלקית/כשלון
    // שקט. לא בודקים תוכן בייט-לבייט (יקר מדי לכל קובץ), רק גודל - מספיק כדי
    // לתפוס את מקרי הכשל הנפוצים (חיבור נקטע באמצע, quota מלא בצד R2 וכו').
    const uploaded = await headObject(unit.path);
    if (!uploaded || uploaded.size !== original.buffer.length) {
      // לא מסמנים "הועבר" - הריצה הבאה תנסה שוב את אותה שורה מההתחלה.
      continue;
    }

    await supabaseAdmin.from(unit.table).update({ [unit.column]: now }).eq('id', unit.id);
    migrated++;
    settledByColumn[columnKey(unit)]++;
  }

  // "remaining" מחושב לפני שהעדכונים של הבאטש הנוכחי בוצעו (הספירות נשלפו
  // בתחילת הבקשה) - לכן מחסירים כאן את מה שהבאטש הזה בפועל סימן כ"הועבר"
  // כדי לשקף את המצב אחרי הריצה הזו, בלי שאילתת ספירה נוספת.
  const remaining = {
    photosFile: Math.max(0, (photosFileCount ?? 0) - settledByColumn.photosFile),
    photosThumb: Math.max(0, photosThumbCount - settledByColumn.photosThumb),
    deliveredFile: Math.max(0, (deliveredFileCount ?? 0) - settledByColumn.deliveredFile),
  };

  return NextResponse.json({
    processed: units.length,
    migrated,
    skippedMissing,
    remaining,
    done: remaining.photosFile === 0 && remaining.photosThumb === 0 && remaining.deliveredFile === 0,
  });
}
