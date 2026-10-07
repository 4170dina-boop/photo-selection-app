import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { requireGallerySession } from '@/lib/gallerySession';
import { loadGalleryViewAccess } from '@/lib/galleryAccess';
import { downloadToBuffer } from '@/lib/r2';
import { isPhotoVariant, photoKeysForVariant } from '@/lib/stablePhotoUrl';

// מגיש תמונת תצוגה (עם סימן מים) בכתובת קבועה - ראו lib/stablePhotoUrl.ts למה
// זה חשוב לסינוני אינטרנט. מותר ללקוחה עם עוגיית גלריה תקפה (ובגלריה שעוד
// פתוחה לצפייה, אותו כלל כמו app/api/gallery/[id]/route.ts), או לצלמת שהגלריה
// שלה - בשביל הבדיקה המוקדמת מול הסינון (app/dashboard/galleries/[id]/filter-check).
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// private: רק הדפדפן שומר עותק, לא שרתי ביניים - הקובץ דורש הרשאה.
const CACHE_HEADER = 'private, max-age=604800';

async function isOwningPhotographer(galleryId: string, photographerId: string | null): Promise<boolean> {
  if (!photographerId) return false;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: photographer } = await supabaseAdmin
    .from('photographers')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return !!photographer && photographer.id === photographerId;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; photoId: string; variant: string } }
) {
  const { id: galleryId, photoId, variant } = params;
  if (!isPhotoVariant(variant)) {
    return NextResponse.json({ error: 'גרסה לא מוכרת' }, { status: 400 });
  }

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('id, status, expires_at, delivered_at, photographer_id')
    .eq('id', galleryId)
    .maybeSingle();
  if (!gallery) {
    return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  }

  const session = requireGallerySession(req, galleryId);
  if (session) {
    const access = await loadGalleryViewAccess(supabaseAdmin, galleryId, gallery);
    if (!access.ok) return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  } else if (!(await isOwningPhotographer(galleryId, gallery.photographer_id))) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const { data: photo } = await supabaseAdmin
    .from('photos')
    .select('file_path, thumbnail_path')
    .eq('id', photoId)
    .eq('gallery_id', galleryId)
    .maybeSingle();
  if (!photo) {
    return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  }

  for (const key of photoKeysForVariant(galleryId, photo, variant)) {
    const buffer = await downloadToBuffer(key);
    if (!buffer) continue;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(buffer.length),
        'Cache-Control': CACHE_HEADER,
      },
    });
  }
  return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
}
