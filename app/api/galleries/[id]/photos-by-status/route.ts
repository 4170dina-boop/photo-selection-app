import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// מחזיר לצלמת המחוברת שם קובץ + סטטוס (selected/maybe/null) לכל תמונה בגלריה -
// בלי URLs, כי כפתור הקסם רק מתאים שמות קבצים מקומיים ולא מוריד תוכן מהשרת.
// משמש למיון לשלוש תיקיות (Selected/Maybe/Extras); בניגוד ל-selected-photos
// שמחזיר רק status='selected' (בשביל ה-ZIP fallback), כאן צריך את כל התמונות.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

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

  const [{ data: photosData }, { data: selectionsData }] = await Promise.all([
    supabaseAdmin.from('photos').select('id, original_filename').eq('gallery_id', params.id),
    gallery.owner_participant_id
      ? supabaseAdmin
          .from('selections')
          .select('photo_id, status')
          .eq('gallery_id', params.id)
          .eq('participant_id', gallery.owner_participant_id)
      : Promise.resolve({ data: [] as { photo_id: string; status: string }[] }),
  ]);

  const statusByPhotoId = new Map((selectionsData ?? []).map((s) => [s.photo_id, s.status]));

  const photos = (photosData ?? []).map((photo) => ({
    filename: photo.original_filename as string,
    status: (statusByPhotoId.get(photo.id) as 'maybe' | 'selected' | undefined) ?? null,
  }));

  return NextResponse.json({ photos });
}
