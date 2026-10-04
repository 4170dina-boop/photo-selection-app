import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendShootConfirmationEmail } from '@/lib/email';
import { validateShootFields, formatShootTime } from '@/lib/shoots';

// עריכה/מחיקה של צילום קיים - אותו דפוס כמו app/api/galleries/[id]/route.ts:
// session הצלמת + בדיקת בעלות מפורשת (loadOwnedShoot) מעל ה-RLS.

async function loadOwnedShoot(supabase: ReturnType<typeof createClient>, shootId: string, userId: string) {
  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name')
    .eq('auth_user_id', userId)
    .single();

  if (!photographer) return null;

  const { data: shoot } = await supabase
    .from('shoots')
    .select('id, client_id, shoot_date, start_time')
    .eq('id', shootId)
    .eq('photographer_id', photographer.id)
    .single();

  return shoot ? { shoot, photographer } : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const owned = await loadOwnedShoot(supabase, params.id, user.id);
  if (!owned) {
    return NextResponse.json({ error: 'צילום לא נמצא' }, { status: 404 });
  }
  const { shoot, photographer } = owned;

  let body: {
    clientId?: string;
    shootDate?: string;
    startTime?: string;
    location?: string;
    notes?: string | null;
    galleryId?: string | null;
    sendUpdate?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const fields = validateShootFields(body);
  if (!fields.ok) {
    return NextResponse.json({ error: fields.error }, { status: 400 });
  }

  const clientId = body.clientId || shoot.client_id;
  const { data: client } = await supabase
    .from('clients')
    .select('id, full_name, email')
    .eq('id', clientId)
    .eq('photographer_id', photographer.id)
    .single();
  if (!client) {
    return NextResponse.json({ error: 'הלקוחה שנבחרה לא נמצאה' }, { status: 404 });
  }

  if (body.galleryId) {
    const { data: gallery } = await supabase
      .from('galleries')
      .select('id')
      .eq('id', body.galleryId)
      .eq('photographer_id', photographer.id)
      .single();
    if (!gallery) {
      return NextResponse.json({ error: 'הגלריה שנבחרה לא נמצאה' }, { status: 404 });
    }
  }

  const update: Record<string, unknown> = {
    ...fields.value,
    client_id: client.id,
    gallery_id: body.galleryId || null,
  };

  // הצילום הוזז (או הוחלפה לקוחה) - התזכורת שכבר נשלחה (אם נשלחה) הייתה על
  // המועד הישן, אז מאפסים כדי שה-cron ישלח תזכורת חדשה על המועד החדש.
  const moved =
    fields.value.shoot_date !== shoot.shoot_date ||
    fields.value.start_time !== formatShootTime(shoot.start_time) ||
    client.id !== shoot.client_id;
  if (moved) update.reminder_sent_at = null;

  const { error } = await supabase.from('shoots').update(update).eq('id', shoot.id);
  if (error) {
    return NextResponse.json({ error: 'עדכון הצילום נכשל' }, { status: 500 });
  }

  // שליחת הפרטים המעודכנים ללקוחה - רק אם הצלמת ביקשה במפורש (לא כל תיקון
  // הערה פרטית צריך לשלוח מייל ללקוחה).
  let emailSent = false;
  if (body.sendUpdate) {
    const result = await sendShootConfirmationEmail({
      to: client.email,
      clientName: client.full_name,
      businessName: photographer.business_name,
      shootDate: fields.value.shoot_date,
      startTime: fields.value.start_time,
      location: fields.value.location,
      replyTo: user.email,
    });
    emailSent = result.sent;
    if (emailSent) {
      await supabase.from('shoots').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', shoot.id);
    }
  }

  return NextResponse.json({ success: true, emailSent });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const owned = await loadOwnedShoot(supabase, params.id, user.id);
  if (!owned) {
    return NextResponse.json({ error: 'צילום לא נמצא' }, { status: 404 });
  }

  const { error } = await supabase.from('shoots').delete().eq('id', owned.shoot.id);
  if (error) {
    return NextResponse.json({ error: 'מחיקת הצילום נכשלה' }, { status: 500 });
  }

  // לקוחה שנוצרה רק בשביל הצילום הזה (בלי גלריה ובלי צילומים נוספים) נמחקת
  // גם היא, כדי לא להשאיר יתום - אותו עיקרון כמו מחיקת גלריה.
  const [{ count: galleryCount }, { count: shootCount }] = await Promise.all([
    supabase.from('galleries').select('id', { count: 'exact', head: true }).eq('client_id', owned.shoot.client_id),
    supabase.from('shoots').select('id', { count: 'exact', head: true }).eq('client_id', owned.shoot.client_id),
  ]);
  if (galleryCount === 0 && shootCount === 0) {
    await supabase.from('clients').delete().eq('id', owned.shoot.client_id);
  }

  return NextResponse.json({ success: true });
}
