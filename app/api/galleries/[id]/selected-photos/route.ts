import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getPresignedDownloadUrl } from '@/lib/r2';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { mergeGiftPhotosIntoExport } from '@/lib/gifts';

// מחזיר לצלמת המחוברת שם קובץ + signed URL זמני לכל תמונה שסומנה "נבחר" בגלריה שלה.
// משמש את כפתור הקסם (התאמת שמות קבצים מקומיים) ואת ה-ZIP fallback (הורדה בפועל).
// בודקים בעלות עם לקוח השרת (session, לא service key) כי RLS כבר אוכף את זה על
// הטבלאות; signed URLs עצמם נוצרים דרך lib/r2.ts עם מפתחות R2 סודיים (ה-bucket פרטי).
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// שעה - ה-ZIP מוריד את הקבצים אחד אחרי השני, ובגלריה גדולה/חיבור איטי 10 דקות
// לא הספיקו (ה-URLs האחרונים פגו באמצע וחזרו 403). MagicButton גם יודע לבקש
// URLs טריים מה-route הזה אם בכל זאת פגו.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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
    .select('id, owner_participant_id')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (!gallery.owner_participant_id) {
    return NextResponse.json({ error: 'לגלריה הזו אין בעלים רשומה - לא ניתן לייצא' }, { status: 500 });
  }

  // רק בחירות הבעלים (שיתוף גלריה משפחתי) - זו רשימת המסירה הרשמית.
  const { data: selections } = await (gallery.owner_participant_id
    ? supabaseAdmin
        .from('selections')
        .select('photo_id, photos(file_path, original_filename)')
        .eq('gallery_id', params.id)
        .eq('participant_id', gallery.owner_participant_id)
        .eq('status', 'selected')
    : Promise.resolve({ data: [] }));

  // תמונות מתנה (lib/gifts.ts) כלולות אוטומטית במסירה - גם אם הלקוחה לא
  // סימנה אותן - כדי שהצלמת תערוך גם אותן. מסומנות isGift.
  const gifts = await fetchGiftPhotos(supabaseAdmin, [params.id]);
  const merged = mergeGiftPhotosIntoExport(
    (selections ?? [])
      .filter((s: any) => s.photos)
      .map((s: any) => ({ photoId: s.photo_id as string, filename: s.photos.original_filename as string, filePath: s.photos.file_path as string })),
    gifts.map((g) => ({ photoId: g.id, filename: g.original_filename, filePath: g.file_path }))
  );

  // ?names=1 - רק שמות קבצים (העתקת שמות לחיפוש ב-Lightroom, בדיקת התאמת
  // מסירה): בלי לחתום URL לכל תמונה, וכולל גם תמונות שהמקור שלהן כבר נמחק
  // מ-R2 - השם עדיין רלוונטי לקטלוג המקומי של הצלמת.
  if (req.nextUrl.searchParams.get('names') === '1') {
    return NextResponse.json({
      photos: merged.map((p) => ({ id: p.photoId, filename: p.filename, isGift: p.isGift })),
      missingCount: 0,
    });
  }

  const photos = await Promise.all(
    merged.map(async (p) => ({
      id: p.photoId,
      filename: p.filename,
      url: await getPresignedDownloadUrl(p.filePath, SIGNED_URL_TTL_SECONDS),
      isGift: p.isGift,
    }))
  );

  // url=null = הקובץ המקורי כבר לא קיים ב-R2 (למשל נוקה ע"י ניקוי המקור
  // האוטומטי) - לא מחזירים אותו, אבל מדווחים כמה כאלה היו כדי שהצלמת תדע
  // שה-ZIP לא שלם במקום לקבל "הורדו X" בלי הסבר.
  const available = photos.filter((p) => p.url);
  return NextResponse.json({ photos: available, missingCount: photos.length - available.length });
}
