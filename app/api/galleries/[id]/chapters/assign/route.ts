import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedGallery } from '@/lib/ownedGallery';
import { assignPhotosToChapter, parsePhotoIds } from '@/lib/chapterQueries';

// "העברה לפרק…": שיוך תמונות נבחרות לפרק, או chapterId=null = הוצאה מהפרק.
// ה-RLS על photos בודק רק gallery_id - לכן מוודאים כאן שהפרק עצמו שייך לאותה
// גלריה (אחרת אפשר היה לשייך תמונה לפרק של גלריה אחרת).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireOwnedGallery(params.id);
  if (!owned.ok) return owned.response;
  const { supabase } = owned;

  const body = await req.json().catch(() => null);
  const photoIds = parsePhotoIds(body?.photoIds);
  const chapterId: unknown = body?.chapterId;
  if (!photoIds || photoIds.length === 0 || (chapterId !== null && typeof chapterId !== 'string')) {
    return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  }

  if (chapterId !== null) {
    const { data: chapter, error } = await supabase
      .from('gallery_chapters')
      .select('id')
      .eq('id', chapterId)
      .eq('gallery_id', params.id)
      .maybeSingle();
    if (error || !chapter) return NextResponse.json({ error: 'הפרק לא נמצא' }, { status: 404 });
  }

  const result = await assignPhotosToChapter(supabase, params.id, photoIds, chapterId as string | null);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.missingSchema ? 'פרקים עוד לא זמינים - צריך להריץ את המיגרציה' : 'שיוך התמונות נכשל' },
      { status: result.missingSchema ? 409 : 500 }
    );
  }
  return NextResponse.json({ updated: result.updated });
}
