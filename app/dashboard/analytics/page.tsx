'use client';

import { useEffect, useState } from 'react';
import { theme } from '@/lib/theme';
import { createClient } from '@/lib/supabase/client';

interface GalleryRow {
  id: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  last_activity_at: string | null;
  last_reminder_sent_at: string | null;
  editing_started_at: string | null;
  owner_participant_id: string | null;
  view_count: number;
  clients: { full_name: string } | null;
  packages: { included_photos: number; extra_photo_price: number } | null;
  selectedCount: number;
  photoCount: number;
}

// כמה ימים לפני תפוגה נחשב "עומד לפוג" - אותו סף כמו "דורש תשומת לב"
// ב-app/dashboard/galleries/page.tsx, כדי ששני המסכים יסכימו על אותה הגדרה.
const EXPIRING_SOON_DAYS = 3;

export default function AnalyticsPage() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAnalytics() {
    setLoading(true);

    const { data: galleries } = await supabase
      .from('galleries')
      .select(
        'id, status, created_at, expires_at, last_activity_at, last_reminder_sent_at, editing_started_at, owner_participant_id, view_count, clients(full_name), packages(included_photos, extra_photo_price)'
      )
      .order('created_at', { ascending: false });

    if (!galleries) {
      setLoading(false);
      return;
    }

    // כמו ב-app/dashboard/galleries/page.tsx - סופרים רק את הבחירות הרשמיות
    // (של הבעלים), לא של אורחים בשיתוף גלריה משפחתי. photoCount נספר בנפרד
    // כדי לדעת כמה תמונות "מוכנות לעיבוד" יש בגלריות שהושלמו אבל העריכה בהן
    // עוד לא התחילה (editing_started_at) - למד "היום" למטה.
    const rowsWithCounts: GalleryRow[] = await Promise.all(
      galleries.map(async (g: any) => {
        const [{ count: selectedCount }, { count: photoCount }] = await Promise.all([
          supabase
            .from('selections')
            .select('*', { count: 'exact', head: true })
            .eq('gallery_id', g.id)
            .eq('participant_id', g.owner_participant_id)
            .eq('status', 'selected'),
          supabase.from('photos').select('*', { count: 'exact', head: true }).eq('gallery_id', g.id),
        ]);

        return { ...g, selectedCount: selectedCount ?? 0, photoCount: photoCount ?? 0 };
      })
    );

    setRows(rowsWithCounts);
    setLoading(false);
  }

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  const totalViews = rows.reduce((sum, r) => sum + (r.view_count ?? 0), 0);

  // זמן ממוצע מיצירת גלריה עד השלמתה - רק גלריות שבאמת הושלמו, ה-trigger
  // ב-app/api/gallery/[id]/finish מעדכן last_activity_at לרגע הסיום עצמו.
  const completedRows = rows.filter((r) => r.status === 'completed' && r.last_activity_at);
  const avgCompletionDays =
    completedRows.length > 0
      ? completedRows.reduce((sum, r) => sum + (new Date(r.last_activity_at!).getTime() - new Date(r.created_at).getTime()), 0) /
        completedRows.length /
        86400000
      : null;

  // אותו חישוב חריגה בדיוק כמו totalOverage ב-app/dashboard/galleries/page.tsx
  const overRows = rows.filter((r) => r.selectedCount > (r.packages?.included_photos ?? 0));
  const totalOverageRevenue = overRows.reduce((sum, row) => {
    const included = row.packages?.included_photos ?? 0;
    const overageCount = Math.max(0, row.selectedCount - included);
    return sum + overageCount * (row.packages?.extra_photo_price ?? 0);
  }, 0);

  const remindersSentCount = rows.filter((r) => r.last_reminder_sent_at).length;

  // לקוחות בבחירה שקרובות לסיים - ממוינות מהאחוז הגבוה ביותר, כדי שהצלמת
  // תדע את מי הכי משתלם לדחוף עכשיו (קרוב לסיום, לא בהתחלה).
  const closeToFinishRows = rows
    .filter((r) => r.status === 'in_progress')
    .map((r) => {
      const included = r.packages?.included_photos ?? 0;
      const pct = included > 0 ? Math.min(100, Math.round((r.selectedCount / included) * 100)) : 0;
      return { ...r, pct };
    })
    .sort((a, b) => b.pct - a.pct);

  // סיכום "היום" - מרכז נתונים שכבר קיימים בעמוד הזה ובדף רשימת הגלריות
  // למסך אחד שהצלמת יכולה לסרוק תוך שנייה בכל בוקר, בלי לדפדף בין מסכים.
  const awaitingSelectionCount = rows.filter((r) => r.status === 'draft' || r.status === 'sent' || r.status === 'in_progress').length;
  const needsReminderCount = rows.filter(
    (r) => (r.status === 'draft' || r.status === 'sent' || r.status === 'in_progress') && !r.last_reminder_sent_at
  ).length;
  const expiringSoonCount = rows.filter((r) => {
    if (r.status === 'completed' || r.status === 'expired' || !r.expires_at) return false;
    const daysLeft = (new Date(r.expires_at).getTime() - Date.now()) / 86400000;
    return daysLeft >= 0 && daysLeft <= EXPIRING_SOON_DAYS;
  }).length;
  // "מוכנות לעיבוד" - תמונות בגלריות שהלקוחה כבר סיימה לבחור בהן, אבל הצלמת
  // עוד לא סימנה שהתחילה לערוך (editing_started_at) - ראו app/api/galleries/[id]/toggle-editing.
  const readyForEditingPhotoCount = rows
    .filter((r) => r.status === 'completed' && !r.editing_started_at)
    .reduce((sum, r) => sum + r.photoCount, 0);

  const todaySummary = [
    { emoji: '🔴', text: `${awaitingSelectionCount} גלריות מחכות לבחירה` },
    { emoji: '🟡', text: `${needsReminderCount} לקוחות עוד לא קיבלו תזכורת` },
    { emoji: '🟢', text: `${completedRows.length} גלריות סיימו בחירה` },
    ...(totalOverageRevenue > 0 ? [{ emoji: '💰', text: `₪${totalOverageRevenue} חריגות פוטנציאליות` }] : []),
    ...(expiringSoonCount > 0 ? [{ emoji: '⚠️', text: `${expiringSoonCount} גלריות עומדות לפוג` }] : []),
    ...(readyForEditingPhotoCount > 0 ? [{ emoji: '📸', text: `${readyForEditingPhotoCount} תמונות מוכנות לעיבוד` }] : []),
  ];

  const stats = [
    { label: 'סה"כ צפיות בגלריות', value: totalViews, color: theme.text },
    {
      label: 'זמן ממוצע להשלמה',
      value: avgCompletionDays !== null ? `בממוצע ${avgCompletionDays.toFixed(1)} ימים` : 'אין עדיין נתונים',
      color: theme.gold,
    },
    { label: 'גלריות מעל המכסה', value: overRows.length, color: theme.warningText },
    { label: 'תזכורות שנשלחו', value: remindersSentCount, color: theme.textMuted },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 20, marginBottom: '0.5rem' }}>אנליטיקס</h1>
      <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '1.5rem' }}>
        מבט-על עסקי על כל הגלריות - צפיות, קצב השלמה, חריגות מכסה ותזכורות.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: theme.textMuted }}>עדיין אין גלריות.</p>
      ) : (
        <>
          <div
            style={{
              background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10,
              padding: '1rem 1.25rem', marginBottom: '1.5rem',
            }}
          >
            <h2 style={{ fontSize: 15, marginBottom: '0.75rem', marginTop: 0 }}>היום</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: 14 }}>
              {todaySummary.map((item) => (
                <span key={item.text}>
                  {item.emoji} {item.text}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            {stats.map((stat) => (
              <div
                key={stat.label}
                style={{
                  flex: '1 1 140px', background: theme.panel, border: `1px solid ${theme.border}`,
                  borderRadius: 10, padding: '0.75rem 1rem', textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 24, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                <div style={{ fontSize: 12, color: theme.textMuted, marginTop: '0.15rem' }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {overRows.length > 0 && (
            <p style={{ color: theme.gold, fontSize: 13, marginBottom: '1.5rem' }}>
              סה&quot;כ הכנסה מחריגות מכסה: ₪{totalOverageRevenue}
            </p>
          )}

          <h2 style={{ fontSize: 16, marginBottom: '0.5rem' }}>לקוחות שקרוב לסיים</h2>
          {closeToFinishRows.length === 0 ? (
            <p style={{ color: theme.textMuted, fontSize: 13 }}>אין כרגע גלריות בבחירה.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {closeToFinishRows.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem 1rem',
                    padding: '0.75rem 1rem', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10,
                  }}
                >
                  <span>{row.clients?.full_name ?? 'ללא שם'}</span>
                  <span style={{ color: theme.gold, fontSize: 13 }}>
                    {row.pct}% ({row.selectedCount}/{row.packages?.included_photos ?? 0})
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
