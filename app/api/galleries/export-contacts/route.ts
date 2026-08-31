import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// מייצא CSV של כל הלקוחות של הצלמת המחוברת - שם, אימייל, סטטוס גלריה, תאריך
// יצירה ותוקף - לרשימת אנשי קשר/תיעוד מחוץ למערכת. שונה מ-selections-export
// (שם קובץ+הערה של תמונות שנבחרו בגלריה בודדת) - זה על כל הגלריות ביחד,
// בלי פרטי תמונות בכלל. רץ עם session הצלם, לא service key - RLS דואג
// שהשאילתה על galleries/clients תחזיר רק את הרשומות של הצלמת המחוברת.

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

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

  const { data: galleries } = await supabase
    .from('galleries')
    .select('status, expires_at, created_at, clients(full_name, email)')
    .eq('photographer_id', photographer.id)
    .order('created_at', { ascending: false });

  const rows = (galleries ?? []).map((g: any) => [
    g.clients?.full_name ?? '',
    g.clients?.email ?? '',
    statusLabel(g.status),
    new Date(g.created_at).toLocaleDateString('he-IL'),
    g.expires_at ? new Date(g.expires_at).toLocaleDateString('he-IL') : '',
  ]);

  const csvLines = [
    'שם לקוחה,אימייל,סטטוס,תאריך יצירה,תוקף',
    ...rows.map((row) => row.map(escapeCsvField).join(',')),
  ];
  // BOM כדי ש-Excel יזהה UTF-8 נכון (בלי זה עברית מוצגת כג'יבריש בפתיחה ישירה)
  const csv = '﻿' + csvLines.join('\r\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contacts.csv"',
    },
  });
}
