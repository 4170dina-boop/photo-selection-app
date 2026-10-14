import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteObjects } from '@/lib/r2';
import { gridThumbKey, isKeyInGallery } from '@/lib/uploadPolicy';

// מחיקת תמונה שהועלתה לגלריה (תמונת בחירה, לא תמונה סופית - לאלה יש
// ../../final-photos/[photoId]). אותו דפוס בדיוק: בדיקת בעלות, קודם שורת ה-DB
// (ה-CASCADE מוחק גם את הסימונים/ההערות של הלקוחה על התמונה), ורק אחר כך
// הקבצים ב-R2 - best-effort, כשל שם משאיר רק קבצים יתומים באחסון.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; photoId: string } }) {
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

  const { data: photo } = await supabase
    .from('photos')
    .select('id, file_path, thumbnail_path')
    .eq('id', params.photoId)
    .eq('gallery_id', params.id)
    .single();

  if (!photo) {
    return NextResponse.json({ error: 'תמונה לא נמצאה' }, { status: 404 });
  }

  const { error: deleteError } = await supabase.from('photos').delete().eq('id', photo.id);

  if (deleteError) {
    return NextResponse.json({ error: 'מחיקת התמונה נכשלה' }, { status: 500 });
  }

  // המקור, התצוגה עם סימן המים ותמונת הגריד - רק מפתחות שבאמת בתיקיית הגלריה
  const keys = Array.from(
    new Set([photo.file_path, photo.thumbnail_path, gridThumbKey(photo.thumbnail_path)].filter((key) => isKeyInGallery(params.id, key)))
  ) as string[];
  if (keys.length > 0) {
    try {
      await deleteObjects(keys);
    } catch (err) {
      console.error('R2 delete of gallery photo failed (DB row already removed)', err);
    }
  }

  return NextResponse.json({ success: true });
}
