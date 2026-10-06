import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isMissingTemplatesTableError,
  MAX_TEMPLATES_PER_PHOTOGRAPHER,
  normalizeTemplateData,
  parseTemplateData,
  parseTemplateName,
  type GalleryTemplate,
} from '@/lib/galleryTemplates';

// תבניות גלריה של הצלמת המחוברת (טבלת gallery_templates). רץ עם session
// הצלמת - ה-RLS מגביל לשורות שלה; photographer_id נקבע כאן מה-session ולא
// מגוף הבקשה. טבלה חסרה (המיגרציה לא רצה) -> available: false, והממשק מוסתר.

async function loadPhotographer(supabase: ReturnType<typeof createClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: 'לא מחוברת' }, { status: 401 }) };
  const { data: photographer } = await supabase.from('photographers').select('id').eq('auth_user_id', user.id).single();
  if (!photographer) return { response: NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 }) };
  return { photographerId: photographer.id as string };
}

export async function GET() {
  const supabase = createClient();
  const owner = await loadPhotographer(supabase);
  if ('response' in owner) return owner.response;

  const { data, error } = await supabase
    .from('gallery_templates')
    .select('id, name, data, created_at')
    .eq('photographer_id', owner.photographerId)
    .order('name', { ascending: true });

  if (error) {
    if (isMissingTemplatesTableError(error)) return NextResponse.json({ available: false, templates: [] });
    return NextResponse.json({ error: 'טעינת התבניות נכשלה' }, { status: 500 });
  }

  const templates: GalleryTemplate[] = [];
  for (const row of data ?? []) {
    const normalized = normalizeTemplateData(row.data);
    if (normalized) templates.push({ id: row.id, name: row.name, data: normalized, created_at: row.created_at });
  }
  return NextResponse.json({ available: true, templates });
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const owner = await loadPhotographer(supabase);
  if ('response' in owner) return owner.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });

  const name = parseTemplateName(body.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
  const data = parseTemplateData(body.data);
  if (!data.ok) return NextResponse.json({ error: data.error }, { status: 400 });

  const { count, error: countError } = await supabase
    .from('gallery_templates')
    .select('id', { count: 'exact', head: true })
    .eq('photographer_id', owner.photographerId);
  if (countError) {
    if (isMissingTemplatesTableError(countError)) {
      return NextResponse.json({ error: 'תבניות עוד לא הופעלו (צריך להריץ את המיגרציה ב-supabase/schema.sql)' }, { status: 503 });
    }
    return NextResponse.json({ error: 'שמירת התבנית נכשלה' }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_TEMPLATES_PER_PHOTOGRAPHER) {
    return NextResponse.json({ error: `אפשר לשמור עד ${MAX_TEMPLATES_PER_PHOTOGRAPHER} תבניות - מחקי תבנית ישנה קודם` }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from('gallery_templates')
    .insert({ photographer_id: owner.photographerId, name: name.value, data: data.value })
    .select('id, name, data, created_at')
    .single();

  if (error || !row) {
    if (error?.code === '23505') return NextResponse.json({ error: 'כבר יש תבנית בשם הזה' }, { status: 409 });
    return NextResponse.json({ error: 'שמירת התבנית נכשלה' }, { status: 500 });
  }
  return NextResponse.json({ template: { id: row.id, name: row.name, data: data.value, created_at: row.created_at } });
}
