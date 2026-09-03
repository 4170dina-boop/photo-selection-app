import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// מחזיר לצלמת המחוברת שם קובץ + signed URL זמני לכל תמונה שסומנה "נבחר" בגלריה שלה.
// משמש את כפתור הקסם (התאמת שמות קבצים מקומיים) ואת ה-ZIP fallback (הורדה בפועל).
// בודקים בעלות עם לקוח השרת (session, לא service key) כי RLS כבר אוכף את זה על
// הטבלאות; signed URLs עצמם חייבים service key כי ה-bucket פרטי (ראו app/api/gallery/[id]/route.ts).
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 דקות - מספיק להורדת ZIP, לא נשאר תקף לנצח

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

  const photos = await Promise.all(
    (selections ?? [])
      .filter((s: any) => s.photos)
      .map(async (s: any) => {
        const { data: signed } = await supabaseAdmin.storage
          .from('gallery-photos')
          .createSignedUrl(s.photos.file_path, SIGNED_URL_TTL_SECONDS);

        return { filename: s.photos.original_filename as string, url: signed?.signedUrl ?? null };
      })
  );

  return NextResponse.json({ photos: photos.filter((p) => p.url) });
}
