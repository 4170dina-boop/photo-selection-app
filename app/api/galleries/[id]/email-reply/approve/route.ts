import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const supabase = createServerClient();

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

  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('id, owner_participant_id')
    .eq('id', galleryId)
    .eq('photographer_id', photographer.id)
    .single();

  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (!gallery.owner_participant_id) {
    return NextResponse.json({ error: 'לגלריה הזו אין לקוחה ראשית מאומתת' }, { status: 400 });
  }

  let body: { selectedPhotoIds?: unknown; selectedNumbers?: unknown; approved?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף הבקשה לא תקין' }, { status: 400 });
  }

  const selectedPhotoIds = Array.isArray(body.selectedPhotoIds)
    ? body.selectedPhotoIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  let selectedNumbers: number[] = [];
  if (Array.isArray(body.selectedNumbers)) {
    selectedNumbers = body.selectedNumbers
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1)
      .map((n) => Math.floor(n));
  }

  if (!body.approved && body.approved !== true) {
    return NextResponse.json({ error: 'חסר אישור סופי' }, { status: 400 });
  }

  if (selectedPhotoIds.length === 0 && selectedNumbers.length === 0) {
    return NextResponse.json({ error: 'לא נבחרו תמונות' }, { status: 400 });
  }

  const { data: photos, error: photosError } = await supabaseAdmin
    .from('photos')
    .select('id')
    .eq('gallery_id', galleryId)
    .order('created_at', { ascending: true });

  if (photosError || !photos) {
    return NextResponse.json({ error: 'לא ניתן לטעון את התמונות של הגלריה' }, { status: 500 });
  }

  const finalPhotoIds = new Set<string>();
  for (const id of selectedPhotoIds) finalPhotoIds.add(id);
  if (selectedNumbers.length > 0) {
    for (const n of selectedNumbers) {
      const photo = photos[n - 1];
      if (photo?.id) finalPhotoIds.add(photo.id);
    }
  }

  const validIds = [...finalPhotoIds];
  const { error: deleteError } = await supabaseAdmin
    .from('selections')
    .delete()
    .eq('gallery_id', galleryId)
    .eq('participant_id', gallery.owner_participant_id);

  if (deleteError) {
    return NextResponse.json({ error: 'נכשל לנקות בחירות קיימות' }, { status: 500 });
  }

  if (validIds.length > 0) {
    const rows = validIds.map((photoId) => ({
      gallery_id: galleryId,
      photo_id: photoId,
      participant_id: gallery.owner_participant_id,
      status: 'selected' as const,
    }));

    const { error: upsertError } = await supabaseAdmin.from('selections').upsert(rows, {
      onConflict: 'gallery_id,photo_id,participant_id',
    });

    if (upsertError) {
      return NextResponse.json({ error: 'נכשל לשמור את הבחירה המאושרת' }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    approvedCount: validIds.length,
    totalPhotos: photos.length,
  });
}
