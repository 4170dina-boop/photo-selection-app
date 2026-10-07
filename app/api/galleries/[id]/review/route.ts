import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getPresignedDownloadUrl } from '@/lib/r2';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { fetchPickedPhotoIds } from '@/lib/pickQueries';
import { gridThumbKey, hasWatermarkedThumbnail, needsGridThumbBackfill } from '@/lib/uploadPolicy';
import { fetchPhotoNavFields } from '@/lib/chapterQueries';
import { stablePhotoUrl } from '@/lib/stablePhotoUrl';

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
      .select('id, thumbnail_path, file_path, original_filename, created_at')
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
  // תמונות מתנה (lib/gifts.ts) - שאילתה נפרדת ו-best-effort, כדי שהסקירה לא
  // תיפול אם המיגרציה של is_gift עוד לא רצה.
  const giftById = new Map((await fetchGiftPhotos(supabaseAdmin, [params.id])).map((g) => [g.id, g]));
  const picks = await fetchPickedPhotoIds(supabaseAdmin, params.id);
  // פרק / שעת צילום / חתימת דמיון (lib/chapterQueries.ts) - אותו דפוס best-effort.
  // navAvailable=false = המיגרציה של הפרקים לא רצה: אין השלמת phash ואין ממשק פרקים.
  const nav = await fetchPhotoNavFields(supabaseAdmin, params.id);

  const photos = await Promise.all(
    (photosData ?? []).map(async (photo) => {
      // זה מסך של הצלמת (לא של הלקוחה) - מותר ליפול חזרה למקור כשאין עדיין
      // thumbnail. needsProcessing מסמן לדף ההעלאה להפעיל עיבוד מחדש, כי עד
      // אז התמונה מוסתרת מהלקוחה (ראו app/api/gallery/[id]/route.ts).
      const needsProcessing = !hasWatermarkedThumbnail(photo);
      // אריח בגריד - תמונת הגריד הקטנה אם כבר קיימת (ראו gridThumbKey), אחרת התצוגה הגדולה.
      // תמונה מעובדת -> אותה כתובת קבועה שהלקוחה מקבלת (lib/stablePhotoUrl.ts),
      // כך שכל צפייה של הצלמת כאן כבר "מכינה" את התמונה מול סינון האינטרנט.
      const thumbnailUrl = needsProcessing
        ? await getPresignedDownloadUrl(photo.file_path, SIGNED_URL_TTL_SECONDS)
        : stablePhotoUrl(params.id, photo.id, 'grid');

      const selection = selectionByPhotoId.get(photo.id);
      return {
        id: photo.id,
        thumbnailUrl,
        needsProcessing,
        // תמונה ישנה בלי תמונת גריד קטנה - דף ההעלאה משלים אותה ברקע (/process?mode=grid)
        needsGridThumb: needsGridThumbBackfill(photo),
        createdAt: photo.created_at ?? null,
        original_filename: photo.original_filename,
        status: (selection?.status as 'maybe' | 'selected' | undefined) ?? null,
        note: selection?.note ?? null,
        photographerReply: selection?.photographer_reply ?? null,
        isGift: giftById.has(photo.id),
        giftMessage: giftById.get(photo.id)?.gift_message ?? null,
        isPick: picks.ids.has(photo.id),
        chapterId: nav.byPhoto.get(photo.id)?.chapterId ?? null,
        takenAt: nav.byPhoto.get(photo.id)?.takenAt ?? null,
        // יש תמונת גריד אבל עוד אין חתימת דמיון - דף ההעלאה משלים ברקע (/process?mode=phash)
        needsPhash:
          nav.available && !needsProcessing && !!gridThumbKey(photo.thumbnail_path) && !nav.byPhoto.get(photo.id)?.phash,
      };
    })
  );

  return NextResponse.json({ photos, navAvailable: nav.available });
}
