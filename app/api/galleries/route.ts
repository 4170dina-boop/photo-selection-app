import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { sendGalleryInviteEmail, isValidEmail } from '@/lib/email';
import { parseGalleryNumbers } from '@/lib/galleryValidation';

// יוצר גלריה חדשה (client + gallery + package) עבור הצלם המחובר.
// רץ דרך לקוח השרת עם ה-session של הצלם (לא service key) - כך RLS הקיים
// (photographer_id in (select id from photographers where auth_user_id = auth.uid()))
// אוכף מעצמו שאי אפשר ליצור רשומות תחת צלם אחר.
function generateAccessCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // קוד קריא בן 8 תווים
}

// מחיקת rollback אחרי כישלון באמצע היצירה - אם גם היא נכשלת לא נשאר מה
// לעשות מול הלקוחה (כבר מחזירים שגיאה), אבל לפחות רושמים ללוג כדי שיהיה אפשר
// לנקות ידנית שורות יתומות.
async function rollback(label: string, op: PromiseLike<{ error: unknown }>) {
  const { error } = await op;
  if (error) console.error(`[POST /api/galleries] rollback failed (${label}):`, error);
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
    additionalInviteEmails?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { clientName, clientEmail } = body;

  if (!clientName?.trim() || !clientEmail?.trim() || body.includedPhotos == null) {
    return NextResponse.json({ error: 'חסרים פרטים (שם לקוחה, אימייל ומספר תמונות בחבילה)' }, { status: 400 });
  }

  // כל המספרים/התאריך נבדקים כאן, לפני הכתיבה הראשונה - ראו lib/galleryValidation.ts
  const numbers = parseGalleryNumbers(body);
  if (!numbers.ok) {
    return NextResponse.json({ error: numbers.error }, { status: 400 });
  }
  const { includedPhotos, basePrice, extraPhotoPrice, expiresAt, reminderDays } = numbers.value;

  // כתובות מייל נוספות (למשל בני משפחה) - אופציונלי, אבל אם ניתנו כולן חייבות
  // להיות כתובות תקינות. ראו lib/email.ts: isValidEmail ו-additional_invite_emails
  // ב-supabase/schema.sql.
  const additionalInviteEmails = (body.additionalInviteEmails ?? [])
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  if (additionalInviteEmails.some((email) => !isValidEmail(email))) {
    return NextResponse.json({ error: 'אחת מכתובות המייל הנוספות לא תקינה' }, { status: 400 });
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
      expires_at: expiresAt,
      additional_invite_emails: additionalInviteEmails.length > 0 ? additionalInviteEmails : null,
    })
    .select('id')
    .single();

  if (galleryError || !gallery) {
    await rollback('client', supabase.from('clients').delete().eq('id', client.id));

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
    base_price: basePrice,
    extra_photo_price: extraPhotoPrice,
  });

  if (packageError) {
    await rollback('gallery', supabase.from('galleries').delete().eq('id', gallery.id));
    await rollback('client', supabase.from('clients').delete().eq('id', client.id));
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
    await rollback('package', supabase.from('packages').delete().eq('gallery_id', gallery.id));
    await rollback('gallery', supabase.from('galleries').delete().eq('id', gallery.id));
    await rollback('client', supabase.from('clients').delete().eq('id', client.id));
    return NextResponse.json({ error: 'יצירת הגלריה נכשלה' }, { status: 500 });
  }

  const { error: ownerLinkError } = await supabase
    .from('galleries')
    .update({ owner_participant_id: ownerParticipant.id })
    .eq('id', gallery.id);

  if (ownerLinkError) {
    // gallery_participants/packages נמחקים ב-CASCADE עם הגלריה
    await rollback('gallery', supabase.from('galleries').delete().eq('id', gallery.id));
    await rollback('client', supabase.from('clients').delete().eq('id', client.id));
    return NextResponse.json({ error: 'יצירת הגלריה נכשלה' }, { status: 500 });
  }

  // שליחת המייל היא best-effort: כישלון שליחה לא אמור לבטל את יצירת הגלריה -
  // הצלם עדיין רואה את הקישור והקוד במסך ויכול לשלוח ידנית אם emailSent=false.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const { sent: emailSent } = await sendGalleryInviteEmail({
    to: clientEmail.trim(),
    clientName: clientName.trim(),
    businessName: photographer.business_name,
    galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
    accessCode,
    replyTo: user.email,
  });

  // אותו מייל בדיוק (קישור + קוד גישה) נשלח גם לכתובות הנוספות - best-effort
  // כמו למעלה, לא חוסם את תגובת היצירה אם אחת מהשליחות נכשלת.
  await Promise.all(
    additionalInviteEmails.map((to) =>
      sendGalleryInviteEmail({
        to,
        clientName: clientName.trim(),
        businessName: photographer.business_name,
        galleryUrl: `${siteUrl}/gallery/${gallery.id}`,
        accessCode,
        replyTo: user.email,
      })
    )
  );

  return NextResponse.json({ galleryId: gallery.id, accessCode, emailSent });
}
