import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseAmountDueOverride, parsePaymentInput } from '@/lib/payments';
import { israelDateString } from '@/lib/israelTime';
import { loadOwnedGalleryForPayments, loadPaymentsState, syncPaidAtAndLoad } from '@/lib/galleryPayments';

// מעקב תשלומים לגלריה: GET (רשימה + סיכום), POST (הוספת תשלום שהתקבל),
// PATCH (דריסה ידנית של הסכום לתשלום, או null לחזרה לחישוב מהחבילה).
// מחיקת תשלום: ./[paymentId]/route.ts. רץ עם session הצלם, אותו דפוס בעלות
// כמו app/api/galleries/[id]/toggle-paid/route.ts. כל שינוי מעדכן גם את
// galleries.paid_at לפי הכלל ב-nextPaidAt (lib/payments.ts).

async function authorize(galleryId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: 'לא מחוברת' }, { status: 401 }) } as const;
  }

  const gallery = await loadOwnedGalleryForPayments(supabase, galleryId, user.id);
  if (!gallery) {
    return { error: NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 }) } as const;
  }

  return { supabase, gallery } as const;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize(params.id);
  if ('error' in auth) return auth.error;

  const state = await loadPaymentsState(auth.supabase, auth.gallery);
  if (!state) {
    return NextResponse.json({ error: 'טעינת התשלומים נכשלה' }, { status: 500 });
  }

  return NextResponse.json(state);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize(params.id);
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const parsed = parsePaymentInput(body, israelDateString(new Date()));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { error } = await auth.supabase.from('gallery_payments').insert({
    gallery_id: auth.gallery.id,
    amount: parsed.value.amount,
    paid_on: parsed.value.paidOn,
    method: parsed.value.method,
    note: parsed.value.note,
  });

  if (error) {
    return NextResponse.json({ error: 'הוספת התשלום נכשלה' }, { status: 500 });
  }

  const state = await syncPaidAtAndLoad(auth.supabase, auth.gallery, 'payment_added');
  if (!state) {
    return NextResponse.json({ error: 'התשלום נשמר, אבל טעינת הסיכום נכשלה - רענני את הדף' }, { status: 500 });
  }

  return NextResponse.json(state);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize(params.id);
  if ('error' in auth) return auth.error;

  let body: { amountDueOverride?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const parsed = parseAmountDueOverride(body.amountDueOverride);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from('galleries')
    .update({ amount_due_override: parsed.value })
    .eq('id', auth.gallery.id);

  if (error) {
    return NextResponse.json({ error: 'עדכון הסכום לתשלום נכשל' }, { status: 500 });
  }

  const state = await syncPaidAtAndLoad(
    auth.supabase,
    { ...auth.gallery, amount_due_override: parsed.value },
    'amount_changed'
  );
  if (!state) {
    return NextResponse.json({ error: 'הסכום נשמר, אבל טעינת הסיכום נכשלה - רענני את הדף' }, { status: 500 });
  }

  return NextResponse.json(state);
}
