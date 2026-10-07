import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { headObject } from '@/lib/r2';
import { fetchAllPages } from '@/lib/fetchAllPages';
import { hasWatermarkedThumbnail } from '@/lib/uploadPolicy';
import { isPhotoVariant, photoKeysForVariant, stablePhotoUrl, type PhotoVariant } from '@/lib/stablePhotoUrl';

// "הכנה לסינון" (app/dashboard/galleries/[id]/filter-check): מחזיר לצלמת את
// הכתובות הקבועות של כל תמונות הגלריה, יחד עם הגודל המדויק של כל קובץ. הדף
// טוען כל כתובת דרך החיבור של הצלמת (שעובר בעצמו דרך הסינון) ומשווה את הגודל
// שהתקבל לגודל האמיתי: אותו גודל = הסינון כבר העביר את התמונה; גודל אחר או
// שגיאה = הסינון עוד מחזיק אותה. ככה התמונות נשלחות לבדיקה לפני שהלקוחה נכנסת.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const HEAD_CONCURRENCY = 8;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const variantParam = req.nextUrl.searchParams.get('variant') ?? 'grid';
  const variant: PhotoVariant = isPhotoVariant(variantParam) ? variantParam : 'grid';

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });

  const { data: photographer } = await supabase.from('photographers').select('id').eq('auth_user_id', user.id).single();
  if (!photographer) return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, clients(full_name)')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();
  if (!gallery) return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });

  let rows: { id: string; file_path: string; thumbnail_path: string | null }[];
  try {
    rows = await fetchAllPages<any>((from, to) =>
      supabaseAdmin
        .from('photos')
        .select('id, file_path, thumbnail_path')
        .eq('gallery_id', params.id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch {
    return NextResponse.json({ error: 'טעינת התמונות נכשלה' }, { status: 500 });
  }

  const processed = rows.filter(hasWatermarkedThumbnail);
  const photos: { id: string; number: number; url: string; expectedBytes: number | null }[] = [];
  for (let i = 0; i < processed.length; i += HEAD_CONCURRENCY) {
    const chunk = processed.slice(i, i + HEAD_CONCURRENCY);
    const sized = await Promise.all(
      chunk.map(async (photo, j) => {
        let expectedBytes: number | null = null;
        for (const key of photoKeysForVariant(params.id, photo, variant)) {
          const head = await headObject(key);
          if (head) {
            expectedBytes = head.size;
            break;
          }
        }
        return { id: photo.id, number: i + j + 1, url: stablePhotoUrl(params.id, photo.id, variant), expectedBytes };
      })
    );
    photos.push(...sized);
  }

  return NextResponse.json({ clientName: (gallery as any).clients?.full_name ?? null, variant, photos });
}
