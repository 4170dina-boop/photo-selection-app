import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { getPresignedUploadUrl } from '@/lib/r2';

// מקביל ל-.../photos/presign-upload/route.ts, אבל לתת-התיקייה final/ - מחליף
// את ההעלאה הישירה של תמונות סופיות ב-handleUploadFinalPhotos
// (app/dashboard/galleries/[id]/edit/page.tsx). אותה סיבה בדיוק: אין RLS
// ב-R2, אז חתימת ה-URL וקביעת הנתיב חייבות לקרות בצד שרת.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const { data: gallery } = await supabase
    .from('galleries')
    .select('id')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const filename = typeof body?.filename === 'string' ? body.filename : '';
  if (!filename) {
    return NextResponse.json({ error: 'חסר שם קובץ' }, { status: 400 });
  }

  const path = `${params.id}/final/${crypto.randomUUID()}-${filename}`;
  const uploadUrl = await getPresignedUploadUrl(path);

  return NextResponse.json({ path, uploadUrl });
}
