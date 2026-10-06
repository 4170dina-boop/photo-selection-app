import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isMissingColumnError } from '@/lib/gender';

// הגדרות "אוטומציות" של הצלמת (בלוק נפרד בהגדרות, components/AutomationSettings.tsx):
// respect_shabbat (ברירת מחדל true) ו-anniversary_emails (ברירת מחדל false) -
// ראו app/api/cron/tick/route.ts. route נפרד מ-app/api/photographer כדי שעמודות
// חסרות (מיגרציה שלא רצה) לא ישפיעו על שמירת שאר ההגדרות. רץ עם session
// הצלמת - ה-RLS מגביל לשורה שלה.

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });

  const { data, error } = await supabase
    .from('photographers')
    .select('respect_shabbat, anniversary_emails')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) {
      // available=false - הבלוק מציג הודעה על המיגרציה; הערכים = ברירות המחדל
      return NextResponse.json({ respect_shabbat: true, anniversary_emails: false, available: false });
    }
    return NextResponse.json({ error: 'טעינת האוטומציות נכשלה' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });

  return NextResponse.json({
    respect_shabbat: data.respect_shabbat !== false,
    anniversary_emails: data.anniversary_emails === true,
    available: true,
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });

  let body: { respectShabbat?: unknown; anniversaryEmails?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'גוף בקשה לא תקין' }, { status: 400 });
  }

  const update: Record<string, boolean> = {};
  for (const [key, column] of [
    ['respectShabbat', 'respect_shabbat'],
    ['anniversaryEmails', 'anniversary_emails'],
  ] as const) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 });
    update[column] = body[key] as boolean;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'אין מה לעדכן' }, { status: 400 });

  const { data, error } = await supabase.from('photographers').update(update).eq('auth_user_id', user.id).select('id');
  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        { error: 'צריך להריץ קודם את המיגרציה "אוטומציות" בסוף supabase/schema.sql', missingColumns: true },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'שמירת האוטומציות נכשלה' }, { status: 500 });
  }
  if (!data?.length) return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });

  return NextResponse.json({ success: true });
}
