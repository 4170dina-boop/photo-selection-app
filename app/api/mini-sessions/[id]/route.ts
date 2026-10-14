import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildMiniSessionSlots, validateMiniSessionInput } from '@/lib/miniSessions';

// עריכה / השהיה / מחיקה של מרתון קיים (יצירה: ../route.ts). ה-RLS "photographers
// see own mini sessions" מגביל ממילא לצלמת המחוברת - הבדיקה כאן נותנת 404 ברור.
async function loadOwnMiniSession(id: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: NextResponse.json({ error: 'לא מחוברת' }, { status: 401 }) };

  const { data: photographer } = await supabase.from('photographers').select('id').eq('auth_user_id', user.id).single();
  if (!photographer) return { supabase, error: NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 }) };

  const { data: miniSession } = await supabase
    .from('mini_sessions')
    .select('*')
    .eq('id', id)
    .eq('photographer_id', photographer.id)
    .maybeSingle();
  if (!miniSession) return { supabase, error: NextResponse.json({ error: 'המרתון לא נמצא' }, { status: 404 }) };

  return { supabase, miniSession };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { supabase, miniSession, error } = await loadOwnMiniSession(params.id);
  if (error) return error;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  // רק השהיה/הפעלה של ההרשמה
  if (Object.keys(body).length === 1 && typeof body.isActive === 'boolean') {
    const { error: updateError } = await supabase.from('mini_sessions').update({ is_active: body.isActive }).eq('id', params.id);
    if (updateError) return NextResponse.json({ error: 'העדכון נכשל' }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const validated = validateMiniSessionInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const v = validated.value;
  const slots = buildMiniSessionSlots(v.date, v.duration_minutes, v.start_time, v.end_time);
  if (slots.length === 0) {
    return NextResponse.json({ error: 'אין משבצות זמן חוקיות ליום הזה' }, { status: 400 });
  }

  // לא משנים שעות כך שלקוחה שכבר נרשמה תישאר בלי שעה - קודם לבטל או לתאם איתה
  const { data: bookings } = await supabase
    .from('mini_session_bookings')
    .select('client_name, selected_slot')
    .eq('mini_session_id', params.id)
    .neq('status', 'cancelled');
  const sameDate = v.date === miniSession.date;
  const orphaned = (bookings ?? []).filter((b) => !sameDate || !slots.includes(b.selected_slot));
  if (orphaned.length > 0) {
    const names = orphaned.map((b) => `${b.selected_slot} ${b.client_name}`).join(', ');
    return NextResponse.json(
      { error: `השינוי מבטל שעות שכבר נרשמו אליהן: ${names}. בטלי את ההרשמות האלה (או תאמי איתן) ואז שמרי שוב.` },
      { status: 409 }
    );
  }

  const { data, error: updateError } = await supabase
    .from('mini_sessions')
    .update({
      date: v.date,
      start_time: v.start_time,
      end_time: v.end_time,
      duration_minutes: v.duration_minutes,
      price: v.price,
      deposit: v.deposit,
      notes: v.notes,
    })
    .eq('id', params.id)
    .select('*')
    .single();
  if (updateError || !data) {
    return NextResponse.json({ error: 'שמירת השינויים נכשלה' }, { status: 500 });
  }
  return NextResponse.json({ miniSession: data, slots });
}

// מחיקה - ההרשמות נמחקות איתו (on delete cascade)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { supabase, error } = await loadOwnMiniSession(params.id);
  if (error) return error;

  const { error: deleteError } = await supabase.from('mini_sessions').delete().eq('id', params.id);
  if (deleteError) return NextResponse.json({ error: 'מחיקת המרתון נכשלה' }, { status: 500 });
  return NextResponse.json({ success: true });
}
