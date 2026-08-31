import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// מייצא CSV של התמונות שנבחרו בגלריה - נוח למסירה למעבדת הדפסה או לתיעוד,
// בנפרד מהורדת הקבצים עצמם (MagicButton/ZIP). רק שם קובץ + הערה, בלי URLs -
// אין צורך ב-signed URL כי לא מורידים תוכן, רק רשימה.
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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
    .select('id, owner_participant_id, clients(full_name)')
    .eq('id', params.id)
    .eq('photographer_id', photographer.id)
    .single();

  if (!gallery) {
    return NextResponse.json({ error: 'גלריה לא נמצאה' }, { status: 404 });
  }

  // רק בחירות הבעלים (שיתוף גלריה משפחתי) - זו הרשימה הרשמית למסירה,
  // קלט של בני משפחה אחרים לא נכלל בייצוא הזה.
  const { data: selections } = await supabaseAdmin
    .from('selections')
    .select('note, photos(original_filename)')
    .eq('gallery_id', params.id)
    .eq('participant_id', gallery.owner_participant_id)
    .eq('status', 'selected');

  const rows = (selections ?? [])
    .filter((s: any) => s.photos)
    .map((s: any) => [s.photos.original_filename as string, (s.note as string) ?? '']);

  const csvLines = ['שם קובץ,הערה', ...rows.map(([filename, note]) => `${escapeCsvField(filename)},${escapeCsvField(note)}`)];
  // BOM כדי ש-Excel יזהה UTF-8 נכון (בלי זה עברית מוצגת כג'יבריש בפתיחה ישירה)
  const csv = '﻿' + csvLines.join('\r\n');

  const clientName = (gallery as any).clients?.full_name ?? 'גלריה';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="selections-${encodeURIComponent(clientName)}.csv"`,
    },
  });
}
