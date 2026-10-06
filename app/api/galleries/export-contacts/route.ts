import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildCsv } from '@/lib/csv';
import { fetchAllPages } from '@/lib/fetchAllPages';
import { formatIsraelDate } from '@/lib/israelTime';
import { buildContactRows, type ContactClient, type ContactGallery } from '@/lib/contactsExport';

// מייצא CSV של כל הלקוחות של הצלמת המחוברת - שורה אחת לכל לקוחה (גם בלי
// גלריה, למשל שנוצרה מיומן הצילומים), עם סיכום הגלריות שלה (כמה, והאחרונה:
// תאריך, סטטוס, תוקף) - לרשימת אנשי קשר/תיעוד מחוץ למערכת (lib/contactsExport.ts). שונה מ-selections-export
// (שם קובץ+הערה של תמונות שנבחרו בגלריה בודדת) - זה על כל הגלריות ביחד,
// בלי פרטי תמונות בכלל. רץ עם session הצלם, לא service key - RLS דואג
// שהשאילתה על galleries/clients תחזיר רק את הרשומות של הצלמת המחוברת.

function statusLabel(status: string): string {
  switch (status) {
    case 'draft':
    case 'sent':
      return 'ממתין לפתיחה';
    case 'in_progress':
      return 'בבחירה';
    case 'completed':
      return 'הושלם';
    case 'expired':
      return 'באיחור';
    default:
      return status;
  }
}

export async function GET(req: NextRequest) {
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

  // עמוד אחרי עמוד (.range) - בלי זה Supabase חותך בשקט ב-1000 שורות. order משני
  // לפי id כדי שהסדר יהיה יציב בין עמודים גם כשיש created_at זהים.
  let clients: ContactClient[];
  let galleries: ContactGallery[];
  try {
    [clients, galleries] = await Promise.all([
      fetchAllPages<ContactClient>((from, to) =>
        supabase
          .from('clients')
          .select('id, full_name, email, created_at')
          .eq('photographer_id', photographer.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllPages<ContactGallery>((from, to) =>
        supabase
          .from('galleries')
          .select('client_id, status, expires_at, created_at')
          .eq('photographer_id', photographer.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      ),
    ]);
  } catch (err) {
    console.error('export-contacts query failed', err);
    return NextResponse.json({ error: 'שליפת הלקוחות נכשלה' }, { status: 500 });
  }

  // תאריכים לפי שעון ישראל, לא לפי אזור הזמן של השרת (UTC)
  const rows = buildContactRows(clients, galleries).map(({ client, galleryCount, lastGallery }) => [
    client.full_name ?? '',
    client.email ?? '',
    String(galleryCount),
    lastGallery?.created_at ? formatIsraelDate(lastGallery.created_at) : '',
    lastGallery?.status ? statusLabel(lastGallery.status) : '',
    lastGallery?.expires_at ? formatIsraelDate(lastGallery.expires_at) : '',
    client.created_at ? formatIsraelDate(client.created_at) : '',
  ]);

  const csv = buildCsv(
    ['שם לקוחה', 'אימייל', 'מספר גלריות', 'גלריה אחרונה', 'סטטוס גלריה אחרונה', 'תוקף גלריה אחרונה', 'לקוחה מאז'],
    rows
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contacts.csv"',
    },
  });
}
