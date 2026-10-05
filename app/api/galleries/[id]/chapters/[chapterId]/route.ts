import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedGallery } from '@/lib/ownedGallery';
import { normalizeChapterName } from '@/lib/chapters';

// שינוי שם / סדר של פרק, ומחיקה (התמונות נשארות בגלריה - chapter_id מתאפס
// ע"י ה-FK "on delete set null"). ראו app/api/galleries/[id]/chapters/route.ts.

export async function PATCH(req: NextRequest, { params }: { params: { id: string; chapterId: string } }) {
  const owned = await requireOwnedGallery(params.id);
  if (!owned.ok) return owned.response;

  const body = await req.json().catch(() => null);
  const update: { name?: string; sort?: number } = {};
  if (body?.name !== undefined) {
    const name = normalizeChapterName(body.name);
    if (!name) return NextResponse.json({ error: 'שם הפרק לא תקין' }, { status: 400 });
    update.name = name;
  }
  if (body?.sort !== undefined) {
    if (!Number.isInteger(body.sort) || Math.abs(body.sort) > 100000) {
      return NextResponse.json({ error: 'סדר לא תקין' }, { status: 400 });
    }
    update.sort = body.sort;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'אין מה לעדכן' }, { status: 400 });

  const { data, error } = await owned.supabase
    .from('gallery_chapters')
    .update(update)
    .eq('id', params.chapterId)
    .eq('gallery_id', params.id)
    .select('id, name, sort')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'עדכון הפרק נכשל' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'הפרק לא נמצא' }, { status: 404 });
  return NextResponse.json({ chapter: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; chapterId: string } }) {
  const owned = await requireOwnedGallery(params.id);
  if (!owned.ok) return owned.response;

  const { data, error } = await owned.supabase
    .from('gallery_chapters')
    .delete()
    .eq('id', params.chapterId)
    .eq('gallery_id', params.id)
    .select('id');
  if (error) return NextResponse.json({ error: 'מחיקת הפרק נכשלה' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'הפרק לא נמצא' }, { status: 404 });
  return NextResponse.json({ success: true });
}
