import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { getPresignedUploadUrl } from '@/lib/r2';
import { buildPhotoKey, FREE_PHOTO_LIMIT, remainingPhotoQuota, validateUploadRequest } from '@/lib/uploadPolicy';

// מחליף את ההעלאה הישירה מהדפדפן ל-Supabase Storage שהייתה קודם ב-
// app/dashboard/UploadProvider.tsx: ל-R2 (כמו S3) אין מקבילה ל-RLS שמאפשרת
// לדפדפן לדבר ישירות עם האחסון בבטחה, אז חתימת ה-URL חייבת לקרות כאן, בצד
// שרת, עם מפתחות סודיים שאסור לחשוף ללקוח. הנתיב עצמו חשוב שייקבע כאן ולא
// יתקבל מהלקוח - אחרת אין מניעה שהיא תבקש path שדורך על תמונה של גלריה אחרת.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, is_unlimited')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const validation = validateUploadRequest(await req.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // בודקים את המכסה כבר כאן, לפני שהדפדפן מעלה בייטים ל-R2 - אחרת ה-insert
  // נדחה ע"י enforce_photo_limit רק אחרי שהקובץ כבר יושב ב-R2. ה-trigger ב-DB
  // נשאר האכיפה הסופית (העלאות מקבילות יכולות לעבור את הבדיקה הזו יחד, ואז
  // רישום התמונה ב-../route.ts מוחק את הקובץ מ-R2).
  const { count, error: countError } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('gallery_id', gallery.id);
  if (countError) {
    return NextResponse.json({ error: 'בדיקת מכסת התמונות נכשלה' }, { status: 500 });
  }
  if (remainingPhotoQuota(count ?? 0, !!photographer.is_unlimited) === 0) {
    return NextResponse.json(
      { error: `LIMIT_PHOTOS: חשבון חינמי מוגבל ל-${FREE_PHOTO_LIMIT} תמונות בגלריה` },
      { status: 403 }
    );
  }

  // שם הקובץ המקורי לא נכנס ל-key (רק uuid + סיומת לפי סוג התוכן) - הוא
  // נשמר בנפרד ב-original_filename.
  const path = buildPhotoKey(gallery.id, crypto.randomUUID(), validation.ext);
  const uploadUrl = await getPresignedUploadUrl(path, validation.contentType, validation.size);

  return NextResponse.json({ path, uploadUrl, contentType: validation.contentType });
}
