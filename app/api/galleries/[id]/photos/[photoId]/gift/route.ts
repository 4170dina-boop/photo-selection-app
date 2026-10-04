import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeGiftMessage } from '@/lib/gifts';

// סימון/ביטול "תמונת מתנה" (photos.is_gift + gift_message, ראו lib/gifts.ts) -
// רק הצלמת. רץ עם session הצלם (לא service key), בדיוק כמו
// app/api/galleries/[id]/photos/[photoId]/reply/route.ts: ה-RLS
// "photographers see own photos" (for all) כבר מגביל את העדכון לתמונות שלה,
// ובנוסף בודקים בעלות על הגלריה ושהתמונה באמת שייכת לה.
//
// מותר גם אחרי שהלקוחה סיימה לבחור (completed) - מתנה היא החלטה של הצלמת,
// לא חלק מהבחירה, ולכן לא עוברת דרך checkGalleryWritable.
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

  let body: { isGift?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  if (typeof body.isGift !== 'boolean') {
    return NextResponse.json({ error: 'חסרים פרטים' }, { status: 400 });
  }

  const message = normalizeGiftMessage(body.message);
  if (!message.ok) {
    return NextResponse.json({ error: message.error }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from('photos')
    .update({ is_gift: body.isGift, gift_message: body.isGift ? message.value : null })
    .eq('id', params.photoId)
    .eq('gallery_id', params.id)
    .select('id, is_gift, gift_message')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'שמירת סימון המתנה נכשלה' }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'תמונה לא נמצאה' }, { status: 404 });
  }

  return NextResponse.json({ success: true, isGift: updated.is_gift, giftMessage: updated.gift_message });
}
