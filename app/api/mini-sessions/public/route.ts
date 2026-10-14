import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAvailableMiniSessionSlots, validateMiniSessionBookingInput } from '@/lib/miniSessions';

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// כל צלמת מקבלת קישור הרשמה משלה: /mini-sessions?p=<photographers.id>. בלי
// p הדף הציג את המרתונים של כל הצלמות במערכת ביחד.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const photographerId = req.nextUrl.searchParams.get('p') ?? '';
  const date = req.nextUrl.searchParams.get('date');
  if (!UUID_RE.test(photographerId)) {
    return NextResponse.json({ error: 'קישור ההרשמה לא תקין - בקשו מהצלמת את הקישור המלא' }, { status: 400 });
  }
  if (!date) {
    return NextResponse.json({ error: 'חסר תאריך' }, { status: 400 });
  }

  const { data: photographer } = await supabaseAdmin
    .from('photographers')
    .select('id, business_name')
    .eq('id', photographerId)
    .maybeSingle();
  if (!photographer) {
    return NextResponse.json({ error: 'קישור ההרשמה לא תקין - בקשו מהצלמת את הקישור המלא' }, { status: 404 });
  }

  // התאריכים הקרובים שיש בהם מרתון - כדי שהלקוחה לא תצטרך לנחש תאריך
  const todayIsrael = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const { data: upcoming } = await supabaseAdmin
    .from('mini_sessions')
    .select('date')
    .eq('photographer_id', photographerId)
    .eq('is_active', true)
    .gte('date', todayIsrael)
    .order('date', { ascending: true })
    .limit(60);
  const upcomingDates = Array.from(new Set((upcoming ?? []).map((row) => row.date as string)));

  const { data: miniSessions, error } = await supabaseAdmin
    .from('mini_sessions')
    .select('*')
    .eq('photographer_id', photographerId)
    .eq('date', date)
    .eq('is_active', true)
    .order('start_time', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'טעינת מיני-סשנים נכשלה' }, { status: 500 });
  }

  const result = await Promise.all(
    (miniSessions ?? []).map(async (miniSession) => {
      const { data: bookings } = await supabaseAdmin
        .from('mini_session_bookings')
        .select('selected_slot')
        .eq('mini_session_id', miniSession.id)
        .neq('status', 'cancelled');

      return {
        id: miniSession.id,
        date: miniSession.date,
        start_time: miniSession.start_time,
        end_time: miniSession.end_time,
        duration_minutes: miniSession.duration_minutes,
        price: miniSession.price,
        deposit: miniSession.deposit,
        notes: miniSession.notes,
        availableSlots: getAvailableMiniSessionSlots(
          miniSession.date,
          miniSession.duration_minutes,
          miniSession.start_time,
          miniSession.end_time,
          (bookings ?? []).map((b) => b.selected_slot)
        ),
      };
    })
  );

  return NextResponse.json({ businessName: photographer.business_name ?? null, upcomingDates, miniSessions: result });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const typedBody = body as {
    photographerId?: unknown;
    miniSessionId?: unknown;
    clientName?: unknown;
    phone?: unknown;
    email?: unknown;
    selectedSlot?: unknown;
    notes?: unknown;
  };

  const validated = validateMiniSessionBookingInput(typedBody);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const miniSessionId = typeof typedBody.miniSessionId === 'string' ? typedBody.miniSessionId : '';
  const selectedSlot = typeof typedBody.selectedSlot === 'string' ? typedBody.selectedSlot : '';
  if (!miniSessionId || !selectedSlot) {
    return NextResponse.json({ error: 'יש לבחור מיני-סשן ושעה' }, { status: 400 });
  }

  const { data: miniSession } = await supabaseAdmin
    .from('mini_sessions')
    .select('id, photographer_id, date, start_time, end_time, duration_minutes, is_active')
    .eq('id', miniSessionId)
    .eq('is_active', true)
    .single();

  // ההזמנה חייבת להיות למרתון של הצלמת שהקישור שלה פתוח
  if (!miniSession || miniSession.photographer_id !== typedBody.photographerId) {
    return NextResponse.json({ error: 'המיני-סשן לא קיים או לא פעיל' }, { status: 404 });
  }

  const available = getAvailableMiniSessionSlots(
    miniSession.date,
    miniSession.duration_minutes,
    miniSession.start_time,
    miniSession.end_time,
    (await supabaseAdmin
      .from('mini_session_bookings')
      .select('selected_slot')
      .eq('mini_session_id', miniSessionId)
      .neq('status', 'cancelled'))
      .data?.map((b) => b.selected_slot) ?? []
  );

  if (!available.includes(selectedSlot)) {
    return NextResponse.json({ error: 'השעה שנבחרה כבר תפוסה' }, { status: 409 });
  }

  const { data, error } = await supabaseAdmin
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

  return NextResponse.json({ success: true, booking: data });
}
