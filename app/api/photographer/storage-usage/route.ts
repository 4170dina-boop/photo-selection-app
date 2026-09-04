import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listAllKeys } from '@/lib/r2';

// מכסת האחסון של תוכנית Cloudflare R2 החינמית (10GB, פי 10 מ-Supabase Storage
// שממנו עברנו - ראו lib/r2.ts) - קבוע ידני (אין לנו טוקן ל-API של Cloudflare
// כדי לשלוף את זה בזמן אמת). לעדכן אם משדרגים תוכנית בתשלום.
const FREE_PLAN_STORAGE_LIMIT_GB = 10;

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

  // originals, ה-thumbs, והתמונות הסופיות שנמסרו (final/) יושבים כולם תחת
  // אותה תחילית {galleryId}/ - בניגוד ל-list() הלא-רקורסיבי של Supabase
  // Storage (דרש שאילתה נפרדת לכל תת-תיקייה), listAllKeys עם prefix כולל
  // אותן אוטומטית, וגם מחזיר size לכל אובייקט בלי HeadObject נפרד לכל קובץ.
  await Promise.all(
    (galleries ?? []).map(async (gallery) => {
      const objects = await listAllKeys(`${gallery.id}/`);
      for (const obj of objects) totalBytes += obj.size;
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
