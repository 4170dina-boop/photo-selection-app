import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';
import { isMissingColumnError } from '@/lib/gender';
import { parsePaymentChoice } from '@/lib/paymentMethods';
import { loadPaymentMethods } from '@/lib/paymentMethodsQuery';

// "איך נוח לך לשלם?" (components/ClientPayButton.tsx) - הלקוחה בוחרת אחד
// מאמצעי התשלום שהצלמת מאפשרת (lib/paymentMethods.ts), והבחירה מוצגת לצלמת
// בעריכת הגלריה ובמסך "היום". אין כאן תשלום בפועל - רק רישום הבחירה.
//
// רק הבעלים (החשבון שלה) - בדיקת session מפורשת, ורק אז כתיבה עם service_role
// (galleries לא פתוחה ללקוחה ב-RLS; גם טריגר protect_internal_gallery_columns
// לא חוסם service_role). מותר גם אחרי "סיימתי" (הגלריה נעולה לבחירה, לא לתשלום).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  const session = requireGallerySession(req, galleryId);
  if (!session) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }
  if (!session.participantId) {
    return NextResponse.json({ error: 'צריך לזהות את עצמך קודם' }, { status: 428 });
  }

  let body: { method?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { data: gallery, error: galleryError } = await supabaseAdmin
    .from('galleries')
    .select('id, owner_participant_id, photographer_id')
    .eq('id', galleryId)
    .single();
  if (galleryError || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }
  if (session.participantId !== gallery.owner_participant_id) {
    return NextResponse.json({ error: 'רק בעלת הגלריה יכולה לבחור אמצעי תשלום' }, { status: 403 });
  }

  const { methods } = await loadPaymentMethods(supabaseAdmin, gallery.photographer_id);
  const choice = parsePaymentChoice(body.method, methods);
  if (!choice.ok) {
    return NextResponse.json({ error: choice.error }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('galleries')
    .update({ client_payment_choice: choice.value, client_payment_choice_at: new Date().toISOString() })
    .eq('id', galleryId);

  if (updateError) {
    // עמודות חסרות (מיגרציה שלא רצה) - הלקוחה עדיין רואה את פרטי התשלום,
    // רק הבחירה לא נשמרת. saved=false מאפשר לדפדפן להמשיך בלי הודעת שגיאה.
    if (isMissingColumnError(updateError)) {
      return NextResponse.json({ success: true, saved: false, method: choice.value });
    }
    console.error('[payment-choice] שמירת הבחירה נכשלה:', updateError);
    return NextResponse.json({ error: 'שמירת הבחירה נכשלה, נסי שוב' }, { status: 500 });
  }

  return NextResponse.json({ success: true, saved: true, method: choice.value });
}
