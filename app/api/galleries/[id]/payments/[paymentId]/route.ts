import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadOwnedGalleryForPayments, syncPaidAtAndLoad } from '@/lib/galleryPayments';

// מחיקת תשלום שנרשם בטעות - ראו ../route.ts. בעלות נבדקת מול הגלריה, והמחיקה
// עצמה מסוננת גם לפי gallery_id, כך שאי אפשר למחוק תשלום של גלריה אחרת גם
// עם paymentId שרירותי (בנוסף ל-RLS על gallery_payments).
export async function DELETE(req: NextRequest, { params }: { params: { id: string; paymentId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const gallery = await loadOwnedGalleryForPayments(supabase, params.id, user.id);
  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const { data: deleted, error } = await supabase
    .from('gallery_payments')
    .delete()
    .eq('id', params.paymentId)
    .eq('gallery_id', gallery.id)
    .select('id');

  if (error) {
    return NextResponse.json({ error: 'מחיקת התשלום נכשלה' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'התשלום לא נמצא' }, { status: 404 });
  }

  const state = await syncPaidAtAndLoad(supabase, gallery, 'payment_deleted');
  if (!state) {
    return NextResponse.json({ error: 'התשלום נמחק, אבל טעינת הסיכום נכשלה - רענני את הדף' }, { status: 500 });
  }

  return NextResponse.json(state);
}
