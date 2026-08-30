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

  let body: { photoId?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { photoId } = body;
  const note = (body.note ?? '').trim();
  if (!photoId) {
    return NextResponse.json({ error: 'חסרים פרטים' }, { status: 400 });
  }

  const { data: selection } = await supabaseAdmin
    .from('selections')
    .select('id')
    .eq('gallery_id', galleryId)
    .eq('photo_id', photoId)
    .single();

  if (!selection) {
    return NextResponse.json({ error: 'אי אפשר להוסיף הערה לתמונה שלא סומנה' }, { status: 400 });
  }

  await supabaseAdmin
    .from('selections')
    .update({ note: note || null })
    .eq('gallery_id', galleryId)
    .eq('photo_id', photoId);

  return NextResponse.json({ success: true });
}
