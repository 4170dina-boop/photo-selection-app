import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// הופכת (toggle) את סימון "שולם" - עצמאי לגמרי מ-status/delivered_at, כי
// בדרך כלל משולם בהזמנה, הרבה לפני שהלקוחה סיימה לבחור. אין אינטגרציית
// סליקה (ראו README) אז זה סימון ידני. רץ עם session הצלם, אותו דפוס בעלות
// כמו app/api/galleries/[id]/toggle-delivered/route.ts.
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
    .select('id, paid_at')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const newPaidAt = gallery.paid_at ? null : new Date().toISOString();

  const { error } = await supabase.from('galleries').update({ paid_at: newPaidAt }).eq('id', gallery.id);

  if (error) {
    return NextResponse.json({ error: 'עדכון סימון התשלום נכשל' }, { status: 500 });
  }

  return NextResponse.json({ paidAt: newPaidAt });
}
