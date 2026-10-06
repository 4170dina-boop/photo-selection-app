import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedGallery } from '@/lib/ownedGallery';
import { MAX_CHAPTERS_PER_GALLERY, normalizeChapterName } from '@/lib/chapters';
import { assignPhotosToChapter, fetchChapters, isMissingChapterSchemaError, parsePhotoIds } from '@/lib/chapterQueries';

// פרקים בגלריה (gallery_chapters, ראו lib/chapters.ts) - רק הצלמת, עם session
// שלה: ה-RLS "photographers manage own gallery chapters" מגביל ממילא לגלריות
// שלה, ובנוסף בודקים בעלות (requireOwnedGallery). הלקוחה קוראת את הפרקים רק
// דרך app/api/gallery/[id] (service_role).
//
// GET  -> { available, chapters }   (available=false = המיגרציה עוד לא רצה)
// POST { name }                                  -> פרק חדש בסוף הרשימה
// POST { chapters: [{ name, photoIds }], replace } -> כמה פרקים בבת אחת עם שיוך
//      תמונות ("חלוקה אוטומטית לפי שעת צילום"). replace=true מוחק קודם את כל
//      הפרקים הקיימים (התמונות עצמן נשארות - chapter_id מתאפס ע"י ה-FK).

const MISSING_SCHEMA_RESPONSE = {
  error: 'פרקים עוד לא זמינים - צריך להריץ את המיגרציה ב-supabase/schema.sql',
  missingSchema: true,
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireOwnedGallery(params.id);
  if (!owned.ok) return owned.response;
  const result = await fetchChapters(owned.supabase, params.id);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireOwnedGallery(params.id);
  if (!owned.ok) return owned.response;
  const { supabase } = owned;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const existing = await fetchChapters(supabase, params.id);
  if (!existing.available) return NextResponse.json(MISSING_SCHEMA_RESPONSE, { status: 409 });

  // ---- פרק בודד ----
  if (!Array.isArray(body.chapters)) {
    const name = normalizeChapterName(body.name);
    if (!name) return NextResponse.json({ error: 'שם הפרק לא תקין' }, { status: 400 });
    if (existing.chapters.length >= MAX_CHAPTERS_PER_GALLERY) {
      return NextResponse.json({ error: `אפשר עד ${MAX_CHAPTERS_PER_GALLERY} פרקים בגלריה` }, { status: 400 });
    }
    const sort = existing.chapters.reduce((max, c) => Math.max(max, c.sort), 0) + 1;
    const { data, error } = await supabase
      .from('gallery_chapters')
      .insert({ gallery_id: params.id, name, sort })
      .select('id, name, sort')
      .single();
    if (error || !data) {
      if (isMissingChapterSchemaError(error)) return NextResponse.json(MISSING_SCHEMA_RESPONSE, { status: 409 });
      return NextResponse.json({ error: 'יצירת הפרק נכשלה' }, { status: 500 });
    }
    return NextResponse.json({ chapter: data });
  }

  // ---- כמה פרקים בבת אחת ----
  const replace = body.replace === true;
  const items: { name: string; photoIds: string[] }[] = [];
  for (const raw of body.chapters as unknown[]) {
    const name = normalizeChapterName((raw as any)?.name);
    const photoIds = parsePhotoIds((raw as any)?.photoIds ?? []);
    if (!name || !photoIds) return NextResponse.json({ error: 'פרטי הפרקים לא תקינים' }, { status: 400 });
    items.push({ name, photoIds });
  }
  if (items.length === 0) return NextResponse.json({ error: 'אין פרקים ליצירה' }, { status: 400 });
  const keptCount = replace ? 0 : existing.chapters.length;
  if (keptCount + items.length > MAX_CHAPTERS_PER_GALLERY) {
    return NextResponse.json({ error: `אפשר עד ${MAX_CHAPTERS_PER_GALLERY} פרקים בגלריה` }, { status: 400 });
  }

  if (replace && existing.chapters.length > 0) {
    const { error } = await supabase.from('gallery_chapters').delete().eq('gallery_id', params.id);
    if (error) return NextResponse.json({ error: 'מחיקת הפרקים הקיימים נכשלה' }, { status: 500 });
  }

  const baseSort = replace ? 0 : existing.chapters.reduce((max, c) => Math.max(max, c.sort), 0);
  const { data: created, error: insertError } = await supabase
    .from('gallery_chapters')
    .insert(items.map((item, i) => ({ gallery_id: params.id, name: item.name, sort: baseSort + i + 1 })))
    .select('id, name, sort');
  if (insertError || !created || created.length !== items.length) {
    return NextResponse.json({ error: 'יצירת הפרקים נכשלה' }, { status: 500 });
  }

  // insert מרובה מחזיר את השורות בסדר שנשלחו - משייכים לפי sort כדי לא לסמוך על זה
  const bySort = new Map<number, { id: string; name: string; sort: number }>(created.map((c: any) => [c.sort, c]));
  for (let i = 0; i < items.length; i++) {
    const chapter = bySort.get(baseSort + i + 1);
    if (!chapter || items[i].photoIds.length === 0) continue;
    const assigned = await assignPhotosToChapter(supabase, params.id, items[i].photoIds, chapter.id);
    if (!assigned.ok) return NextResponse.json({ error: 'שיוך התמונות לפרקים נכשל' }, { status: 500 });
  }

  const after = await fetchChapters(supabase, params.id);
  return NextResponse.json({ chapters: after.chapters });
}
