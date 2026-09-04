import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { getPresignedUploadUrl } from '@/lib/r2';

// מחליף (בעתיד - שלב נפרד, ראו תוכנית המעבר) את ההעלאה הישירה מהדפדפן
// ל-Supabase Storage ב-app/dashboard/UploadProvider.tsx: ל-R2 (כמו S3) אין
// מקבילה ל-RLS שמאפשרת לדפדפן לדבר ישירות עם האחסון בבטחה, אז חתימת ה-URL
// חייבת לקרות כאן, בצד שרת, עם מפתחות סודיים שאסור לחשוף ללקוח. הנתיב עצמו
// חשוב שייקבע כאן ולא יתקבל מהלקוח - אחרת אין מניעה שהיא תבקש path שדורך
// על תמונה של גלריה אחרת.
//
// עדיין לא בשימוש בפועל - נוסף כתשתית תוסף בלבד לפני המעבר האטומי.
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

  const path = `${params.id}/${crypto.randomUUID()}-${filename}`;
  const uploadUrl = await getPresignedUploadUrl(path);

  return NextResponse.json({ path, uploadUrl });
}
