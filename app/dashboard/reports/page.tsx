'use client';

import { useEffect, useState } from 'react';
import { theme } from '@/lib/theme';
import { createClient } from '@/lib/supabase/client';

interface GalleryRow {
  id: string;
  created_at: string;
  owner_participant_id: string | null;
  clients: { full_name: string } | null;
  packages: { included_photos: number; base_price: number; extra_photo_price: number } | null;
  selectedCount: number;
}

interface MonthGroup {
  key: string; // "2026-08"
  label: string; // "אוגוסט 2026"
  galleryCount: number;
  basePriceSum: number;
  overageSum: number;
}

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

export default function ReportsPage() {
  const [supabase] = useState(() => createClient());
  const [months, setMonths] = useState<MonthGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadReport() {
    setLoading(true);

    const { data: galleries } = await supabase
      .from('galleries')
      .select('id, created_at, owner_participant_id, clients(full_name), packages(included_photos, base_price, extra_photo_price)')
      .order('created_at', { ascending: false });

    if (!galleries) {
      setLoading(false);
      return;
    }

    // כמו ב-app/dashboard/galleries/page.tsx - סופרים רק את הבחירות הרשמיות
    // (של הבעלים), לא של אורחים בשיתוף גלריה משפחתי.
    const rows: GalleryRow[] = await Promise.all(
      galleries.map(async (g: any) => {
        const { count } = await supabase
          .from('selections')
          .select('*', { count: 'exact', head: true })
          .eq('gallery_id', g.id)
          .eq('participant_id', g.owner_participant_id)
          .eq('status', 'selected');

        return { ...g, selectedCount: count ?? 0 };
      })
    );

    // מקובצות לפי חודש היצירה של הגלריה (לא ההשלמה) - זה גם מתי שבדרך כלל
    // גובים על מחיר החבילה עצמו (ראו README, "מחיר חבילה + דוח הכנסות").
    // חריגה מהחבילה מיוחסת לאותו חודש, גם אם בפועל הלקוחה סיימה לבחור מאוחר
    // יותר - כדי לא לפצל גלריה אחת בין שתי שורות בדוח.
    const groups = new Map<string, MonthGroup>();

    for (const row of rows) {
      const date = new Date(row.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = `${HEBREW_MONTHS[date.getMonth()]} ${date.getFullYear()}`;

      const included = row.packages?.included_photos ?? 0;
      const overageCount = Math.max(0, row.selectedCount - included);
      const overage = overageCount * (row.packages?.extra_photo_price ?? 0);
      const basePrice = row.packages?.base_price ?? 0;

      const existing = groups.get(key);
      if (existing) {
        existing.galleryCount += 1;
        existing.basePriceSum += basePrice;
        existing.overageSum += overage;
      } else {
        groups.set(key, { key, label, galleryCount: 1, basePriceSum: basePrice, overageSum: overage });
      }
    }

    setMonths(Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : -1)));
    setLoading(false);
  }

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  const grandTotal = months.reduce((sum, m) => sum + m.basePriceSum + m.overageSum, 0);

  return (
    <div>
      <h1 style={{ fontSize: 20, marginBottom: '0.5rem' }}>דוח הכנסות חודשי</h1>
      <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '1.5rem' }}>
        מקובץ לפי חודש יצירת הגלריה. חריגה מהחבילה מחושבת לפי מספר התמונות שנבחרו
        <b> כרגע</b> - אם גלריה מהחודשים הקודמים עדיין פתוחה לבחירה, הסכום שלה עשוי להשתנות.
      </p>

      {months.length === 0 ? (
        <p style={{ color: theme.textMuted }}>עדיין אין גלריות.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {months.map((m) => (
            <div
              key={m.key}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem 1.5rem',
                padding: '0.85rem 1rem', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10,
              }}
            >
              <span style={{ fontWeight: 'bold' }}>{m.label}</span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                <span style={{ color: theme.textFaint, fontSize: 12 }}>{m.galleryCount} גלריות</span>
                <span style={{ color: theme.textMuted, fontSize: 13 }}>
                  ₪{m.basePriceSum}
                  {m.overageSum > 0 && <span style={{ color: theme.gold }}> + ₪{m.overageSum} חריגה</span>}
                </span>
                <span style={{ fontWeight: 'bold', color: theme.gold, fontFamily: theme.fontSerif }}>
                  ₪{m.basePriceSum + m.overageSum}
                </span>
              </div>
            </div>
          ))}

          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '1rem 1.25rem', marginTop: '0.5rem', borderTop: `1px solid ${theme.border}`,
            }}
          >
            <span style={{ color: theme.textMuted }}>סה&quot;כ הכנסה (כל הגלריות)</span>
            <span style={{ fontSize: 18, fontWeight: 'bold', color: theme.gold, fontFamily: theme.fontSerif }}>₪{grandTotal}</span>
          </div>
        </div>
      )}
    </div>
  );
}
