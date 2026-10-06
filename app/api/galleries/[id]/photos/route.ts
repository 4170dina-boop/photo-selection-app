import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteObjects, headObject } from '@/lib/r2';
import { existingRegistrationResult, isFreshPhotoKey, MAX_UPLOAD_BYTES, parseUploadBatch } from '@/lib/uploadPolicy';
import { parseTakenAtInput } from '@/lib/exifDate';

// רישום תמונה שהדפדפן כבר העלה ל-R2 (דרך ה-URL החתום מ-presign-upload).
// ה-insert עבר לכאן מהדפדפן (UploadProvider.tsx) כדי שאם הוא נכשל (למשל
// LIMIT_PHOTOS מ-enforce_photo_limit כשכמה העלאות מקבילות עברו יחד את בדיקת
// המכסה ב-presign) - נמחק גם את הקובץ מ-R2, במקום להשאיר אותו יתום.
//
// thumbnail_path נשאר null עד ש-/process מסיים ליצור גרסה עם סימן מים - תמונה
// בלי thumbnail לא מוצגת ללקוחה בכלל (ראו app/api/gallery/[id]/route.ts),
// כך שהמקור הנקי אף פעם לא נחשף גם אם העיבוד נכשל.
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
    .select('id')
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

  // כמה תמונות בבקשה אחת ({ files: [...] }) - הבדיקות למעלה (auth + צלמת +
  // גלריה) רצות פעם אחת לכל הקבוצה ולא לכל תמונה. כל תמונה עדיין נבדקת
  // ונרשמת בנפרד (insert לכל שורה, כדי ש-enforce_photo_limit ידחה רק את מה
  // שעובר את המכסה ולא את כל הקבוצה). אובייקט בודד (הצורה הישנה) עדיין נתמך.
  const parsed = parseUploadBatch<{ path?: unknown; originalFilename?: unknown; takenAt?: unknown }>(await req.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // אותו key פעמיים באותה בקשה - נרשם פעם אחת, ושני הפריטים מקבלים את אותה
  // תוצאה (בלי זה שני ה-inserts היו עוברים יחד את בדיקת "כבר רשומה").
  const byPath = new Map<string, Promise<RegisterResult>>();
  const results = await Promise.all(
    parsed.items.map((item) => {
      const path = item?.path;
      if (typeof path !== 'string') return registerOne(supabase, gallery.id, item);
      const pending = byPath.get(path);
      if (pending) return pending;
      const promise = registerOne(supabase, gallery.id, item);
      byPath.set(path, promise);
      return promise;
    })
  );

  if (!parsed.isBatch) {
    const single = results[0];
    if ('error' in single) return NextResponse.json({ error: single.error }, { status: single.status });
    return NextResponse.json({ id: single.id });
  }
  return NextResponse.json({
    results: results.map((r) => ('error' in r ? { error: r.error } : { id: r.id })),
  });
}

type RegisterResult = { id: string } | { error: string; status: number };

async function registerOne(
  supabase: ReturnType<typeof createClient>,
  galleryId: string,
  item: { path?: unknown; originalFilename?: unknown; takenAt?: unknown }
): Promise<RegisterResult> {
  const path = item?.path;
  const originalFilename = typeof item?.originalFilename === 'string' ? item.originalFilename.slice(0, 255) : '';

  // רק key בדיוק בתבנית ש-presign-upload יוצר ({galleryId}/{uuid}.{ext}) - לא
  // thumbs/, final/, או נתיב של גלריה אחרת.
  if (!isFreshPhotoKey(galleryId, path) || !originalFilename) {
    return { error: 'בקשה לא תקינה', status: 400 };
  }

  // key שכבר רשום - לא נוגעים בו (ובוודאי לא מוחקים אותו למטה). אם הוא רשום
  // בגלריה הזו, זה ניסיון חוזר אחרי שהתשובה הקודמת אבדה - מחזירים את התמונה
  // הקיימת (אידמפוטנטי) במקום שגיאה. ראו existingRegistrationResult.
  const { data: existing } = await supabase.from('photos').select('id, gallery_id').eq('file_path', path).maybeSingle();
  const existingResult = existingRegistrationResult(existing as { id: string; gallery_id: string } | null, galleryId);
  if (existingResult) return existingResult;

  const head = await headObject(path).catch(() => null);
  if (!head) {
    return { error: 'הקובץ לא נמצא באחסון', status: 400 };
  }
  if (head.size > MAX_UPLOAD_BYTES) {
    await cleanup(path);
    return { error: 'הקובץ גדול מדי', status: 413 };
  }

  const { data: photo, error: insertError } = await supabase
    .from('photos')
    .insert({ gallery_id: galleryId, file_path: path, thumbnail_path: null, original_filename: originalFilename })
    .select('id')
    .single();

  if (insertError || !photo) {
    // unique violation על file_path (אם הורץ ה-unique index האופציונלי) - בקשה
    // מקבילה כבר רשמה את אותו key. לא מוחקים את הקובץ שלה; מחזירים את השורה שלה.
    if (insertError?.code === '23505') {
      const { data: raced } = await supabase.from('photos').select('id, gallery_id').eq('file_path', path).maybeSingle();
      const racedResult = existingRegistrationResult(raced as { id: string; gallery_id: string } | null, galleryId);
      return racedResult ?? { error: 'התמונה כבר רשומה', status: 409 };
    }
    await cleanup(path);
    const message = insertError?.message ?? '';
    if (message.includes('LIMIT_PHOTOS')) {
      return { error: message, status: 403 };
    }
    return { error: 'שמירת התמונה נכשלה', status: 500 };
  }

  // שעת הצילום (EXIF) שהדפדפן קרא מהקובץ המקורי לפני ההקטנה - ראו lib/exifDate.ts.
  // עדכון נפרד ו-best-effort: אם העמודה taken_at עוד לא קיימת (המיגרציה ב-
  // supabase/schema.sql לא רצה), זה לא אמור להפיל את רישום התמונה עצמו.
  const takenAt = parseTakenAtInput(item?.takenAt);
  if (takenAt) {
    try {
      await supabase.from('photos').update({ taken_at: takenAt }).eq('id', photo.id);
    } catch {
      // בכוונה שקט - ראו למעלה
    }
  }

  return { id: photo.id as string };
}

async function cleanup(path: string) {
  try {
    await deleteObjects([path]);
  } catch (err) {
    console.error('[photos] מחיקת קובץ יתום מ-R2 נכשלה:', path, err);
  }
}
