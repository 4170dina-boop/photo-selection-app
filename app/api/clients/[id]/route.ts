import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'לקוחה לא נמצאה' }, { status: 404 });
  }

  const [{ count: galleryCount }, { count: shootCount }] = await Promise.all([
    supabase.from('galleries').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
    supabase.from('shoots').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
  ]);

  if ((galleryCount ?? 0) > 0 || (shootCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `אי אפשר למחוק לקוחה שיש לה ${galleryCount ? `${galleryCount} גלריות` : ''}${galleryCount && shootCount ? ' ו-' : ''}${shootCount ? `${shootCount} צילומים` : ''} — מחקי אותם קודם` },
      { status: 409 },
    );
  }

  const { error } = await supabase.from('clients').delete().eq('id', client.id);
  if (error) {
    return NextResponse.json({ error: 'מחיקת הלקוחה נכשלה' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
