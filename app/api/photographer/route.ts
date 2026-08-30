import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// פרופיל הצלמת המחוברת - כרגע רק watermark_text (הטקסט שמוטבע על תצוגות
// התמונות בגלריית הלקוחה, ראו lib/watermark.ts). רץ עם session הצלם (לא
// service key), כך שה-RLS הקיים דואג מעצמו שאי אפשר לגעת בפרופיל של צלם אחר.

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
    .select('business_name, watermark_text')
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

  let body: { watermarkText?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const watermarkText = body.watermarkText?.trim() || null;

  if (watermarkText && watermarkText.length > WATERMARK_TEXT_MAX_LENGTH) {
    return NextResponse.json({ error: `הטקסט ארוך מדי (מקסימום ${WATERMARK_TEXT_MAX_LENGTH} תווים)` }, { status: 400 });
  }

  const { error } = await supabase.from('photographers').update({ watermark_text: watermarkText }).eq('auth_user_id', user.id);

  if (error) {
    return NextResponse.json({ error: 'עדכון הפרופיל נכשל' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
