import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isMissingColumnError } from '@/lib/gender';
import { parseBusinessName } from '@/lib/onboarding';

// מצב אשף הפתיחה (app/dashboard/welcome/page.tsx) + ספירת הגלריות שההפניה
// אליו ורשימת השלמת ההגדרות צריכות. רץ עם session הצלמת - ה-RLS הקיים מגביל
// את כל השאילתות לשורה/לגלריות שלה בלבד.
//
// photographers.onboarding_done_at ו-galleries.is_sample הן עמודות ממיגרציה
// (סוף supabase/schema.sql). אם הן חסרות: onboardingDone=null (הדפדפן נופל
// לדגל ב-localStorage) ו-realGalleryCount=galleryCount (אין דרך לזהות דוגמה).
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase
    .from('photographers')
    .select('id, business_name')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const [doneRes, allRes, realRes] = await Promise.all([
    supabase.from('photographers').select('onboarding_done_at').eq('id', photographer.id).maybeSingle(),
    supabase.from('galleries').select('id', { count: 'exact', head: true }).eq('photographer_id', photographer.id),
    supabase
      .from('galleries')
      .select('id', { count: 'exact', head: true })
      .eq('photographer_id', photographer.id)
      .eq('is_sample', false),
  ]);

  const onboardingDone = doneRes.error
    ? null
    : !!(doneRes.data as { onboarding_done_at?: string | null } | null)?.onboarding_done_at;
  const galleryCount = allRes.error ? null : allRes.count ?? 0;
  const realGalleryCount = realRes.error ? galleryCount : realRes.count ?? 0;

  return NextResponse.json({
    photographerId: photographer.id,
    businessName: photographer.business_name ?? '',
    onboardingDone,
    galleryCount,
    realGalleryCount,
  });
}

// { businessName?: string, done?: true } - שם העסק (אין לו שדה ב-PATCH של
// app/api/photographer) ו/או סימון שהאשף הסתיים. onboardingSaved=false =
// העמודה חסרה, הדפדפן שומר דגל מקומי במקום.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  let body: { businessName?: unknown; done?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  if ('businessName' in body) {
    const parsed = parseBusinessName(body.businessName);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { error } = await supabase.from('photographers').update({ business_name: parsed.value }).eq('auth_user_id', user.id);
    if (error) return NextResponse.json({ error: 'שמירת שם העסק נכשלה' }, { status: 500 });
  }

  let onboardingSaved: boolean | undefined;
  if (body.done === true) {
    // רק אם עוד לא סומן - כך שהחותמת נשארת מתי האשף הסתיים בפעם הראשונה
    const { error } = await supabase
      .from('photographers')
      .update({ onboarding_done_at: new Date().toISOString() })
      .eq('auth_user_id', user.id)
      .is('onboarding_done_at', null);
    if (error) {
      if (!isMissingColumnError(error)) {
        return NextResponse.json({ error: 'שמירת סיום האשף נכשלה' }, { status: 500 });
      }
      onboardingSaved = false;
    } else {
      onboardingSaved = true;
    }
  }

  return NextResponse.json({ success: true, ...(onboardingSaved === undefined ? {} : { onboardingSaved }) });
}
