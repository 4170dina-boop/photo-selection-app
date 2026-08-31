import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { checkGalleryWritable } from '@/lib/galleryAccess';
import { sendQuotaReachedEmail } from '@/lib/email';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);

  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  // שיתוף גלריה משפחתי: אי אפשר לסמן בחירה לפני שידוע מי בפועל מסמן (ראו
  // app/api/gallery/[id]/identify/route.ts) - כל selection שייכת ל-participant ספציפי.
  if (!session.participantId) {
    return NextResponse.json({ error: 'צריך לזהות את עצמך קודם' }, { status: 428 });
  }

  const writable = await checkGalleryWritable(supabaseAdmin, galleryId);
  if (!writable.ok) {
    return NextResponse.json({ error: writable.error }, { status: writable.status });
  }

  let body: { photoId?: string; status?: 'maybe' | 'selected' | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { photoId, status } = body;
  if (!photoId || (status !== 'maybe' && status !== 'selected' && status !== null)) {
    return NextResponse.json({ error: 'חסרים פרטים' }, { status: 400 });
  }

  // מוודאים שהתמונה שייכת לגלריה הזו, כדי שלא יהיה אפשר לעדכן selection של גלריה אחרת
  const { data: photo } = await supabaseAdmin
    .from('photos')
    .select('id')
    .eq('id', photoId)
    .eq('gallery_id', galleryId)
    .single();

  if (!photo) {
    return NextResponse.json({ error: 'תמונה לא נמצאה' }, { status: 404 });
  }

  if (status === null) {
    await supabaseAdmin
      .from('selections')
      .delete()
      .eq('gallery_id', galleryId)
      .eq('photo_id', photoId)
      .eq('participant_id', session.participantId);
  } else {
    await supabaseAdmin.from('selections').upsert(
      { gallery_id: galleryId, photo_id: photoId, participant_id: session.participantId, status },
      { onConflict: 'gallery_id,photo_id,participant_id' }
    );
  }

  // התראה לצלמת ברגע שהבעלים (לא בן משפחה אחר) מגיעה בדיוק למכסת החבילה -
  // best-effort, לא חוסמת את התשובה ללקוחה. בודקים "בדיוק" (לא ≥) כדי שהמייל
  // ייצא פעם אחת בלבד ולא בכל בחירה נוספת אחרי זה.
  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('owner_participant_id, photographer_id, clients(full_name)')
    .eq('id', galleryId)
    .single();

  if (status === 'selected' && gallery?.owner_participant_id === session.participantId) {
    try {
      const { data: pkg } = await supabaseAdmin
        .from('packages')
        .select('included_photos')
        .eq('gallery_id', galleryId)
        .single();

      if (pkg && pkg.included_photos > 0) {
        const { count } = await supabaseAdmin
          .from('selections')
          .select('id', { count: 'exact', head: true })
          .eq('gallery_id', galleryId)
          .eq('participant_id', session.participantId)
          .eq('status', 'selected');

        if (count === pkg.included_photos) {
          const { data: photographer } = await supabaseAdmin
            .from('photographers')
            .select('auth_user_id')
            .eq('id', gallery.photographer_id)
            .single();

          if (photographer?.auth_user_id) {
            const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(photographer.auth_user_id);
            const photographerEmail = authUser?.user?.email;
            const clientName = (gallery as any).clients?.full_name ?? 'לקוחה';

            if (photographerEmail) {
              const siteUrl = req.nextUrl.origin;
              await sendQuotaReachedEmail({
                to: photographerEmail,
                clientName,
                includedPhotos: pkg.included_photos,
                dashboardUrl: `${siteUrl}/dashboard/galleries/${galleryId}/edit`,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[selection] שליחת התראת מכסה נכשלה:', err);
    }
  }

  return NextResponse.json({ success: true });
}
