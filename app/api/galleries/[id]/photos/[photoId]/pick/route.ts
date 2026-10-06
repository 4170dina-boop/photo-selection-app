import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isMissingColumnError } from '@/lib/gender';

// סימון/ביטול "⭐ המלצת הצלמת" (photos.photographer_pick, ראו lib/pickQueries.ts) -
// רק הצלמת, עם session הצלם, אותו דפוס כמו ../gift/route.ts. לא משפיע על
// חיוב או על הבחירה, ולכן מותר בכל שלב של הגלריה.
export async function POST(req: NextRequest, { params }: { params: { id: string; photoId: string } }) {
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
    .select('id')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  let body: { isPick?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  if (typeof body.isPick !== 'boolean') {
    return NextResponse.json({ error: 'חסרים פרטים' }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from('photos')
    .update({ photographer_pick: body.isPick })
    .eq('id', params.photoId)
    .eq('gallery_id', params.id)
    .select('id, photographer_pick')
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json({ error: 'צריך להריץ קודם את ה-SQL של "המלצות הצלמת" ב-Supabase' }, { status: 409 });
    }
    return NextResponse.json({ error: 'שמירת ההמלצה נכשלה' }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'תמונה לא נמצאה' }, { status: 404 });
  }

  return NextResponse.json({ success: true, isPick: updated.photographer_pick });
}
