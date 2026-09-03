import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// מחזירה לצלמת המחוברת תצוגה לקריאה בלבד של התמונות בגלריה: thumbnail + הסטטוס
// הרשמי (של הבעלים בלבד - שיתוף גלריה משפחתי, בדיוק כמו app/dashboard/galleries/page.tsx
// וה-CSV export). זה מה שקודם לא היה קיים בכלל - לחיצה על גלריה הובילה ישר
// למסך העלאה, בלי שום דרך לראות מה כבר נבחר.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

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

  const [{ data: photosData }, { data: selectionsData }] = await Promise.all([
    supabaseAdmin
      .from('photos')
      .select('id, thumbnail_path, file_path, original_filename')
      .eq('gallery_id', params.id)
      .order('created_at', { ascending: true }),
    gallery.owner_participant_id
      ? supabaseAdmin
          .from('selections')
          .select('photo_id, status, note, photographer_reply')
          .eq('gallery_id', params.id)
          .eq('participant_id', gallery.owner_participant_id)
      : Promise.resolve({ data: [] as { photo_id: string; status: string; note: string | null; photographer_reply: string | null }[] }),
  ]);

  const selectionByPhotoId = new Map((selectionsData ?? []).map((s) => [s.photo_id, s]));

  const photos = await Promise.all(
    (photosData ?? []).map(async (photo) => {
      const thumbPath = photo.thumbnail_path ?? photo.file_path;
      const { data: signed } = await supabaseAdmin.storage
        .from('gallery-photos')
        .createSignedUrl(thumbPath, SIGNED_URL_TTL_SECONDS);

      const selection = selectionByPhotoId.get(photo.id);
      return {
        id: photo.id,
        thumbnailUrl: signed?.signedUrl ?? null,
        original_filename: photo.original_filename,
        status: (selection?.status as 'maybe' | 'selected' | undefined) ?? null,
        note: selection?.note ?? null,
        photographerReply: selection?.photographer_reply ?? null,
      };
    })
  );

  return NextResponse.json({ photos });
}
