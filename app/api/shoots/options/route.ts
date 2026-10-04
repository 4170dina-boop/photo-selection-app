import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// אפשרויות לטופס הצילום ביומן (app/dashboard/calendar/page.tsx): הלקוחות
// הקיימות של הצלמת (לבחירה במקום להקליד שוב) והגלריות שלה (לקישור צילום
// לגלריה שנוצרה אחריו). session הצלמת + RLS, כמו שאר ה-API של הדשבורד.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data: photographer } = await supabase.from('photographers').select('id').eq('auth_user_id', user.id).single();
  if (!photographer) {
    return NextResponse.json({ error: 'לא נמצא פרופיל צלם' }, { status: 404 });
  }

  const [{ data: clients, error: clientsError }, { data: galleries, error: galleriesError }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, full_name, email, created_at')
      .eq('photographer_id', photographer.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('galleries')
      .select('id, client_id, created_at, clients(full_name)')
      .eq('photographer_id', photographer.id)
      .order('created_at', { ascending: false }),
  ]);

  if (clientsError || galleriesError) {
    return NextResponse.json({ error: 'שליפת הלקוחות והגלריות נכשלה' }, { status: 500 });
  }

  // במודל הנוכחי כל גלריה יוצרת שורת clients משלה, אז אותה לקוחה יכולה
  // להופיע כמה פעמים - מציגים פעם אחת לכל מייל (השורה האחרונה שנוצרה).
  const seen = new Set<string>();
  const uniqueClients = (clients ?? []).filter((c) => {
    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({
    clients: uniqueClients.map(({ id, full_name, email }) => ({ id, full_name, email })),
    galleries: (galleries ?? []).map((g) => ({
      id: g.id,
      client_id: g.client_id,
      created_at: g.created_at,
      client_name: (g as any).clients?.full_name ?? '',
    })),
  });
}
