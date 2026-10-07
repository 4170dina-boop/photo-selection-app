import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildMiniSessionSlots, validateMiniSessionInput } from '@/lib/miniSessions';

export async function GET(req: NextRequest) {
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

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  let query = supabase
    .from('mini_sessions')
    .select('*')
    .eq('photographer_id', photographer.id)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });

  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'שליפת מיני-סשנים נכשלה' }, { status: 500 });
  }

  return NextResponse.json({ miniSessions: data ?? [] });
}

export async function POST(req: NextRequest) {
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

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const typedBody = body as {
    date?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    durationMinutes?: unknown;
    price?: unknown;
    deposit?: unknown;
    notes?: unknown;
    isActive?: unknown;
  };

  const validated = validateMiniSessionInput(typedBody);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const generatedSlots = buildMiniSessionSlots(
    validated.value.date,
    validated.value.duration_minutes,
    validated.value.start_time,
    validated.value.end_time,
  );

  if (generatedSlots.length === 0) {
    return NextResponse.json({ error: 'אין משבצות זמן חוקיות ליום הזה' }, { status: 400 });
  }

  const active = typeof typedBody.isActive === 'boolean' ? typedBody.isActive : true;

  const { data, error } = await supabase
    .from('mini_sessions')
    .insert({
      photographer_id: photographer.id,
      date: validated.value.date,
      start_time: validated.value.start_time,
      end_time: validated.value.end_time,
      duration_minutes: validated.value.duration_minutes,
      price: validated.value.price,
      deposit: validated.value.deposit,
      notes: validated.value.notes,
      is_active: active,
    })
    .select('*')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'יצירת המיני-סשן נכשלה' }, { status: 500 });
  }

  return NextResponse.json({ miniSession: data, slots: generatedSlots });
}
