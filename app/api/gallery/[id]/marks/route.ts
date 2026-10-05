import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { resolveGalleryViewAccess } from '@/lib/galleryAccess';
import { buildAllMarks } from '@/lib/choosingTogether';

// service_role - בצד שרת בלבד, כמו app/api/gallery/[id]/route.ts.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// "בוחרים ביחד": endpoint קליל לסקר החי של הגלריה (כל ~20 שניות כשהטאב
// גלוי) - מחזיר רק את המשתתפים ואת הסימונים של כולם (allMarks), בלי URLs
// חתומים של תמונות, בלי עדכון סטטוס ובלי מונה צפיות. אותן בדיקות session
// ותוקף כמו ה-route הראשי של הגלריה.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);
  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, status, expires_at, delivered_at')
    .eq('id', galleryId)
    .single();
  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const { count: deliveredCount } = await supabaseAdmin
    .from('delivered_photos')
    .select('id', { count: 'exact', head: true })
    .eq('gallery_id', galleryId);
  const access = resolveGalleryViewAccess(gallery, (deliveredCount ?? 0) > 0);
  if (!access.ok) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  // עוד לא זוהה/תה (ראו identify/route.ts) - כמו ב-route הראשי, לא חושפים סימונים
  if (!session.participantId) {
    return NextResponse.json({ error: 'צריך לזהות את עצמך קודם' }, { status: 428 });
  }

  const [{ data: selectionsData, error: selError }, { data: participantsData, error: partError }] = await Promise.all([
    supabaseAdmin.from('selections').select('photo_id, participant_id, status').eq('gallery_id', galleryId),
    supabaseAdmin.from('gallery_participants').select('id, display_name, is_owner').eq('gallery_id', galleryId),
  ]);
  if (selError || partError) {
    return NextResponse.json({ error: 'שגיאה בטעינת הסימונים' }, { status: 500 });
  }

  const participants = (participantsData ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
    isOwner: p.is_owner,
  }));

  return NextResponse.json(
    { participants, allMarks: buildAllMarks(selectionsData ?? [], participants) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
