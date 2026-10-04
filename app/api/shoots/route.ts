import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { sendShootConfirmationEmail, isValidEmail } from '@/lib/email';
import { validateShootFields, isValidDateString, SHOOT_SELECT } from '@/lib/shoots';
import { israelDateString } from '@/lib/israelTime';

// יומן צילומים (טבלת shoots) - רשימה ויצירה. רץ עם session הצלמת (לא service
// key), בדיוק כמו app/api/galleries/route.ts, כך שה-RLS על shoots/clients/galleries
// אוכף מעצמו שאי אפשר לקרוא/ליצור רשומות של צלמת אחרת. בנוסף בודקים כאן
// בעלות מפורשת על client_id/gallery_id כדי להחזיר שגיאה ברורה.

// אותו פורמט קוד גישה כמו ב-app/api/galleries/route.ts - clients.access_code
// הוא not null + unique, גם כשהלקוחה נוצרת מיומן הצילומים לפני שיש לה גלריה.
function generateAccessCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

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

  // ?from=&to= (כולל) לתצוגת חודש; בלי פרמטרים = צילומים קרובים מהיום (בזמן ישראל) והלאה.
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if ((from && !isValidDateString(from)) || (to && !isValidDateString(to))) {
    return NextResponse.json({ error: 'טווח תאריכים לא תקין' }, { status: 400 });
  }

  let query = supabase
    .from('shoots')
    .select(SHOOT_SELECT)
    .eq('photographer_id', photographer.id)
    .gte('shoot_date', from || israelDateString(new Date()))
    .order('shoot_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (to) query = query.lte('shoot_date', to);
  else if (!from) query = query.limit(50);

  const { data: shoots, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'שליפת הצילומים נכשלה' }, { status: 500 });
  }

  return NextResponse.json({ shoots: shoots ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  let body: {
    clientId?: string;
    clientName?: string;
    clientEmail?: string;
    shootDate?: string;
    startTime?: string;
    location?: string;
    notes?: string | null;
    galleryId?: string | null;
    sendConfirmation?: boolean;
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

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
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

  // לקוחה קיימת (clientId) או חדשה (שם + מייל) - אותה טבלת clients של הגלריות.
  let client: { id: string; full_name: string; email: string } | null = null;
  let createdClient = false;

  if (body.clientId) {
    const { data } = await supabase
      .from('clients')
      .select('id, full_name, email')
      .eq('id', body.clientId)
      .eq('photographer_id', photographer.id)
      .single();
    if (!data) {
      return NextResponse.json({ error: 'הלקוחה שנבחרה לא נמצאה' }, { status: 404 });
    }
    client = data;
  } else {
    const clientName = body.clientName?.trim();
    const clientEmail = body.clientEmail?.trim();
    if (!clientName || !clientEmail) {
      return NextResponse.json({ error: 'צריך לבחור לקוחה קיימת או להזין שם ואימייל' }, { status: 400 });
    }
    if (!isValidEmail(clientEmail)) {
      return NextResponse.json({ error: 'כתובת המייל של הלקוחה לא תקינה' }, { status: 400 });
    }

    // ניסיונות חוזרים למקרה נדיר של התנגשות בקוד גישה (unique), כמו ב-app/api/galleries/route.ts
    for (let attempt = 0; attempt < 5 && !client; attempt++) {
      const { data, error } = await supabase
        .from('clients')
        .insert({ photographer_id: photographer.id, full_name: clientName, email: clientEmail, access_code: generateAccessCode() })
        .select('id, full_name, email')
        .single();

      if (!error) {
        client = data;
        createdClient = true;
      } else if (error.code !== '23505') {
        return NextResponse.json({ error: 'יצירת הלקוחה נכשלה' }, { status: 500 });
      }
    }

    if (!client) {
      return NextResponse.json({ error: 'יצירת הלקוחה נכשלה, נסי שוב' }, { status: 500 });
    }
  }

  const { data: shoot, error: shootError } = await supabase
    .from('shoots')
    .insert({
      photographer_id: photographer.id,
      client_id: client.id,
      gallery_id: body.galleryId || null,
      ...fields.value,
    })
    .select('id')
    .single();

  if (shootError || !shoot) {
    if (createdClient) await supabase.from('clients').delete().eq('id', client.id);
    return NextResponse.json({ error: 'יצירת הצילום נכשלה' }, { status: 500 });
  }

  // אישור ללקוחה - ברירת מחדל מופעל, best-effort כמו מייל ההזמנה לגלריה:
  // כישלון שליחה לא מבטל את יצירת הצילום, רק מוחזר emailSent=false לתצוגה.
  let emailSent = false;
  if (body.sendConfirmation !== false) {
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

  return NextResponse.json({ shootId: shoot.id, emailSent });
}
