import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { getPresignedUploadUrl } from '@/lib/r2';
import {
  buildPhotoKey,
  FREE_PHOTO_LIMIT,
  parseUploadBatch,
  quotaGrantCount,
  remainingPhotoQuota,
  validateUploadRequest,
} from '@/lib/uploadPolicy';
import { originalsUploadBlockReason } from '@/lib/galleryLifecycle';

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
    .select('id, status, expires_at, reopened_for_selection_at, originals_cleaned_up_at')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // תמונות מקור חדשות לא הגיוניות כשהלקוחה כבר לא יכולה לבחור מתוכן (הבחירה
  // הסתיימה ולא נפתחה מחדש, או שפג תוקף), או כשתמונות המקור כבר נמחקו.
  const blockReason = originalsUploadBlockReason(gallery, new Date());
  if (blockReason) {
    return NextResponse.json({ error: blockReason }, { status: 409 });
  }

  // כמה קבצים בבקשה אחת ({ files: [...] }) - חוסך לכל קובץ את כל הבדיקות
  // למעלה (auth + צלמת + גלריה) ואת ספירת המכסה, שהיו רצות פעם לכל תמונה.
  // אובייקט בודד (הצורה הישנה) עדיין נתמך ומקבל תשובה בצורה הישנה.
  const parsed = parseUploadBatch(await req.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const validations = parsed.items.map((item) => validateUploadRequest(item));
  if (!parsed.isBatch && !validations[0].ok) {
    return NextResponse.json({ error: validations[0].error }, { status: 400 });
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
  const limitError = `LIMIT_PHOTOS: חשבון חינמי מוגבל ל-${FREE_PHOTO_LIMIT} תמונות בגלריה`;
  // רק הקבצים התקינים "צורכים" מכסה, לפי הסדר בבקשה.
  const validCount = validations.filter((v) => v.ok).length;
  let grantsLeft = quotaGrantCount(validCount, remainingPhotoQuota(count ?? 0, !!photographer.is_unlimited));

  if (!parsed.isBatch && grantsLeft === 0) {
    return NextResponse.json({ error: limitError }, { status: 403 });
  }

  // שם הקובץ המקורי לא נכנס ל-key (רק uuid + סיומת לפי סוג התוכן) - הוא
  // נשמר בנפרד ב-original_filename. החתימה עצמה מקומית (בלי רשת), אז אין
  // בעיה לחתום את כולם במקביל.
  const results = await Promise.all(
    validations.map(async (validation) => {
      if (!validation.ok) return { error: validation.error };
      if (grantsLeft <= 0) return { error: limitError };
      grantsLeft--;
      const path = buildPhotoKey(gallery.id, crypto.randomUUID(), validation.ext);
      try {
        const uploadUrl = await getPresignedUploadUrl(path, validation.contentType, validation.size);
        return { path, uploadUrl, contentType: validation.contentType };
      } catch {
        return { error: 'בקשת URL להעלאה נכשלה' };
      }
    })
  );

  if (!parsed.isBatch) {
    const single = results[0];
    if ('error' in single) return NextResponse.json({ error: single.error }, { status: 500 });
    return NextResponse.json(single);
  }
  return NextResponse.json({ results });
}
