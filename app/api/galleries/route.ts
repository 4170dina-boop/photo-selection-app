import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { sendGalleryInviteEmail } from '@/lib/email';

// יוצר גלריה חדשה (client + gallery + package) עבור הצלם המחובר.
// רץ דרך לקוח השרת עם ה-session של הצלם (לא service key) - כך RLS הקיים
// (photographer_id in (select id from photographers where auth_user_id = auth.uid()))
// אוכף מעצמו שאי אפשר ליצור רשומות תחת צלם אחר.
function generateAccessCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // קוד קריא בן 8 תווים
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
    clientName?: string;
    clientEmail?: string;
    includedPhotos?: number;
    basePrice?: number;
    extraPhotoPrice?: number;
    expiresAt?: string;
    reminderDays?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { clientName, clientEmail, includedPhotos, basePrice, extraPhotoPrice, expiresAt, reminderDays } = body;

  if (!clientName?.trim() || !clientEmail?.trim() || includedPhotos == null || includedPhotos < 0) {
    return NextResponse.json({ error: 'חסרים פרטים (שם לקוחה, אימייל ומספר תמונות בחבילה)' }, { status: 400 });
  }

  const { data: photographer, error: photographerError } = await supabase
    .from('photographers')
    .select('id, business_name, reminder_days_default')
    .eq('auth_user_id', user.id)
    .single();

  if (photographerError || !photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם למשתמש הזה' }, { status: 404 });
  }

  // ניסיונות חוזרים למקרה נדיר של התנגשות בקוד גישה (unique constraint)
  let client: { id: string } | null = null;
  let accessCode = '';
  for (let attempt = 0; attempt < 5 && !client; attempt++) {
    accessCode = generateAccessCode();
    const { data, error } = await supabase
      .from('clients')
      .insert({
        photographer_id: photographer.id,
        full_name: clientName.trim(),
        email: clientEmail.trim(),
        access_code: accessCode,
      })
      .select('id')
      .single();

    if (!error) {
      client = data;
    } else if (error.code !== '23505') {
      return NextResponse.json({ error: 'יצירת הלקוחה נכשלה' }, { status: 500 });
    }
  }

  if (!client) {
    return NextResponse.json({ error: 'לא הצלחנו ליצור קוד גישה ייחודי, נסי שוב' }, { status: 500 });
  }

  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .insert({
      photographer_id: photographer.id,
      client_id: client.id,
      status: 'sent',
      reminder_days: reminderDays ?? photographer.reminder_days_default,
      sent_at: new Date().toISOString(),
      expires_at: expiresAt || null,
    })
    .select('id')
    .single();

  if (galleryError || !gallery) {
    await supabase.from('clients').delete().eq('id', client.id);

    // מגבלת חשבון חינמי (טריגר enforce_active_gallery_limit ב-DB) - ראו supabase/schema.sql
    if (galleryError?.message?.includes('LIMIT_ACTIVE_GALLERY')) {
      return NextResponse.json(
        { error: 'חשבון חינמי מוגבל לגלריה פעילה אחת בכל רגע נתון - השלימי או מחקי גלריה קיימת כדי ליצור חדשה' },
        { status: 402 }
      );
    }

    return NextResponse.json({ error: 'יצירת הגלריה נכשלה' }, { status: 500 });
  }

  const { error: packageError } = await supabase.from('packages').insert({
    gallery_id: gallery.id,
    included_photos: includedPhotos,
    base_price: basePrice ?? 0,
    extra_photo_price: extraPhotoPrice ?? 0,
  });

  if (packageError) {
    await supabase.from('galleries').delete().eq('id', gallery.id);
    await supabase.from('clients').delete().eq('id', client.id);
    return NextResponse.json({ error: 'יצירת החבילה נכשלה' }, { status: 500 });
  }

  // שיתוף גלריה משפחתי: הבעלים (הלקוחה הרשומה עצמה) נוצרת מיד עם הגלריה,
  // לא רק כשמישהו נכנס בפועל - כדי ש-owner_participant_id תמיד יהיה תקין
  // (ספירות חיוב/ייצוא מסתמכות עליו מהרגע הראשון). ראו app/gallery/[id]/page.tsx.
  const { data: ownerParticipant, error: ownerError } = await supabase
    .from('gallery_participants')
    .insert({ gallery_id: gallery.id, display_name: clientName.trim(), is_owner: true })
    .select('id')
    .single();

  if (ownerError || !ownerParticipant) {
    await supabase.from('packages').delete().eq('gallery_id', gallery.id);
    await supabase.from('galleries').delete().eq('id', gallery.id);
    await supabase.from('clients').delete().eq('id', client.id);
    return NextResponse.json({ error: 'יצירת הגלריה נכשלה' }, { status: 500 });
  }

  await supabase.from('galleries').update({ owner_participant_id: ownerParticipant.id }).eq('id', gallery.id);

  // שליחת המייל היא best-effort: כישלון שליחה לא אמור לבטל את יצירת הגלריה -
  // הצלם עדיין רואה את הקישור והקוד במסך ויכול לשלוח ידנית אם emailSent=false.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const { sent: emailSent } = await sendGalleryInviteEmail({
    to: clientEmail.trim(),
    clientName: clientName.trim(),
    businessName: photographer.business_name,
    galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
    accessCode,
  });

  return NextResponse.json({ galleryId: gallery.id, accessCode, emailSent });
}
