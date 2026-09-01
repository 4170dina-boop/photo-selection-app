import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// הופכת (toggle) את סימון "נמסר" - "הושלם" (galleries.status) אומר רק שהלקוחה
// סיימה לבחור, לא שהתמונות המוגמרות בפועל כבר נשלחו/נמסרו אליה. שדה נפרד
// (delivered_at) כדי שאפשר יהיה לראות ברשימת הגלריות אילו גלריות "הושלמו"
// אבל עדיין ממתינות למסירה בפועל. רץ עם session הצלם, אותו דפוס בעלות כמו
// app/api/galleries/[id]/route.ts.
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
    .select('id, delivered_at')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const newDeliveredAt = gallery.delivered_at ? null : new Date().toISOString();

  const { error } = await supabase.from('galleries').update({ delivered_at: newDeliveredAt }).eq('id', gallery.id);

  if (error) {
    return NextResponse.json({ error: 'עדכון סימון המסירה נכשל' }, { status: 500 });
  }

  return NextResponse.json({ deliveredAt: newDeliveredAt });
}
