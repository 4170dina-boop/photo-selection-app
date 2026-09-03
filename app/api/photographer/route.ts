import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    .select('id, business_name, watermark_text, brand_color, logo_url, custom_theme, default_included_photos, default_base_price, default_extra_photo_price, reminder_days_default')
    .eq('auth_user_id', user.id)
    .single();

  if (error || !photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  return NextResponse.json(photographer);
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
  if ('logoUrl' in body) {
    update.logo_url = body.logoUrl?.trim() || null;
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

  if (body.defaultIncludedPhotos != null) {
    if (body.defaultIncludedPhotos < 0) {
      return NextResponse.json({ error: 'מספר תמונות ברירת מחדל לא יכול להיות שלילי' }, { status: 400 });
    }
    update.default_included_photos = body.defaultIncludedPhotos;
  }
  if (body.defaultBasePrice != null) {
    if (body.defaultBasePrice < 0) {
      return NextResponse.json({ error: 'מחיר ברירת מחדל לא יכול להיות שלילי' }, { status: 400 });
    }
    update.default_base_price = body.defaultBasePrice;
  }
  if (body.defaultExtraPhotoPrice != null) {
    if (body.defaultExtraPhotoPrice < 0) {
      return NextResponse.json({ error: 'מחיר ברירת מחדל לא יכול להיות שלילי' }, { status: 400 });
    }
    update.default_extra_photo_price = body.defaultExtraPhotoPrice;
  }
  if (body.reminderDaysDefault != null) {
    if (body.reminderDaysDefault < 1) {
      return NextResponse.json({ error: 'מספר ימי התזכורת חייב להיות לפחות 1' }, { status: 400 });
    }
    update.reminder_days_default = body.reminderDaysDefault;
  }

  const { error } = await supabase
    .from('photographers')
    .update(update)
    .eq('auth_user_id', user.id);

  if (error) {
    return NextResponse.json({ error: 'עדכון הפרופיל נכשל' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
