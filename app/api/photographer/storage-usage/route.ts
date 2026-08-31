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

  // originals ותמונות ה-thumbs יושבים בשתי "תיקיות" נפרדות בתוך אותה גלריה
  // (ראו app/dashboard/upload/[galleryId]/page.tsx ו-.../process/route.ts) -
  // list() לא רקורסיבי, אז צריך לשאול את שתיהן בנפרד לכל גלריה.
  await Promise.all(
    (galleries ?? []).map(async (gallery) => {
      const [{ data: rootFiles }, { data: thumbFiles }] = await Promise.all([
        supabaseAdmin.storage.from(BUCKET).list(gallery.id, { limit: 1000 }),
        supabaseAdmin.storage.from(BUCKET).list(`${gallery.id}/thumbs`, { limit: 1000 }),
      ]);

      for (const file of [...(rootFiles ?? []), ...(thumbFiles ?? [])]) {
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
