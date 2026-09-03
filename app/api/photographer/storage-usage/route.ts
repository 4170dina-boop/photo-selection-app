import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// service_role רק בשביל storage.list() (כמו שאר קריאות ה-Storage באפליקציה) -
// אימות הצלמת עצמה, ואיזה גלריות שייכות לה, עובר קודם דרך ה-session/RLS הרגילים.
const supabaseAdmin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// מכסת האחסון של תוכנית Supabase החינמית - קבוע ידני (אין לנו טוקן ל-Management
// API כדי לשלוף את זה בזמן אמת, ראו README). לעדכן אם משדרגים תוכנית בתשלום.
const FREE_PLAN_STORAGE_LIMIT_GB = 1;
const BUCKET = 'gallery-photos';

// list() בStorage מחזיר עמוד יחיד בלבד - גם עם limit: 1000 מפורש, בלי דפדוף
// על offset גלריה עם יותר מ-1000 קבצים בתיקייה (originals או thumbs) הייתה
// מדווחת על נפח אחסון נמוך מהאמיתי.
type StorageEntry = { metadata: { size?: number } | null };

async function listAllFiles(bucket: string, path: string): Promise<StorageEntry[]> {
  const pageSize = 1000;
  const all: StorageEntry[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(path, { limit: pageSize, offset });
    if (error || !data) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const { data: galleries } = await supabase.from('galleries').select('id').eq('photographer_id', photographer.id);

  let totalBytes = 0;

  // originals, תמונות ה-thumbs, והתמונות הסופיות שנמסרו (final/, ראו "מסירת
  // תמונות סופיות" בדף העריכה) יושבים בשלוש "תיקיות" נפרדות בתוך אותה גלריה
  // (ראו app/dashboard/upload/[galleryId]/page.tsx ו-.../process/route.ts) -
  // list() לא רקורסיבי, אז צריך לשאול את כולן בנפרד לכל גלריה. final/ יכולה
  // לתפוס נפח משמעותי - קבצים ערוכים מלאים, לא preview דחוס כמו thumbs/.
  await Promise.all(
    (galleries ?? []).map(async (gallery) => {
      const [rootFiles, thumbFiles, finalFiles] = await Promise.all([
        listAllFiles(BUCKET, gallery.id),
        listAllFiles(BUCKET, `${gallery.id}/thumbs`),
        listAllFiles(BUCKET, `${gallery.id}/final`),
      ]);

      for (const file of [...rootFiles, ...thumbFiles, ...finalFiles]) {
        if (file.metadata?.size) totalBytes += file.metadata.size;
      }
    })
  );

  const totalGB = totalBytes / 1024 ** 3;

  return NextResponse.json({
    totalBytes,
    totalGB,
    freeLimitGB: FREE_PLAN_STORAGE_LIMIT_GB,
    percentUsed: Math.min(100, Math.round((totalGB / FREE_PLAN_STORAGE_LIMIT_GB) * 100)),
    galleryCount: galleries?.length ?? 0,
  });
}
