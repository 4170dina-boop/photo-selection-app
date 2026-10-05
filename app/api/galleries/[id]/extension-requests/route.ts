import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isMissingTableError } from '@/lib/extensionRequests';

// רשימת בקשות ההארכה של גלריה לדף העריכה של הצלמת. רץ עם session הצלמת -
// ה-RLS על gallery_extension_requests מגביל לגלריות שלה. available=false
// (המיגרציה עוד לא רצה) = הדף פשוט לא מציג את האזור.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'לא מחוברת' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('gallery_extension_requests')
    .select('id, requested_days, status, created_at, decided_at')
    .eq('gallery_id', params.id)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return NextResponse.json({ available: false, requests: [] });
    return NextResponse.json({ error: 'טעינת בקשות ההארכה נכשלה' }, { status: 500 });
  }
  return NextResponse.json({ available: true, requests: data ?? [] });
}
