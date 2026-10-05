import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteObjects } from '@/lib/r2';
import { isKeyInGallery } from '@/lib/downloadNames';

// מחליף את handleDeleteFinalPhoto ב-app/dashboard/galleries/[id]/edit/page.tsx.
// כמו ב-GET final-photos/route.ts - אין RLS ב-R2, אז מחיקת הקובץ עצמו חייבת
// לעבור route ייעודי בצד שרת אחרי בדיקת בעלות.
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
    .from('delivered_photos')
    .select('id, file_path')
    .eq('id', params.photoId)
    .eq('gallery_id', params.id)
    .single();

  if (!photo) {
    return NextResponse.json({ error: 'תמונה לא נמצאה' }, { status: 404 });
  }

  // קודם שורת ה-DB, אחר כך הקובץ: אם מחיקת ה-DB נכשלת, הקובץ נשאר שלם והתמונה
  // עדיין עובדת. בסדר ההפוך, כשל ב-DB השאיר שורה שמצביעה על קובץ שכבר לא קיים.
  const { error: deleteError } = await supabase.from('delivered_photos').delete().eq('id', photo.id);

  if (deleteError) {
    return NextResponse.json({ error: 'מחיקת התמונה נכשלה' }, { status: 500 });
  }

  // מחיקה מ-R2 היא best-effort - השורה כבר נמחקה, אז כשל כאן משאיר רק קובץ
  // יתום באחסון (לא שבור מבחינת הצלמת). file_path נכתב מצד הלקוח, אז מוחקים
  // רק מפתח שבאמת שייך לתיקייה של הגלריה הזו.
  if (isKeyInGallery(photo.file_path, params.id)) {
    try {
      await deleteObjects([photo.file_path]);
    } catch (err) {
      console.error('R2 delete of final photo failed (DB row already removed)', err);
    }
  } else {
    console.error('Refusing to delete R2 key outside gallery prefix', { galleryId: params.id, key: photo.file_path });
  }

  return NextResponse.json({ success: true });
}
