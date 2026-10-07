import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateMiniSessionBookingInput, validateMiniSessionBookingStatus } from '@/lib/miniSessions';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase.from('photographers').select('id').eq('auth_user_id', user.id).single();
  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const miniSessionId = req.nextUrl.searchParams.get('miniSessionId');
  if (!miniSessionId) {
    return NextResponse.json({ error: 'יש לבחור מיני-סשן' }, { status: 400 });
  }

  const status = req.nextUrl.searchParams.get('status');
  let query = supabase
    .from('mini_session_bookings')
    .select('*')
    .eq('mini_session_id', miniSessionId)
    .order('created_at', { ascending: true });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'שליפת ההזמנות נכשלה' }, { status: 500 });
  }

  return NextResponse.json({ bookings: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const validated = validateMiniSessionBookingInput(body as any);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { miniSessionId, selectedSlot } = body as { miniSessionId?: string; selectedSlot?: string };
  if (!miniSessionId || typeof miniSessionId !== 'string') {
    return NextResponse.json({ error: 'יש לבחור מיני-סשן' }, { status: 400 });
  }
  if (!selectedSlot || !/^([01]\d|2[0-3]):[0-5]\d$/.test(selectedSlot)) {
    return NextResponse.json({ error: 'הזמן שנבחר לא תקין' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: miniSession } = await supabase
    .from('mini_sessions')
    .select('id, photographer_id, date, duration_minutes, start_time, end_time, is_active')
    .eq('id', miniSessionId)
    .single();

  if (!miniSession || !miniSession.is_active) {
    return NextResponse.json({ error: 'המיני-סשן לא קיים או לא פעיל' }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from('mini_session_bookings')
    .select('id')
    .eq('mini_session_id', miniSessionId)
    .eq('selected_slot', selectedSlot)
    .neq('status', 'cancelled')
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'השעה הזו כבר תפוסה' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('mini_session_bookings')
    .insert({
      mini_session_id: miniSessionId,
      client_name: validated.value.client_name,
      phone: validated.value.phone,
      email: validated.value.email,
      selected_slot: selectedSlot,
      notes: validated.value.notes,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'שמירת ההזמנה נכשלה' }, { status: 500 });
  }

  return NextResponse.json({ booking: data });
}

export async function PATCH(req: NextRequest) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const typedBody = body as { bookingId?: unknown; status?: unknown };
  const bookingId = typeof typedBody.bookingId === 'string' ? typedBody.bookingId : '';
  const validatedStatus = validateMiniSessionBookingStatus(typedBody.status);

  if (!bookingId) {
    return NextResponse.json({ error: 'חסר מזהה הזמנה' }, { status: 400 });
  }
  if (!validatedStatus.ok) {
    return NextResponse.json({ error: validatedStatus.error }, { status: 400 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from('mini_session_bookings')
    .select('id, mini_session_id')
    .eq('id', bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json({ error: 'ההזמנה לא נמצאה' }, { status: 404 });
  }

  const { data: miniSession } = await supabase
    .from('mini_sessions')
    .select('id')
    .eq('id', booking.mini_session_id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!miniSession) {
    return NextResponse.json({ error: 'אין לך הרשאה לעדכן הזמנה זו' }, { status: 403 });
  }

  const { data: updated, error: updateError } = await supabase
    .from('mini_session_bookings')
    .update({ status: validatedStatus.value })
    .eq('id', bookingId)
    .select('*')
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: 'עדכון סטטוס ההזמנה נכשל' }, { status: 500 });
  }

  return NextResponse.json({ booking: updated });
}
