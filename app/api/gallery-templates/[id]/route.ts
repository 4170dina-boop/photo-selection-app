import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeTemplateData, parseTemplateData, parseTemplateName } from '@/lib/galleryTemplates';

// שינוי שם/נתונים ומחיקה של תבנית גלריה אחת - כמו app/api/gallery-templates:
// session הצלמת + RLS, ובנוסף סינון מפורש לפי photographer_id.

async function loadPhotographerId(supabase: ReturnType<typeof createClient>): Promise<string | NextResponse> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  const { data: photographer } = await supabase.from('photographers').select('id').eq('auth_user_id', user.id).single();
  if (!photographer) return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  return photographer.id as string;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const photographerId = await loadPhotographerId(supabase);
  if (typeof photographerId !== 'string') return photographerId;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });

  const update: { name?: string; data?: unknown } = {};
  if (body.name !== undefined) {
    const name = parseTemplateName(body.name);
    if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
    update.name = name.value;
  }
  if (body.data !== undefined) {
    const data = parseTemplateData(body.data);
    if (!data.ok) return NextResponse.json({ error: data.error }, { status: 400 });
    update.data = data.value;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'אין מה לעדכן' }, { status: 400 });

  const { data: row, error } = await supabase
    .from('gallery_templates')
    .update(update)
    .eq('id', params.id)
    .eq('photographer_id', photographerId)
    .select('id, name, data, created_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'כבר יש תבנית בשם הזה' }, { status: 409 });
    return NextResponse.json({ error: 'עדכון התבנית נכשל' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'התבנית לא נמצאה' }, { status: 404 });
  return NextResponse.json({ template: { id: row.id, name: row.name, data: normalizeTemplateData(row.data), created_at: row.created_at } });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const photographerId = await loadPhotographerId(supabase);
  if (typeof photographerId !== 'string') return photographerId;

  const { data, error } = await supabase
    .from('gallery_templates')
    .delete()
    .eq('id', params.id)
    .eq('photographer_id', photographerId)
    .select('id');

  if (error) return NextResponse.json({ error: 'מחיקת התבנית נכשלה' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'התבנית לא נמצאה' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
