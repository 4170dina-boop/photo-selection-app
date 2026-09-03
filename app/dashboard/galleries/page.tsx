'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { theme, goldButtonStyle, inputStyle, outlineButtonStyle } from '@/lib/theme';

interface GalleryRow {
  id: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  last_activity_at: string | null;
  last_reminder_sent_at: string | null;
  sent_at: string | null;
  editing_started_at: string | null;
  delivered_at: string | null;
  paid_at: string | null;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'expired'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'expiry' | 'activity' | 'name'>('newest');
  const [loadError, setLoadError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [togglingEditingId, setTogglingEditingId] = useState<string | null>(null);
  const [togglingDeliveredId, setTogglingDeliveredId] = useState<string | null>(null);
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    loadGalleries();
  }, []);

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleToggleEditing(row: GalleryRow, e: React.MouseEvent) {
    e.stopPropagation();
    setTogglingEditingId(row.id);

    const res = await fetch(`/api/galleries/${row.id}/toggle-editing`, { method: 'POST' });
    setTogglingEditingId(null);

    if (!res.ok) return;
    const data = await res.json();
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, editing_started_at: data.editingStartedAt } : r)));
  }

  async function handleToggleDelivered(row: GalleryRow, e: React.MouseEvent) {
    e.stopPropagation();
    setTogglingDeliveredId(row.id);

    const res = await fetch(`/api/galleries/${row.id}/toggle-delivered`, { method: 'POST' });
    setTogglingDeliveredId(null);

    if (!res.ok) return;
    const data = await res.json();
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, delivered_at: data.deliveredAt } : r)));
  }

  async function handleTogglePaid(row: GalleryRow, e: React.MouseEvent) {
    e.stopPropagation();
    setTogglingPaidId(row.id);

    const res = await fetch(`/api/galleries/${row.id}/toggle-paid`, { method: 'POST' });
    setTogglingPaidId(null);

    if (!res.ok) return;
    const data = await res.json();
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, paid_at: data.paidAt } : r)));
  }

  // פעולות מרוכזות - לולאה על ה-API הקיים של פריט בודד (לא route חדש) - פשוט
  // ובטוח יותר מ-endpoint מרוכז חדש, והכמות (כמה גלריות יש לצלמת אחת) קטנה
  // מספיק שזה לא בעיית ביצועים.
  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`למחוק ${selectedIds.size} גלריות? כל התמונות והבחירות שלהן יימחקו לצמיתות - אי אפשר לבטל את זה.`)) return;

    setBulkWorking(true);
    setBulkMessage('');
    let succeeded = 0;

    for (const id of selectedIds) {
      const res = await fetch(`/api/galleries/${id}`, { method: 'DELETE' });
      if (res.ok) succeeded++;
    }

    setBulkWorking(false);
    setBulkMessage(`נמחקו ${succeeded} מתוך ${selectedIds.size} גלריות`);
    setSelectedIds(new Set());
    await loadGalleries();
  }

  async function handleBulkReminder() {
    if (selectedIds.size === 0) return;

    // תזכורת תפוגה דורשת expires_at - מדלגים בשקט על גלריות בלי תוקף,
    // אותה בדיקה שכבר קיימת ב-app/api/galleries/[id]/send-reminder.
    const eligible = rows.filter((r) => selectedIds.has(r.id) && r.expires_at);
    if (eligible.length === 0) {
      setBulkMessage('אין בבחירה גלריות עם תוקף מוגדר - אי אפשר לשלוח תזכורת');
      return;
    }

    setBulkWorking(true);
    setBulkMessage('');
    let sent = 0;

    for (const row of eligible) {
      const res = await fetch(`/api/galleries/${row.id}/send-reminder`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.emailSent) sent++;
      }
    }

    setBulkWorking(false);
    setBulkMessage(`נשלחו ${sent} מתוך ${eligible.length} תזכורות (גלריות בלי תוקף דולגו)`);
    setSelectedIds(new Set());
  }

  async function loadGalleries() {
    setLoading(true);
    setLoadError('');

    const { data: galleries, error } = await supabase
      .from('galleries')
      .select('id, status, created_at, expires_at, last_activity_at, last_reminder_sent_at, sent_at, editing_started_at, delivered_at, paid_at, owner_participant_id, clients(full_name), packages(included_photos, base_price, extra_photo_price)')
      .order('created_at', { ascending: false });

    // בלי הבדיקה הזו, שגיאת שאילתה (למשל RLS, או עמודה חסרה אם המיגרציה
    // ב-supabase/schema.sql לא רצה במלואה) הייתה נראית בדיוק כמו "אין גלריות
    // בכלל" - הצלמת הייתה רואה רשימה ריקה בלי שום רמז שמשהו נכשל.
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }
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

    // best-effort, נפרד מטעינת הרשימה עצמה - כישלון (או פשוט אין עדיין תמונות
    // באף גלריה) לא אמור לעכב/לשבור את הרשימה, רק להשאיר אותה בלי תמונות נושא.
    fetch('/api/galleries/cover-photos')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.covers && setCoverUrls(data.covers))
      .catch(() => {});
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

  if (loadError) {
    return (
      <div>
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          טעינת רשימת הגלריות נכשלה: {loadError}
        </p>
        <button onClick={loadGalleries} style={outlineButtonStyle}>
          נסי שוב
        </button>
      </div>
    );
  }

  // תואם ל-enforce_active_gallery_limit ב-supabase/schema.sql - סופר לפי הסטטוס
  // הגולמי (לא effectiveStatus), כי זה גם מה שה-trigger בודק בפועל: גלריה שפג
  // תוקפה אבל עוד לא סומנה 'expired' ב-DB (ה-cron עדיין לא רץ) עדיין נחשבת פעילה
  // מבחינת ה-trigger, גם אם היא כבר מוצגת פה כ"באיחור".
  const activeCount = rows.filter((r) => r.status !== 'completed' && r.status !== 'expired').length;
  const freeGalleryLimit = 1;

  // מבט-על מהיר לראש הדף - כמה גלריות יש בסה"כ, כמה עדיין ממתינות לפעולה
  // (טרם נפתחו/בבחירה - לא כולל הושלמו/פג תוקפן), וכמה הושלמו.
  const totalCount = rows.length;
  const pendingActionCount = rows.filter((r) => r.status === 'draft' || r.status === 'sent' || r.status === 'in_progress').length;
  const completedCount = rows.filter((r) => r.status === 'completed').length;

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

  // גלריות שדורשות תשומת לב עכשיו: תוקף מתקרב (עד 3 ימים) והלקוחה עדיין לא
  // סיימה לבחור - לא כולל גלריות שכבר פגו (אלה כבר "באיחור", אין מה לדחוף שם)
  // או שהושלמו. ממוינות מהדחוף ביותר, כדי שהצלמת תדע את מי לדחוף קודם
  // (עם "🔔 שליחת תזכורת עכשיו" בדף העריכה, ראו app/api/galleries/[id]/send-reminder).
  const ATTENTION_WINDOW_DAYS = 3;
  const urgentRows = rows
    .filter((row) => {
      if (!row.expires_at || effectiveStatus(row) === 'completed' || effectiveStatus(row) === 'expired') return false;
      const daysLeft = (new Date(row.expires_at).getTime() - Date.now()) / 86400000;
      return daysLeft >= 0 && daysLeft <= ATTENTION_WINDOW_DAYS;
    })
    .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime());

  // חיפוש/סינון על מה שכבר נטען - אין קריאת API נוספת, רשימת הגלריות של צלמת
  // בודדת קטנה מספיק שסינון בצד לקוח מספיק. הכותרת (הכנסה, X/1 פעילות) נשארת
  // מחושבת על כל הגלריות תמיד, לא רק על התוצאה המסוננת - זה סיכום כללי, לא "לפי מסך".
  const filteredRows = rows.filter((row) => {
    const status = effectiveStatus(row);
    const bucket = status === 'draft' || status === 'sent' ? 'pending' : status;
    const matchesStatus = statusFilter === 'all' || bucket === statusFilter;
    const matchesSearch = !searchQuery.trim() || (row.clients?.full_name ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // מיון בצד לקוח על מה שכבר נטען ומסונן - "newest" הוא סדר ברירת המחדל
  // שכבר מגיע כך מהשאילתה (created_at desc), שאר האפשרויות דורסות אותו.
  // בכל מקרה שבו אין ערך (expires_at/last_activity_at ריקים) - הגלריה יורדת לסוף,
  // לא נעלמת ולא קופצת לראש בטעות בגלל date(0)/NaN.
  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sortBy === 'name') {
      return (a.clients?.full_name ?? '').localeCompare(b.clients?.full_name ?? '', 'he');
    }
    if (sortBy === 'expiry') {
      if (!a.expires_at && !b.expires_at) return 0;
      if (!a.expires_at) return 1;
      if (!b.expires_at) return -1;
      return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
    }
    if (sortBy === 'activity') {
      if (!a.last_activity_at && !b.last_activity_at) return 0;
      if (!a.last_activity_at) return 1;
      if (!b.last_activity_at) return -1;
      return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime();
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

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

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {[
            { label: 'סה"כ גלריות', value: totalCount, color: theme.text },
            { label: 'ממתינות לפעולה', value: pendingActionCount, color: theme.gold },
            { label: 'הושלמו', value: completedCount, color: theme.successText },
          ].map((stat) => (
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
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '-0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <p style={{ color: activeCount >= freeGalleryLimit ? theme.errorText : theme.textMuted, fontSize: 13, margin: 0 }}>
          {activeCount}/{freeGalleryLimit} גלריות פעילות (חשבון חינמי)
        </p>
        {rows.length > 0 && (
          <a href="/api/galleries/export-contacts" style={{ color: theme.textMuted, fontSize: 12, textDecoration: 'underline' }}>
            ייצוא רשימת אנשי קשר (CSV)
          </a>
        )}
      </div>

      {urgentRows.length > 0 && (
        <div style={{ background: theme.warningBg, border: `1px solid ${theme.warningText}`, borderRadius: 10, padding: '0.85rem 1rem' }}>
          <p style={{ color: theme.warningText, fontSize: 13, fontWeight: 'bold', margin: '0 0 0.5rem' }}>
            ⚠️ דורש תשומת לב - תוקף מתקרב
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {urgentRows.map((row) => {
              const daysLeft = Math.ceil((new Date(row.expires_at!).getTime() - Date.now()) / 86400000);
              const daysLabel = daysLeft <= 0 ? 'פג היום' : daysLeft === 1 ? 'נשאר יום אחד' : `נשארו ${daysLeft} ימים`;
              return (
                <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', fontSize: 13 }}>
                  <span>{row.clients?.full_name ?? 'ללא שם'} - {daysLabel}, נבחרו {row.selectedCount}/{row.packages?.included_photos ?? 0}</span>
                  <Link href={`/dashboard/galleries/${row.id}/edit`} style={{ color: theme.warningText, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                    שליחת תזכורת ←
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.25rem' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="חיפוש לפי שם לקוחה..."
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
          />
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(
              [
                ['all', 'הכל'],
                ['pending', 'ממתין לפתיחה'],
                ['in_progress', 'בבחירה'],
                ['completed', 'הושלם'],
                ['expired', 'באיחור'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                style={{
                  ...outlineButtonStyle, padding: '0.35rem 0.75rem', fontSize: 12,
                  borderColor: statusFilter === value ? theme.gold : theme.border,
                  color: statusFilter === value ? theme.gold : theme.textMuted,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            style={{ ...inputStyle, width: 'auto', padding: '0.35rem 0.6rem', fontSize: 12 }}
          >
            <option value="newest">מיון: החדשות ביותר</option>
            <option value="expiry">מיון: תוקף קרוב</option>
            <option value="activity">מיון: פעילות אחרונה</option>
            <option value="name">מיון: שם לקוחה (א-ת)</option>
          </select>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '0.75rem 1rem' }}>
          <span style={{ fontSize: 13 }}>{selectedIds.size} נבחרו</span>
          <button onClick={handleBulkReminder} disabled={bulkWorking} style={{ ...outlineButtonStyle, padding: '0.35rem 0.75rem', fontSize: 12, opacity: bulkWorking ? 0.6 : 1 }}>
            🔔 שליחת תזכורת לנבחרות
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkWorking}
            style={{ ...outlineButtonStyle, padding: '0.35rem 0.75rem', fontSize: 12, color: theme.errorText, borderColor: theme.errorText, opacity: bulkWorking ? 0.6 : 1 }}
          >
            {bulkWorking ? 'מבצעת...' : '🗑 מחיקת הנבחרות'}
          </button>
          <button onClick={() => setSelectedIds(new Set())} style={{ background: 'none', border: 'none', color: theme.textFaint, fontSize: 12, cursor: 'pointer', padding: 0 }}>
            ביטול בחירה
          </button>
        </div>
      )}

      {bulkMessage && (
        <p style={{ background: theme.successBg, color: theme.successText, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 13 }}>
          {bulkMessage}
        </p>
      )}

      {sortedRows.map((row) => {
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
            <input
              type="checkbox"
              checked={selectedIds.has(row.id)}
              onClick={(e) => toggleSelect(row.id, e)}
              onChange={() => {}}
              style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
              aria-label={`בחירת גלריה של ${row.clients?.full_name ?? 'ללא שם'} לפעולה מרוכזת`}
            />

            {coverUrls[row.id] ? (
              <img
                src={coverUrls[row.id]}
                alt=""
                style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div
                style={{
                  width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                  background: theme.bg, border: `1px solid ${theme.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, color: theme.textFaint,
                }}
              >
                📷
              </div>
            )}

            <span
              style={{
                padding: '0.25rem 0.75rem', border: `1px solid ${color}`, color,
                borderRadius: 16, fontSize: 13, whiteSpace: 'nowrap',
              }}
            >
              {statusLabel(status)}
            </span>

            {status === 'completed' && (
              <button
                onClick={(e) => handleToggleEditing(row, e)}
                disabled={togglingEditingId === row.id}
                title={row.editing_started_at ? 'לחצי כדי לבטל את סימון תחילת העריכה' : 'לחצי כשמתחילים לערוך את התמונות שנבחרו'}
                style={{
                  padding: '0.25rem 0.75rem', borderRadius: 16, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
                  border: `1px solid ${row.editing_started_at ? theme.gold : theme.border}`,
                  color: row.editing_started_at ? theme.gold : theme.textFaint,
                  background: 'transparent',
                  opacity: togglingEditingId === row.id ? 0.6 : 1,
                }}
              >
                {row.editing_started_at ? '🖌 בעריכה' : 'סימון כבעריכה'}
              </button>
            )}

            {status === 'completed' && (
              <button
                onClick={(e) => handleToggleDelivered(row, e)}
                disabled={togglingDeliveredId === row.id}
                title={row.delivered_at ? 'לחצי כדי לבטל את סימון המסירה' : 'לחצי אחרי שמסרת ללקוחה את התמונות הסופיות'}
                style={{
                  padding: '0.25rem 0.75rem', borderRadius: 16, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
                  border: `1px solid ${row.delivered_at ? theme.successText : theme.border}`,
                  color: row.delivered_at ? theme.successText : theme.textFaint,
                  background: 'transparent',
                  opacity: togglingDeliveredId === row.id ? 0.6 : 1,
                }}
              >
                {row.delivered_at ? '✓ נמסר' : 'סימון כנמסר'}
              </button>
            )}

            <button
              onClick={(e) => handleTogglePaid(row, e)}
              disabled={togglingPaidId === row.id}
              title={row.paid_at ? 'לחצי כדי לבטל את סימון התשלום' : 'לחצי אחרי שקיבלת תשלום על הגלריה הזו'}
              style={{
                padding: '0.25rem 0.75rem', borderRadius: 16, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
                border: `1px solid ${row.paid_at ? theme.gold : theme.border}`,
                color: row.paid_at ? theme.gold : theme.textFaint,
                background: 'transparent',
                opacity: togglingPaidId === row.id ? 0.6 : 1,
              }}
            >
              {row.paid_at ? '💰 שולם' : 'סימון כשולם'}
            </button>

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
      {rows.length > 0 && filteredRows.length === 0 && (
        <p style={{ color: theme.textMuted }}>אין גלריות שתואמות לחיפוש/סינון.</p>
      )}
    </div>
  );
}
