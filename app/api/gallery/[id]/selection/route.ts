import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { checkGalleryWritable } from '@/lib/galleryAccess';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  if (!requireGallerySession(req, galleryId)) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
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
    await supabaseAdmin.from('selections').delete().eq('gallery_id', galleryId).eq('photo_id', photoId);
  } else {
    await supabaseAdmin
      .from('selections')
      .upsert({ gallery_id: galleryId, photo_id: photoId, status }, { onConflict: 'gallery_id,photo_id' });
  }

  return NextResponse.json({ success: true });
}
