import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listAllKeys, deleteObjects } from '@/lib/r2';
import { parseAdditionalInviteEmails, isValidEmail } from '@/lib/email';
import { syncPaidAtAfterTotalChange } from '@/lib/galleryPayments';
import { parseGalleryNumbers } from '@/lib/galleryValidation';

// עריכה/מחיקה של גלריה קיימת, בדיוק כמו app/api/galleries/route.ts (יצירה) -
// רץ עם session הצלם (לא service key), כך שה-RLS הקיים כבר דואג שאי אפשר
// לגעת בגלריה של צלם אחר.

async function loadOwnedGallery(supabase: ReturnType<typeof createClient>, galleryId: string, userId: string) {
  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('auth_user_id', userId)
    .single();

  if (!photographer) return null;

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id, client_id, photographer_id')
    .eq('id', galleryId)
    .eq('photographer_id', photographer.id)
    .single();

  return gallery;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: gallery, error } = await supabase
    .from('galleries')
    .select('id, status, expires_at, reminder_days, photographer_notes, additional_invite_emails, view_count, last_viewed_at, delivered_at, originals_cleaned_up_at, reopened_for_selection_at, clients(full_name, email, access_code), packages(included_photos, base_price, extra_photo_price)')
    .eq('id', params.id)
    .single();

  if (error || !gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  return NextResponse.json(gallery);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const gallery = await loadOwnedGallery(supabase, params.id, user.id);
  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  let body: {
    clientName?: string;
    clientEmail?: string;
    includedPhotos?: number;
    basePrice?: number;
    extraPhotoPrice?: number;
    expiresAt?: string | null;
    photographerNotes?: string | null;
    reminderDays?: number | null;
    additionalInviteEmails?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const { clientName, clientEmail, photographerNotes } = body;

  if (!clientName?.trim() || !clientEmail?.trim() || body.includedPhotos == null) {
    return NextResponse.json({ error: 'חסרים פרטים (שם לקוחה, אימייל ומספר תמונות בחבילה)' }, { status: 400 });
  }

  // כל המספרים/התאריך נבדקים לפני הכתיבה הראשונה (clients) - כדי ששגיאת
  // אימות לא תשאיר שמירה חלקית. ראו lib/galleryValidation.ts.
  const numbers = parseGalleryNumbers(body);
  if (!numbers.ok) {
    return NextResponse.json({ error: numbers.error }, { status: 400 });
  }
  const { includedPhotos, basePrice, extraPhotoPrice, expiresAt, reminderDays } = numbers.value;

  // כמו ב-POST ליצירה (app/api/galleries/route.ts) - אופציונלי, אבל אם ניתנו
  // כתובות הן חייבות להיות תקינות.
  const parsedInviteEmails = parseAdditionalInviteEmails(body.additionalInviteEmails);
  if (!parsedInviteEmails.ok) {
    return NextResponse.json({ error: parsedInviteEmails.error }, { status: 400 });
  }
  const additionalInviteEmails = parsedInviteEmails.value;

  const { error: clientError } = await supabase
    .from('clients')
    .update({ full_name: clientName.trim(), email: clientEmail.trim() })
    .eq('id', gallery.client_id);

  if (clientError) {
    return NextResponse.json({ error: 'עדכון פרטי הלקוחה נכשל' }, { status: 500 });
  }

  const { error: galleryError } = await supabase
    .from('galleries')
    .update({
      expires_at: expiresAt,
      photographer_notes: photographerNotes?.trim() || null,
      reminder_days: reminderDays,
      additional_invite_emails: additionalInviteEmails.length > 0 ? additionalInviteEmails : null,
    })
    .eq('id', gallery.id);

  if (galleryError) {
    return NextResponse.json({ error: 'עדכון הגלריה נכשל' }, { status: 500 });
  }

  // upsert ולא update: גלריה ישנה בלי שורת packages (למשל יצירה שנקטעה) הייתה
  // "מצליחה" ב-update שתואם 0 שורות, והחבילה לא הייתה נשמרת בשקט.
  const { error: packageError } = await supabase
    .from('packages')
    .upsert(
      { gallery_id: gallery.id, included_photos: includedPhotos, base_price: basePrice, extra_photo_price: extraPhotoPrice },
      { onConflict: 'gallery_id' }
    );

  if (packageError) {
    return NextResponse.json({ error: 'עדכון החבילה נכשל' }, { status: 500 });
  }

  // מחיר/מכסת החבילה אולי השתנו - paid_at נגזר מהיתרה כשיש תשלומים (best-effort)
  await syncPaidAtAfterTotalChange(supabase, gallery.id);

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const gallery = await loadOwnedGallery(supabase, params.id, user.id);
  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // מוחקים קודם את הקבצים מ-R2 - מחיקת שורת הגלריה (למטה) לא עושה את זה
  // אוטומטית, ה-CASCADE ב-DB מוחק רק את רשומות ה-photos/delivered_photos, לא
  // את הקבצים בפועל. בניגוד ל-list() הלא-רקורסיבי של Supabase Storage (דרש
  // שאילתה נפרדת לכל אחת מ-thumbs/ ו-final/), ל-S3/R2 אין "תיקיות" אמיתיות -
  // listAllKeys עם prefix של תחילית ה-gallery id כולל אוטומטית את כל תתי-התיקיות.
  // אין כאן מקבילה ל-RLS של Supabase (ה-session client לא יכול לגשת ישירות
  // ל-R2), אז זו פעולה בהרשאות מלאות בצד שרת - הבעלות כבר אומתה למעלה מול ה-DB
  // (loadOwnedGallery), בלתי תלוי לגמרי בשכבת ה-Storage.
  const objects = await listAllKeys(`${gallery.id}/`);
  if (objects.length > 0) {
    await deleteObjects(objects.map((o) => o.key));
  }

  const { error: deleteError } = await supabase.from('galleries').delete().eq('id', gallery.id);
  if (deleteError) {
    return NextResponse.json({ error: 'מחיקת הגלריה נכשלה' }, { status: 500 });
  }

  // הלקוחה שייכת לגלריה אחת בלבד במודל הנוכחי - מוחקים גם אותה כדי לא להשאיר יתום.
  // חריג: אם יש לה צילום ביומן (shoots.client_id, on delete cascade) - מחיקת
  // הלקוחה הייתה מוחקת בשקט גם את הצילום, אז במקרה הזה משאירים אותה.
  // מוחקים רק כשהספירה הצליחה ובאמת 0 - שגיאה בשאילתה (count=null) לא
  // אומרת שאין צילומים, ומחיקה במקרה כזה הייתה מוחקת בשקט גם את הצילום.
  const { count: shootCount, error: shootCountError } = await supabase
    .from('shoots')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', gallery.client_id);
  if (shootCountError) {
    console.error('[gallery delete] ספירת צילומים ללקוחה נכשלה, הלקוחה לא נמחקה:', shootCountError);
  } else if (shootCount === 0) {
    await supabase.from('clients').delete().eq('id', gallery.client_id);
  }

  return NextResponse.json({ success: true });
}
