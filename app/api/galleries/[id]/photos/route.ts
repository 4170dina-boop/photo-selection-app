import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteObjects, headObject } from '@/lib/r2';
import { isFreshPhotoKey, MAX_UPLOAD_BYTES } from '@/lib/uploadPolicy';

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

  const body = await req.json().catch(() => null);
  const path = body?.path;
  const originalFilename = typeof body?.originalFilename === 'string' ? body.originalFilename.slice(0, 255) : '';

  // רק key בדיוק בתבנית ש-presign-upload יוצר ({galleryId}/{uuid}.{ext}) - לא
  // thumbs/, final/, או נתיב של גלריה אחרת.
  if (!isFreshPhotoKey(gallery.id, path) || !originalFilename) {
    return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  }

  // key שכבר רשום לתמונה אחרת - לא נוגעים בו (ובוודאי לא מוחקים אותו למטה).
  const { data: existing } = await supabase.from('photos').select('id').eq('file_path', path).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'התמונה כבר רשומה' }, { status: 409 });
  }

  const head = await headObject(path).catch(() => null);
  if (!head) {
    return NextResponse.json({ error: 'הקובץ לא נמצא באחסון' }, { status: 400 });
  }
  if (head.size > MAX_UPLOAD_BYTES) {
    await cleanup(path);
    return NextResponse.json({ error: 'הקובץ גדול מדי' }, { status: 413 });
  }

  const { data: photo, error: insertError } = await supabase
    .from('photos')
    .insert({ gallery_id: gallery.id, file_path: path, thumbnail_path: null, original_filename: originalFilename })
    .select('id')
    .single();

  if (insertError || !photo) {
    await cleanup(path);
    const message = insertError?.message ?? '';
    if (message.includes('LIMIT_PHOTOS')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: 'שמירת התמונה נכשלה' }, { status: 500 });
  }

  return NextResponse.json({ id: photo.id });
}

async function cleanup(path: string) {
  try {
    await deleteObjects([path]);
  } catch (err) {
    console.error('[photos] מחיקת קובץ יתום מ-R2 נכשלה:', path, err);
  }
}
