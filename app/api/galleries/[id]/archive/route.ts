import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { nextToggleTimestamp, readToggleValue } from '@/lib/toggleValue';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
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

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, archived_at')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const newArchivedAt = nextToggleTimestamp(gallery.archived_at, await readToggleValue(req), new Date().toISOString());

  const { error } = await supabase
    .from('galleries')
    .update({ archived_at: newArchivedAt })
    .eq('id', gallery.id);

  if (error) {
    return NextResponse.json({ error: 'עדכון ארכיון הגלריה נכשל' }, { status: 500 });
  }

  return NextResponse.json({ archivedAt: newArchivedAt });
}
