import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { checkGalleryWritable } from '@/lib/galleryAccess';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// תקרה בצד שרת - גם אם ה-UI מגביל, בקשה ישירה לא אמורה להכניס טקסט בלי גבול.
const NOTE_MAX_LENGTH = 1000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);
  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }
  if (!session.participantId) {
    return NextResponse.json({ error: 'צריך לזהות את עצמך קודם' }, { status: 428 });
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
  if (!photoId || (body.note != null && typeof body.note !== 'string')) {
    return NextResponse.json({ error: 'חסרים פרטים' }, { status: 400 });
  }
  const note = (body.note ?? '').trim();
  if (note.length > NOTE_MAX_LENGTH) {
    return NextResponse.json({ error: `ההערה ארוכה מדי (עד ${NOTE_MAX_LENGTH} תווים)` }, { status: 400 });
  }

  const { data: selection } = await supabaseAdmin
    .from('selections')
    .select('id')
    .eq('gallery_id', galleryId)
    .eq('photo_id', photoId)
    .eq('participant_id', session.participantId)
    .single();

  if (!selection) {
    return NextResponse.json({ error: 'אי אפשר להוסיף הערה לתמונה שלא סומנה' }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('selections')
    .update({ note: note || null })
    .eq('gallery_id', galleryId)
    .eq('photo_id', photoId)
    .eq('participant_id', session.participantId);

  if (updateError) {
    console.error('[note] שמירת ההערה נכשלה:', updateError);
    return NextResponse.json({ error: 'שמירת ההערה נכשלה, נסי שוב' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
