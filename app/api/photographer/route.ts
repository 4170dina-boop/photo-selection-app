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
    .select('id, business_name, watermark_text, brand_color, logo_url, default_included_photos, default_base_price, default_extra_photo_price')
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
    defaultIncludedPhotos?: number;
    defaultBasePrice?: number;
    defaultExtraPhotoPrice?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const watermarkText = body.watermarkText?.trim() || null;

  if (watermarkText && watermarkText.length > WATERMARK_TEXT_MAX_LENGTH) {
    return NextResponse.json({ error: `הטקסט ארוך מדי (מקסימום ${WATERMARK_TEXT_MAX_LENGTH} תווים)` }, { status: 400 });
  }

  const brandColor = body.brandColor?.trim() || null;

  if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
    return NextResponse.json({ error: 'צבע מותג לא תקין' }, { status: 400 });
  }

  const update: Record<string, unknown> = { watermark_text: watermarkText, brand_color: brandColor ?? '#000000' };

  // logoUrl מגיע רק כשהוא באמת השתנה (העלאה חדשה/הסרה) - PATCH הרגיל של שאר
  // ההגדרות לא שולח את השדה הזה בכלל, כדי לא לדרוס בטעות לוגו קיים ב-null.
  if ('logoUrl' in body) {
    update.logo_url = body.logoUrl?.trim() || null;
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

  const { error } = await supabase
    .from('photographers')
    .update(update)
    .eq('auth_user_id', user.id);

  if (error) {
    return NextResponse.json({ error: 'עדכון הפרופיל נכשל' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
