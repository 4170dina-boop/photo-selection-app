import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listAllKeys, deleteObjects } from '@/lib/r2';
import { parseAdditionalInviteEmails, isValidEmail } from '@/lib/email';
import { syncPaidAtAfterTotalChange } from '@/lib/galleryPayments';
import { parseGalleryNumbers } from '@/lib/galleryValidation';
import {
  expiresAtChanged,
  statusAfterExpiryChange,
  statusGuard,
  STATUS_GUARDED_UPDATE_MAX_ATTEMPTS,
} from '@/lib/galleryLifecycle';
import { applyRowGuard } from '@/lib/rowGuard';
import { fetchClientGender, parseGenderInput, saveClientGender } from '@/lib/gender';
import { fetchGalleryLanguageOrDefault, parseLanguageInput, saveGalleryLanguage } from '@/lib/i18n/galleryLanguage';

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
    .select('id, client_id, photographer_id, status, expires_at, owner_participant_id')
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

  // best-effort בנפרד מה-select הראשי - עמודה חסרה = 'f' (lib/gender.ts)
  const clientGender = await fetchClientGender(supabase, gallery.id);
  // שפת הגלריה והמיילים ללקוח/ה - עמודה חסרה = 'he' (lib/i18n/galleryLanguage.ts)
  const language = await fetchGalleryLanguageOrDefault(supabase, gallery.id);

  return NextResponse.json({ ...gallery, client_gender: clientGender, language });
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
    clientGender?: unknown;
    language?: unknown;
    // expires_at כפי שנטען בטופס העריכה - מגן מפני טאב ישן שדורס הארכה שאושרה בינתיים
    expectedExpiresAt?: string | null;
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
  if (!isValidEmail(clientEmail.trim())) {
    return NextResponse.json({ error: 'כתובת המייל של הלקוחה לא תקינה' }, { status: 400 });
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

  // לשון פנייה ללקוח/ה (lib/gender.ts) - חסר = לא משנים את הקיים
  const parsedGender = parseGenderInput(body.clientGender);
  if (!parsedGender.ok) {
    return NextResponse.json({ error: parsedGender.error }, { status: 400 });
  }

  // שפת הגלריה (lib/i18n) - אופציונלי; חסר = לא משנים
  const parsedLanguage = parseLanguageInput(body.language);
  if (!parsedLanguage.ok) {
    return NextResponse.json({ error: parsedLanguage.error }, { status: 400 });
  }

  // גלריה שה-cron סימן כ-expired חוזרת לפעילה כשהתוקף מוארך לעתיד או מוסר
  // (statusAfterExpiryChange ב-lib/galleryLifecycle.ts). המעבר *מ*-expired
  // מותר ל-session הצלמת (guard_gallery_status_transitions חוסם רק מעבר *אל*
  // completed/expired), ו-enforce_active_gallery_limit אוכף את מגבלת החשבון
  // החינמי - מטופל למטה כ-402.
  //
  // העדכון מותנה בסטטוס שנקרא (statusGuard): ה-cron (expireGalleries) יכול
  // לסמן expired בין הקריאה לכתיבה, ואז הארכת תוקף הייתה נשמרת בלי להחזיר את
  // הסטטוס - גלריה עם תוקף עתידי שנשארת expired. 0 שורות = הסטטוס השתנה -
  // קוראים מחדש ומחשבים שוב.
  // תוקף שנטען בטופס (expectedExpiresAt): אם הוא כבר לא התוקף בשורה - מישהו
  // שינה אותו בינתיים (אישור בקשת הארכה, טאב אחר) - 409 במקום לדרוס. הגנה
  // נוספת בתוך ה-UPDATE המותנה למטה (expires_at בתוך ה-guard). לקוח ישן
  // שלא שולח את השדה - בלי הבדיקה (כמו קודם).
  const hasExpected = Object.prototype.hasOwnProperty.call(body, 'expectedExpiresAt');
  const expectedExpiresAt = typeof body.expectedExpiresAt === 'string' ? body.expectedExpiresAt : null;
  const staleResponse = () =>
    NextResponse.json({ error: 'הגלריה עודכנה במקום אחר - רענני את הדף' }, { status: 409 });
  if (hasExpected && expiresAtChanged(expectedExpiresAt, gallery.expires_at)) {
    return staleResponse();
  }

  let current: { status: string | null; expires_at: string | null; owner_participant_id: string | null } = gallery;
  let reactivatedStatus: ReturnType<typeof statusAfterExpiryChange> = null;
  let galleryError: { message?: string } | null = null;
  let galleryUpdated = false;
  for (let attempt = 0; attempt < STATUS_GUARDED_UPDATE_MAX_ATTEMPTS; attempt++) {
    let ownerHasSelections = false;
    if (current.status === 'expired' && current.owner_participant_id) {
      const { count, error: countError } = await supabase
        .from('selections')
        .select('id', { count: 'exact', head: true })
        .eq('gallery_id', gallery.id)
        .eq('participant_id', current.owner_participant_id);
      if (countError) {
        return NextResponse.json({ error: 'בדיקת הבחירות של הלקוחה נכשלה' }, { status: 500 });
      }
      ownerHasSelections = (count ?? 0) > 0;
    }
    reactivatedStatus = statusAfterExpiryChange({
      status: current.status,
      oldExpiresAt: current.expires_at,
      newExpiresAt: expiresAt,
      ownerHasSelections,
      now: new Date(),
    });

    // הגלריה נכתבת ראשונה (לפני clients/packages): היא זו שיכולה להיחסם ע"י
    // מגבלת הגלריה הפעילה, וכך חסימה כזו לא משאירה שמירה חלקית של פרטי הלקוחה.
    const { data: updatedRows, error } = await applyRowGuard(
      supabase
        .from('galleries')
        .update({
          expires_at: expiresAt,
          photographer_notes: photographerNotes?.trim() || null,
          reminder_days: reminderDays,
          additional_invite_emails: additionalInviteEmails.length > 0 ? additionalInviteEmails : null,
          // תאריך תוקף חדש = תזכורת התפוגה החד-פעמית (cron/tick) צריכה לצאת שוב
          // לפי התאריך החדש, ולא להיחשב "כבר נשלחה" על התאריך הקודם.
          ...(expiresAtChanged(current.expires_at, expiresAt) ? { last_reminder_sent_at: null } : {}),
          ...(reactivatedStatus ? { status: reactivatedStatus } : {}),
        })
        .eq('id', gallery.id),
      // גם expires_at שנקרא - כך שהארכה שאושרה בין הקריאה לכתיבה לא נדרסת
      { ...statusGuard(current.status), expires_at: current.expires_at }
    ).select('id');
    if (error) {
      galleryError = error;
      break;
    }
    if (updatedRows?.length) {
      galleryUpdated = true;
      break;
    }

    const { data: fresh } = await supabase
      .from('galleries')
      .select('status, expires_at, owner_participant_id')
      .eq('id', gallery.id)
      .single();
    if (!fresh) {
      return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
    }
    current = fresh;
    if (hasExpected && expiresAtChanged(expectedExpiresAt, current.expires_at)) {
      return staleResponse();
    }
  }

  if (galleryError?.message?.includes('LIMIT_ACTIVE_GALLERY')) {
    return NextResponse.json(
      {
        error:
          'בחשבון חינמי אפשר רק גלריה פעילה אחת, והארכת התוקף מחזירה את הגלריה הזו לפעילה. השלימי או מחקי את הגלריה הפעילה האחרת ונסי שוב.',
      },
      { status: 402 }
    );
  }
  if (galleryError) {
    return NextResponse.json({ error: 'עדכון הגלריה נכשל' }, { status: 500 });
  }
  if (!galleryUpdated) {
    return NextResponse.json({ error: 'הגלריה השתנתה בזמן השמירה - רענני את הדף ונסי שוב' }, { status: 409 });
  }

  const { error: clientError } = await supabase
    .from('clients')
    .update({ full_name: clientName.trim(), email: clientEmail.trim() })
    .eq('id', gallery.client_id);

  if (clientError) {
    return NextResponse.json({ error: 'עדכון פרטי הלקוחה נכשל' }, { status: 500 });
  }

  // עדכון נפרד כדי שעמודה חסרה (מיגרציה שלא רצה) לא תפיל את כל השמירה
  if (parsedGender.value) {
    const saved = await saveClientGender(supabase, gallery.id, parsedGender.value);
    if (saved === 'error') {
      return NextResponse.json({ error: 'שמירת לשון הפנייה נכשלה' }, { status: 500 });
    }
  }

  // כמו לשון הפנייה - עדכון נפרד, עמודה חסרה ('missing-column') לא מפילה
  if (parsedLanguage.value) {
    const saved = await saveGalleryLanguage(supabase, gallery.id, parsedLanguage.value);
    if (saved === 'error') {
      return NextResponse.json({ error: 'שמירת שפת הגלריה נכשלה' }, { status: 500 });
    }
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

  return NextResponse.json({ success: true, status: reactivatedStatus ?? current.status });
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

  // קודם שורת הגלריה ב-DB (ה-CASCADE מוחק גם את photos/delivered_photos), ורק
  // אחר כך הקבצים ב-R2: אם מחיקת ה-DB נכשלת, הגלריה נשארת שלמה עם כל הקבצים
  // שלה (במקום גלריה "חיה" שהתמונות שלה כבר נמחקו). קבצים שנשארו אחרי כישלון
  // בניקוי R2 הם רק בזבוז אחסון, לא נתונים שבורים - לכן best-effort עם לוג.
  // ל-S3/R2 אין "תיקיות" אמיתיות - listAllKeys עם prefix של ה-gallery id כולל
  // אוטומטית את כל תתי-התיקיות (thumbs/, final/). הבעלות כבר אומתה למעלה מול
  // ה-DB (loadOwnedGallery).
  const { error: deleteError } = await supabase.from('galleries').delete().eq('id', gallery.id);
  if (deleteError) {
    return NextResponse.json({ error: 'מחיקת הגלריה נכשלה' }, { status: 500 });
  }

  try {
    const objects = await listAllKeys(`${gallery.id}/`);
    if (objects.length > 0) {
      await deleteObjects(objects.map((o) => o.key));
    }
  } catch (err) {
    console.error('[galleries/delete] ניקוי קבצי R2 נכשל אחרי מחיקת הגלריה:', gallery.id, err);
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
