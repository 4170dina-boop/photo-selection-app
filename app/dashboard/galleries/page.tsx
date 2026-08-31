'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { theme, goldButtonStyle } from '@/lib/theme';

interface GalleryRow {
  id: string;
  status: string;
  expires_at: string | null;
  last_activity_at: string | null;
  last_reminder_sent_at: string | null;
  sent_at: string | null;
  owner_participant_id: string | null;
  clients: { full_name: string } | null;
  // packages.gallery_id הוא unique, אז PostgREST מחזיר יחס 1:1 - אובייקט בודד, לא מערך
  // (בניגוד ל-clients שגם הוא אובייקט בודד אבל מהצד "הרבים" של הקשר - גם לא מערך)
  packages: { included_photos: number; base_price: number; extra_photo_price: number } | null;
  selectedCount: number;
}

export default function GalleriesDashboard() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGalleries();
  }, []);

  async function loadGalleries() {
    setLoading(true);

    const { data: galleries } = await supabase
      .from('galleries')
      .select('id, status, expires_at, last_activity_at, last_reminder_sent_at, sent_at, owner_participant_id, clients(full_name), packages(included_photos, base_price, extra_photo_price)')
      .order('created_at', { ascending: false });

    if (!galleries) {
      setLoading(false);
      return;
    }

    // סופרים כמה תמונות בסטטוס 'selected' יש בכל גלריה (שאילתה נפרדת, כי אין COUNT ישיר ב-join הזה) -
    // רק של הבעלים (שיתוף גלריה משפחתי): קלט של בני משפחה אחרים לא נספר לחיוב/התקדמות רשמית.
    const rowsWithCounts = await Promise.all(
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

    setRows(rowsWithCounts);
    setLoading(false);
  }

  function formatActivity(row: GalleryRow): string {
    if (row.status === 'completed') {
      return row.last_activity_at ? `הושלם ${relativeDay(row.last_activity_at)}` : 'הושלם';
    }
    if (!row.last_activity_at) {
      return 'ללא פעילות';
    }
    return `עודכן ${relativeTime(row.last_activity_at)}`;
  }

  function relativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'הרגע';
    if (minutes < 60) return `לפני ${minutes} דקות`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `לפני ${hours} שעות`;
    const days = Math.floor(hours / 24);
    return `לפני ${days} ימים`;
  }

  function relativeDay(iso: string): string {
    const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (diffDays === 0) return 'היום';
    if (diffDays === 1) return 'אתמול';
    return `לפני ${diffDays} ימים`;
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'draft': return 'ממתין לפתיחה';
      case 'sent': return 'ממתין לפתיחה';
      case 'in_progress': return 'בבחירה';
      case 'completed': return 'הושלם';
      case 'expired': return 'באיחור';
      default: return status;
    }
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'in_progress': return theme.gold;
      case 'completed': return theme.green;
      case 'expired': return theme.errorText;
      default: return theme.textMuted;
    }
  }

  // הסטטוס ב-DB מתעדכן ל-expired רק כשה-cron רץ (ראו app/api/cron/tick/route.ts) -
  // כדי שהתצוגה תהיה נכונה גם בין ריצה לריצה, מחשבים expired גם מקומית לפי expires_at.
  function effectiveStatus(row: GalleryRow): string {
    if (row.status === 'completed') return row.status;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return 'expired';
    return row.status;
  }

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  // תואם ל-enforce_active_gallery_limit ב-supabase/schema.sql - סופר לפי הסטטוס
  // הגולמי (לא effectiveStatus), כי זה גם מה שה-trigger בודק בפועל: גלריה שפג
  // תוקפה אבל עוד לא סומנה 'expired' ב-DB (ה-cron עדיין לא רץ) עדיין נחשבת פעילה
  // מבחינת ה-trigger, גם אם היא כבר מוצגת פה כ"באיחור".
  const activeCount = rows.filter((r) => r.status !== 'completed' && r.status !== 'expired').length;
  const freeGalleryLimit = 1;

  // סכום חריגות מכל הגלריות יחד - אותו חישוב שכל שורה עושה בנפרד, ראו למטה
  const totalOverage = rows.reduce((sum, row) => {
    const included = row.packages?.included_photos ?? 0;
    const overageCount = Math.max(0, row.selectedCount - included);
    return sum + overageCount * (row.packages?.extra_photo_price ?? 0);
  }, 0);

  // מחיר החבילות עצמן - נספר על כל הגלריות (לא רק פעילות), כי בדרך כלל
  // גובים על החבילה בזמן ההזמנה, לא רק כשהיא מסתיימת.
  const totalBasePrice = rows.reduce((sum, row) => sum + (row.packages?.base_price ?? 0), 0);
  const totalRevenue = totalBasePrice + totalOverage;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>הגלריות שלי</h1>
          {totalRevenue > 0 && (
            <p style={{ color: theme.gold, fontSize: 13, margin: '0.25rem 0 0' }}>
              סה"כ הכנסה: ₪{totalRevenue}
              {totalOverage > 0 && ` (מתוכה חריגות: ₪${totalOverage})`}
            </p>
          )}
        </div>
        <Link href="/dashboard/galleries/new" style={{ ...goldButtonStyle, textDecoration: 'none' }}>
          + גלריה חדשה
        </Link>
      </div>

      <p style={{ color: activeCount >= freeGalleryLimit ? theme.errorText : theme.textMuted, fontSize: 13, marginTop: '-0.5rem' }}>
        {activeCount}/{freeGalleryLimit} גלריות פעילות (חשבון חינמי)
      </p>

      {rows.map((row) => {
        const included = row.packages?.included_photos ?? 0;
        const pct = included > 0 ? Math.min(100, Math.round((row.selectedCount / included) * 100)) : 0;
        const status = effectiveStatus(row);
        const color = statusColor(status);

        // הכנה לחיוב בפועל (עדיין לא מומש - ראו README, "מה עדיין חסר") - כרגע
        // רק מציגה לצלמת כמה חריגה יש וכמה זה שווה, לפי extra_photo_price של החבילה
        const overageCount = Math.max(0, row.selectedCount - included);
        const overagePrice = row.packages?.extra_photo_price ?? 0;
        const overageTotal = overageCount * overagePrice;

        return (
          <div
            key={row.id}
            role="button"
            tabIndex={0}
            aria-label={`מעבר להעלאת תמונות לגלריה של ${row.clients?.full_name ?? 'ללא שם'}`}
            onClick={() => router.push(`/dashboard/upload/${row.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                router.push(`/dashboard/upload/${row.id}`);
              }
            }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '1rem', background: theme.panel, border: `1px solid ${theme.border}`,
              borderRadius: 10, gap: '1rem', flexWrap: 'wrap',
              color: 'inherit', textDecoration: 'none', cursor: 'pointer',
            }}
          >
            <span
              style={{
                padding: '0.25rem 0.75rem', border: `1px solid ${color}`, color,
                borderRadius: 16, fontSize: 13, whiteSpace: 'nowrap',
              }}
            >
              {statusLabel(status)}
            </span>

            <div style={{ minWidth: 160, flex: 1 }}>
              <div style={{ background: theme.border, borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, background: theme.gold, height: '100%' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: '0.25rem', color: theme.textMuted }}>
                <span>{pct}%</span>
                <span>נבחרו {row.selectedCount}/{included}</span>
              </div>
              {!!row.packages?.base_price && (
                <div style={{ fontSize: 12, color: theme.textMuted, marginTop: '0.15rem' }}>
                  מחיר חבילה: ₪{row.packages.base_price}
                </div>
              )}
              {overageCount > 0 && (
                <div style={{ fontSize: 12, color: theme.gold, marginTop: '0.15rem' }}>
                  חריגה: {overageCount} תמונות{overagePrice > 0 ? ` (₪${overageTotal})` : ''}
                </div>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 'bold' }}>{row.clients?.full_name ?? 'ללא שם'}</div>
              <div style={{ fontSize: 13, color: theme.textMuted }}>{formatActivity(row)}</div>
            </div>

            <Link
              href={`/dashboard/galleries/${row.id}/edit`}
              onClick={(e) => e.stopPropagation()}
              style={{ color: theme.textMuted, fontSize: 13, textDecoration: 'none' }}
            >
              ✎ עריכה
            </Link>
          </div>
        );
      })}

      {rows.length === 0 && <p style={{ color: theme.textMuted }}>עדיין אין גלריות.</p>}
    </div>
  );
}
