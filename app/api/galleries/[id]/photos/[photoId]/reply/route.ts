import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// תגובת הצלמת להערה שהלקוחה כתבה על תמונה - רק על הבחירה הרשמית (של הבעלים,
// שיתוף גלריה משפחתי) בדיוק כמו app/api/galleries/[id]/review/route.ts שכבר
// מציג לצלמת רק את הערות הבעלים. רץ עם session הצלם (לא service key) - ה-RLS
// "photographers see own selections" (for all) כבר מרשה עדכון על הגלריה שלה.
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
    .select('id, owner_participant_id')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }
  if (!gallery.owner_participant_id) {
    return NextResponse.json({ error: 'לגלריה הזו אין בעלים רשומה' }, { status: 500 });
  }

  let body: { reply?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const reply = (body.reply ?? '').trim();

  const { data: selection } = await supabase
    .from('selections')
    .select('id')
    .eq('gallery_id', params.id)
    .eq('photo_id', params.photoId)
    .eq('participant_id', gallery.owner_participant_id)
    .single();

  if (!selection) {
    return NextResponse.json({ error: 'אי אפשר להגיב לתמונה שהלקוחה לא סימנה' }, { status: 400 });
  }

  const { error } = await supabase
    .from('selections')
    .update({ photographer_reply: reply || null, photographer_reply_at: reply ? new Date().toISOString() : null })
    .eq('id', selection.id);

  if (error) {
    return NextResponse.json({ error: 'שמירת התגובה נכשלה' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
