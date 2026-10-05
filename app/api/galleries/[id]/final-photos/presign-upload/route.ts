import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { getPresignedUploadUrl } from '@/lib/r2';
import { buildFinalPhotoKey, validateUploadRequest } from '@/lib/uploadPolicy';
import { canDeliverFinals, SELECTION_NOT_FINAL_MESSAGE } from '@/lib/galleryLifecycle';

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
    .select('id, status, reopened_for_selection_at')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // תמונה סופית ראשונה מסמנת את הגלריה כנמסרה (trg_delivered_photos_mark_delivered),
  // וזה מתחיל את ספירת 30 הימים למחיקת המקור - אסור לפני שהלקוחה סיימה לבחור.
  if (!canDeliverFinals(gallery)) {
    return NextResponse.json({ error: SELECTION_NOT_FINAL_MESSAGE }, { status: 409 });
  }

  const validation = validateUploadRequest(await req.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const path = buildFinalPhotoKey(gallery.id, crypto.randomUUID(), validation.ext);
  const uploadUrl = await getPresignedUploadUrl(path, validation.contentType, validation.size);

  return NextResponse.json({ path, uploadUrl, contentType: validation.contentType });
}
