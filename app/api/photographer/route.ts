import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MAX_SHOOT_REMINDER_DAYS } from '@/lib/shoots';
import { parseLogoUrl, parseNonNegativeInt, parsePrice, parseReminderDays } from '@/lib/galleryValidation';
import { isMissingColumnError } from '@/lib/gender';
import { parseBankDetails, parsePaymentUrl } from '@/lib/paymentLinks';

// פרופיל הצלמת המחוברת - watermark_text (מוטבע על תצוגות התמונות, ראו
// lib/watermark.ts), brand_color, logo_url, וברירות המחדל למילוי אוטומטי
// של טופס גלריה חדשה (app/dashboard/galleries/new/page.tsx). רץ עם session
// הצלם (לא service key), כך שה-RLS הקיים דואג שאי אפשר לגעת בפרופיל צלם אחר.

const WATERMARK_TEXT_MAX_LENGTH = 60;

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer, error } = await supabase
    .from('photographers')
    .select('id, business_name, watermark_text, brand_color, logo_url, custom_theme, default_included_photos, default_base_price, default_extra_photo_price, reminder_days_default, review_link, shoot_reminder_days, shoot_daily_summary_enabled')
    .eq('auth_user_id', user.id)
    .single();

  if (error || !photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  // קישורי תשלום (lib/paymentLinks.ts) - שאילתה נפרדת ו-best-effort, כדי
  // שעמודות חסרות (מיגרציה שלא רצה, ראו סוף supabase/schema.sql) לא יפילו
  // את טעינת ההגדרות כולה. payment_links_available=false -> הטופס מציג הודעה.
  let paymentFields: Record<string, unknown> = {
    payment_bit_url: null,
    payment_paybox_url: null,
    payment_bank_details: null,
    payment_links_available: false,
  };
  try {
    const { data: paymentRow, error: paymentError } = await supabase
      .from('photographers')
      .select('payment_bit_url, payment_paybox_url, payment_bank_details')
      .eq('id', photographer.id)
      .maybeSingle();
    if (!paymentError && paymentRow) {
      paymentFields = { ...paymentRow, payment_links_available: true };
    }
  } catch {
    // בכוונה שקט - ראו הערה למעלה
  }

  return NextResponse.json({ ...photographer, ...paymentFields });
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  let body: {
    watermarkText?: string | null;
    brandColor?: string | null;
    logoUrl?: string | null;
    customTheme?: { bg: string; panel: string; text: string; accent: string } | null;
    defaultIncludedPhotos?: number;
    defaultBasePrice?: number;
    defaultExtraPhotoPrice?: number;
    reminderDaysDefault?: number;
    reviewLink?: string | null;
    shootReminderDays?: number;
    shootDailySummaryEnabled?: boolean;
    paymentBitUrl?: string | null;
    paymentPayboxUrl?: string | null;
    paymentBankDetails?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  if ('watermarkText' in body) {
    const watermarkText = (typeof body.watermarkText === 'string' ? body.watermarkText.trim() : '') || null;
    if (watermarkText && watermarkText.length > WATERMARK_TEXT_MAX_LENGTH) {
      return NextResponse.json({ error: `הטקסט ארוך מדי (מקסימום ${WATERMARK_TEXT_MAX_LENGTH} תווים)` }, { status: 400 });
    }
  }

  if ('brandColor' in body) {
    const brandColor = (typeof body.brandColor === 'string' ? body.brandColor.trim() : '') || null;
    if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      return NextResponse.json({ error: 'צבע מותג לא תקין' }, { status: 400 });
    }
  }

  const update: Record<string, unknown> = {};

  // watermarkText/brandColor מגיעים רק כשהם באמת חלק מהבקשה - PATCH חלקי
  // (כמו שמירת/איפוס עיצוב מה-AI theme designer, ששולח רק customTheme) לא
  // שולח את השדות האלה בכלל, כדי לא לדרוס בטעות ערכים קיימים.
  if ('watermarkText' in body) {
    update.watermark_text = body.watermarkText?.trim() || null;
  }

  if ('brandColor' in body) {
    update.brand_color = body.brandColor?.trim() || '#000000';
  }

  // logoUrl מגיע רק כשהוא באמת השתנה (העלאה חדשה/הסרה) - PATCH הרגיל של שאר
  // ההגדרות לא שולח את השדה הזה בכלל, כדי לא לדרוס בטעות לוגו קיים ב-null.
  // רק URL ציבורי מה-bucket photographer-logos שלנו (או null) - הלוגו מוצג
  // ללקוחות בגלריה, אז לא מקבלים כל כתובת חיצונית. ראו lib/galleryValidation.ts.
  if ('logoUrl' in body) {
    const logo = parseLogoUrl(body.logoUrl, process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!logo.ok) {
      return NextResponse.json({ error: logo.error }, { status: 400 });
    }
    update.logo_url = logo.value;
  }

  // customTheme: null מנקה חזרה לפלטה הקבועה. אם מוגדר, כל 4 השדות חייבים
  // להיות hex תקין - זה נשמר רק אחרי שהצלמת אישרה תצוגה מקדימה (ראו הגדרות),
  // אבל בודקים שוב כאן כי זו הבקרה האמיתית לפני כתיבה ל-DB.
  if ('customTheme' in body) {
    if (body.customTheme === null) {
      update.custom_theme = null;
    } else {
      const t = body.customTheme;
      const hex = /^#[0-9a-fA-F]{6}$/;
      if (!t || !hex.test(t.bg) || !hex.test(t.panel) || !hex.test(t.text) || !hex.test(t.accent)) {
        return NextResponse.json({ error: 'עיצוב מותאם אישית לא תקין' }, { status: 400 });
      }
      update.custom_theme = t;
    }
  }

  // ברירות מחדל מספריות - Number.isFinite/isInteger דרך lib/galleryValidation.ts,
  // כך ש-NaN, '' ושברים במקום מספר שלם נדחים ולא נכתבים ל-DB.
  if (body.defaultIncludedPhotos != null) {
    const r = parseNonNegativeInt(body.defaultIncludedPhotos, 'מספר תמונות ברירת מחדל חייב להיות מספר שלם אי-שלילי');
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    update.default_included_photos = r.value;
  }
  if (body.defaultBasePrice != null) {
    const r = parsePrice(body.defaultBasePrice, 'מחיר ברירת מחדל חייב להיות מספר אי-שלילי');
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    update.default_base_price = r.value;
  }
  if (body.defaultExtraPhotoPrice != null) {
    const r = parsePrice(body.defaultExtraPhotoPrice, 'מחיר ברירת מחדל חייב להיות מספר אי-שלילי');
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    update.default_extra_photo_price = r.value;
  }
  if (body.reminderDaysDefault != null) {
    const r = parseReminderDays(body.reminderDaysDefault);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    update.reminder_days_default = r.value;
  }
  if ('reviewLink' in body) {
    const reviewLink = body.reviewLink?.trim() || null;
    if (reviewLink && !/^https?:\/\/.+/.test(reviewLink)) {
      return NextResponse.json({ error: 'קישור הביקורת צריך להתחיל ב-http:// או https://' }, { status: 400 });
    }
    update.review_link = reviewLink;
  }
  // יומן צילומים (ראו lib/shoots.ts) - 0 = בלי תזכורת אוטומטית ללקוחה לפני צילום.
  if (body.shootReminderDays != null) {
    if (!Number.isInteger(body.shootReminderDays) || body.shootReminderDays < 0 || body.shootReminderDays > MAX_SHOOT_REMINDER_DAYS) {
      return NextResponse.json({ error: `ימי תזכורת לפני צילום: מספר שלם בין 0 ל-${MAX_SHOOT_REMINDER_DAYS}` }, { status: 400 });
    }
    update.shoot_reminder_days = body.shootReminderDays;
  }
  if (typeof body.shootDailySummaryEnabled === 'boolean') {
    update.shoot_daily_summary_enabled = body.shootDailySummaryEnabled;
  }

  // קישורי תשלום ללקוחה (lib/paymentLinks.ts) - https בלבד. נאספים בנפרד
  // ונשמרים בעדכון שני, כדי שעמודות חסרות לא יפילו את שמירת שאר ההגדרות.
  const paymentUpdate: Record<string, unknown> = {};
  if ('paymentBitUrl' in body) {
    const r = parsePaymentUrl(body.paymentBitUrl, 'קישור לתשלום בביט');
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    paymentUpdate.payment_bit_url = r.value;
  }
  if ('paymentPayboxUrl' in body) {
    const r = parsePaymentUrl(body.paymentPayboxUrl, 'קישור PayBox');
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    paymentUpdate.payment_paybox_url = r.value;
  }
  if ('paymentBankDetails' in body) {
    const r = parseBankDetails(body.paymentBankDetails);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    paymentUpdate.payment_bank_details = r.value;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase
      .from('photographers')
      .update(update)
      .eq('auth_user_id', user.id);

    if (error) {
      return NextResponse.json({ error: 'עדכון הפרופיל נכשל' }, { status: 500 });
    }
  }

  // paymentLinksSaved=false = העמודות עוד לא קיימות (צריך להריץ את המיגרציה) -
  // שאר ההגדרות כבר נשמרו, אז לא מחזירים שגיאה, רק דגל שהטופס מציג כהודעה.
  let paymentLinksSaved: boolean | undefined;
  if (Object.keys(paymentUpdate).length > 0) {
    const { error: paymentError } = await supabase
      .from('photographers')
      .update(paymentUpdate)
      .eq('auth_user_id', user.id);
    if (paymentError) {
      if (!isMissingColumnError(paymentError)) {
        return NextResponse.json({ error: 'שמירת קישורי התשלום נכשלה' }, { status: 500 });
      }
      paymentLinksSaved = false;
    } else {
      paymentLinksSaved = true;
    }
  }

  return NextResponse.json({ success: true, ...(paymentLinksSaved === undefined ? {} : { paymentLinksSaved }) });
}
