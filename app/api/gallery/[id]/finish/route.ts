import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireGallerySession } from '@/lib/gallerySession';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// מסמן שהלקוחה סיימה לבחור. לא מחושב אוטומטית לפי מספר תמונות שנבחרו - אין דרך
// לדעת אם היא באמת סיימה או עדיין שוקלת, ואפשר שתרצה לבחור פחות/יותר מהמכסה
// שבחבילה. לכן זו פעולה מפורשת של הלקוחה, לא threshold אוטומטי.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const galleryId = params.id;
  if (!requireGallerySession(req, galleryId)) {
    return NextResponse.json({ error: 'לא מאומת' }, { status: 401 });
  }

  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('status, expires_at')
    .eq('id', galleryId)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  if (gallery.expires_at && new Date(gallery.expires_at) < new Date()) {
    return NextResponse.json({ error: 'תוקף הגלריה פג' }, { status: 410 });
  }

  if (gallery.status !== 'completed') {
    await supabaseAdmin
      .from('galleries')
      .update({ status: 'completed', last_activity_at: new Date().toISOString() })
      .eq('id', galleryId);
  }

  return NextResponse.json({ success: true });
}
