'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fetchGiftPhotos } from '@/lib/giftQueries';
import { giftExclusionFilter, groupGiftIdsByGallery } from '@/lib/gifts';
import { theme, goldButtonStyle, inputStyle, outlineButtonStyle } from '@/lib/theme';
import { computePaymentSummary, formatShekels } from '@/lib/payments';
import { galleryRevenue, sumShekels } from '@/lib/revenue';
import { canDeliverFinals, isReminderEligible } from '@/lib/galleryLifecycle';
import SetupChecklist from '@/components/SetupChecklist';
import SampleGalleryTag, { useSampleGalleryIds } from '@/components/SampleGalleryTag';

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
  reopened_for_selection_at: string | null;
  paid_at: string | null;
  owner_participant_id: string | null;
  clients: { full_name: string } | null;
  // packages.gallery_id הוא unique, אז PostgREST מחזיר יחס 1:1 - אובייקט בודד, לא מערך
  // (בניגוד ל-clients שגם הוא אובייקט בודד אבל מהצד "הרבים" של הקשר - גם לא מערך)
  packages: { included_photos: number; base_price: number; extra_photo_price: number } | null;
  // מעקב תשלומים - ראו lib/payments.ts. null = הסכום לתשלום מחושב מהחבילה.
  amount_due_override: number | null;
  gallery_payments: { amount: number }[] | null;
  selectedCount: number;
}

function rowRevenue(row: GalleryRow) {
  return galleryRevenue({ pkg: row.packages, selectedCount: row.selectedCount, amountDueOverride: row.amount_due_override });
}

function rowPaymentSummary(row: GalleryRow) {
  return computePaymentSummary({
    pkg: row.packages,
    selectedCount: row.selectedCount,
    amountDueOverride: row.amount_due_override,
    payments: row.gallery_payments,
    paidAt: row.paid_at,
  });
}

export default function GalleriesDashboard() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const sampleIds = useSampleGalleryIds(rows.length);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'expired'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'expiry' | 'activity' | 'name'>('newest');
  const [loadError, setLoadError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkError, setBulkError] = useState(false);
  const [togglingEditingId, setTogglingEditingId] = useState<string | null>(null);
  const [togglingDeliveredId, setTogglingDeliveredId] = useState<string | null>(null);
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  // גלריות עם בקשת הארכה ממתינה מהלקוחה (gallery_extension_requests) - תג בלבד
  const [pendingExtensionIds, setPendingExtensionIds] = useState<Set<string>>(new Set());
  // photographers.is_unlimited - פטורה ממגבלת החשבון החינמי
  const [isUnlimited, setIsUnlimited] = useState(false);

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

    // שולחים את הערך הרצוי (לא "הפוך") - לחיצה כפולה/לשונית ישנה לא תהפוך שוב
    try {
      const res = await fetch(`/api/galleries/${row.id}/toggle-editing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: !row.editing_started_at }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, editing_started_at: data.editingStartedAt } : r)));
    } catch {
      // שגיאת רשת - הסימון פשוט לא משתנה
    } finally {
      setTogglingEditingId(null);
    }
  }

  async function handleToggleDelivered(row: GalleryRow, e: React.MouseEvent) {
    e.stopPropagation();
    setTogglingDeliveredId(row.id);

    // שולחים את הערך הרצוי (לא "הפוך") - לחיצה כפולה/לשונית ישנה לא תהפוך שוב
    try {
      const res = await fetch(`/api/galleries/${row.id}/toggle-delivered`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: !row.delivered_at }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error) window.alert(data.error);
        return;
      }
      const data = await res.json();
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, delivered_at: data.deliveredAt } : r)));
    } catch {
      // שגיאת רשת - הסימון פשוט לא משתנה
    } finally {
      setTogglingDeliveredId(null);
    }
  }

  async function handleTogglePaid(row: GalleryRow, e: React.MouseEvent) {
    e.stopPropagation();
    setTogglingPaidId(row.id);

    // שולחים את הערך הרצוי (לא "הפוך") - לחיצה כפולה/לשונית ישנה לא תהפוך שוב
    try {
      const res = await fetch(`/api/galleries/${row.id}/toggle-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: !row.paid_at }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, paid_at: data.paidAt } : r)));
    } catch {
      // שגיאת רשת - הסימון פשוט לא משתנה
    } finally {
      setTogglingPaidId(null);
    }
  }

  // פעולות מרוכזות - לולאה על ה-API הקיים של פריט בודד (לא route חדש) - פשוט
  // ובטוח יותר מ-endpoint מרוכז חדש, והכמות (כמה גלריות יש לצלמת אחת) קטנה
  // מספיק שזה לא בעיית ביצועים.
  //
  // פועלות רק על נבחרות שגלויות עכשיו ברשימה המסוננת (visibleSelectedRows):
  // גלריה שסומנה ואז הוסתרה בחיפוש/סינון לא תימחק "בהפתעה" - מחיקה לצמיתות
  // רק של מה שהצלמת רואה. הנבחרות המוסתרות מוצגות בסרגל ונשארות מסומנות.
  async function handleBulkDelete() {
    const targets = visibleSelectedRows;
    if (targets.length === 0) return;
    if (!window.confirm(`למחוק ${targets.length} גלריות? כל התמונות, הבחירות והיסטוריית התשלומים שלהן יימחקו לצמיתות - אי אפשר לבטל את זה.`)) return;

    setBulkWorking(true);
    setBulkMessage('');
    setBulkError(false);
    let succeeded = 0;

    try {
      for (const row of targets) {
        try {
          const res = await fetch(`/api/galleries/${row.id}`, { method: 'DELETE' });
          if (res.ok) succeeded++;
        } catch {
          // שגיאת רשת בגלריה אחת - נספרת ככישלון, ממשיכים לבאות
        }
      }
    } finally {
      setBulkWorking(false);
      setBulkError(succeeded < targets.length);
      setBulkMessage(
        succeeded < targets.length
          ? `נמחקו ${succeeded} מתוך ${targets.length} גלריות - המחיקה של ${targets.length - succeeded} נכשלה, נסי שוב`
          : `נמחקו ${succeeded} מתוך ${targets.length} גלריות`
      );
      // רק את מה שטופל - נבחרות מוסתרות נשארות מסומנות
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const row of targets) next.delete(row.id);
        return next;
      });
      await loadGalleries();
    }
  }

  async function handleBulkReminder() {
    if (visibleSelectedRows.length === 0) return;

    // רק גלריות שהלקוחה עדיין בוחרת בהן (sent/in_progress, או שנפתחה מחדש)
    // עם תוקף עתידי - אותם תנאים כמו app/api/galleries/[id]/send-reminder,
    // ראו isReminderEligible ב-lib/galleryLifecycle.ts.
    const now = new Date();
    const selectedRows = visibleSelectedRows;
    const eligible = selectedRows.filter((r) => isReminderEligible(r, now));
    const skipped = selectedRows.length - eligible.length;
    if (eligible.length === 0) {
      setBulkError(true);
      setBulkMessage('אין בבחירה גלריות שהלקוחה עדיין בוחרת בהן עם תוקף עתידי - אי אפשר לשלוח תזכורת');
      return;
    }

    setBulkWorking(true);
    setBulkMessage('');
    setBulkError(false);
    let sent = 0;
    // 429 = מגבלת הקצב של שליחה ידנית (lib/manualEmailCooldown.ts) - תזכורת
    // נשלחה לגלריה הזו ממש עכשיו או יותר מדי פעמים היום; נספרות בנפרד.
    let rateLimited = 0;
    let failed = 0;

    try {
      for (const row of eligible) {
        try {
          const res = await fetch(`/api/galleries/${row.id}/send-reminder`, { method: 'POST' });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.emailSent) sent++;
          } else if (res.status === 429) {
            rateLimited++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
    } finally {
      setBulkWorking(false);
      setBulkError(failed > 0);
      setBulkMessage(
        `נשלחו ${sent} מתוך ${eligible.length} תזכורות` +
          (skipped > 0 ? ` (דולגו ${skipped} גלריות שהושלמו, שפג תוקפן או שאין להן תוקף)` : '') +
          (rateLimited > 0 ? ` (${rateLimited} דולגו כי תזכורת נשלחה אליהן לפני רגע או יותר מדי פעמים היום)` : '') +
          (failed > 0 ? ` (${failed} נכשלו - נסי שוב)` : '')
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const row of selectedRows) next.delete(row.id);
        return next;
      });
    }
  }

  async function loadGalleries() {
    setLoading(true);
    setLoadError('');

    const { data: galleries, error } = await supabase
      .from('galleries')
      .select('id, status, created_at, expires_at, last_activity_at, last_reminder_sent_at, sent_at, editing_started_at, delivered_at, paid_at, reopened_for_selection_at, owner_participant_id, amount_due_override, clients(full_name), packages(included_photos, base_price, extra_photo_price), gallery_payments(amount)')
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
    // תמונות מתנה (lib/gifts.ts) לא נספרות - שאילתה אחת לכל הגלריות, best-effort.
    const giftIdsByGallery = groupGiftIdsByGallery(await fetchGiftPhotos(supabase, galleries.map((g: any) => g.id)));
    const rowsWithCounts = await Promise.all(
      galleries.map(async (g: any) => {
        let query = supabase
          .from('selections')
          .select('*', { count: 'exact', head: true })
          .eq('gallery_id', g.id)
          .eq('participant_id', g.owner_participant_id)
          .eq('status', 'selected');
        const giftFilter = giftExclusionFilter(giftIdsByGallery.get(g.id) ?? []);
        if (giftFilter) query = query.not('photo_id', 'in', giftFilter);
        const { count } = await query;

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

    // best-effort: בלי זה פשוט מתנהגים כחשבון חינמי (כמו קודם)
    supabase
      .from('photographers')
      .select('is_unlimited')
      .maybeSingle()
      .then(({ data }) => setIsUnlimited(!!(data as { is_unlimited?: boolean } | null)?.is_unlimited), () => {});

    // best-effort: טבלה חסרה (מיגרציה שלא רצה) / שגיאה = פשוט בלי תגים
    supabase
      .from('gallery_extension_requests')
      .select('gallery_id')
      .eq('status', 'pending')
      .then(({ data, error }) => {
        if (!error && data) setPendingExtensionIds(new Set(data.map((r: { gallery_id: string }) => r.gallery_id)));
      }, () => {});
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
  // צלמת עם מנוי (is_unlimited) פטורה מהמגבלה - לא מציגים לה את ההודעה
  const freeLimitReached = !isUnlimited && activeCount >= freeGalleryLimit;

  // סה"כ הכנסה = הסכום לתשלום של כל הגלריות (לא רק פעילות - בדרך כלל גובים
  // על החבילה בזמן ההזמנה), כולל דריסה ידנית של הסכום, באגורות שלמות - ראו
  // lib/revenue.ts. חריגות = רק בגלריות בלי דריסה ידנית.
  const totalRevenue = sumShekels(rows.map((row) => rowRevenue(row).total));
  const totalOverage = sumShekels(rows.map((row) => rowRevenue(row).overage));

  // כמה עוד נשאר לגבות מכל הגלריות יחד (יתרות פתוחות בלבד - גלריה שסומנה
  // כשולמה, גם ידנית, לא נספרת) - ראו outstanding ב-lib/payments.ts.
  const owingCount = rows.filter((row) => rowPaymentSummary(row).outstanding > 0).length;
  const totalOutstanding = rows.reduce((sum, row) => sum + rowPaymentSummary(row).outstanding, 0);

  // חיפוש/סינון על מה שכבר נטען - אין קריאת API נוספת, רשימת הגלריות של צלמת
  // בודדת קטנה מספיק שסינון בצד לקוח מספיק. הכותרת (הכנסה, יתרה לגבייה) נשארת
  // מחושבת על כל הגלריות תמיד, לא רק על התוצאה המסוננת - זה סיכום כללי, לא "לפי מסך".
  const filteredRows = rows.filter((row) => {
    const status = effectiveStatus(row);
    const bucket = status === 'draft' || status === 'sent' ? 'pending' : status;
    const matchesStatus = statusFilter === 'all' || bucket === statusFilter;
    const matchesSearch = !searchQuery.trim() || (row.clients?.full_name ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // נבחרות שגלויות כרגע (הפעולות המרוכזות פועלות רק עליהן) מול נבחרות שהוסתרו
  // בחיפוש/סינון אחרי שסומנו - ראו ההערה מעל handleBulkDelete.
  const visibleSelectedRows = filteredRows.filter((row) => selectedIds.has(row.id));
  const hiddenSelectedCount = selectedIds.size - visibleSelectedRows.length;

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
      <SetupChecklist />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>הגלריות שלי</h1>
          {totalRevenue > 0 && (
            <p style={{ color: theme.gold, fontSize: 13, margin: '0.25rem 0 0' }}>
              סה"כ הכנסה: {formatShekels(totalRevenue)}
              {totalOverage > 0 && ` (מתוכה חריגות: ${formatShekels(totalOverage)})`}
            </p>
          )}
          {totalOutstanding > 0 && (
            <p style={{ color: theme.warningText, fontSize: 13, margin: '0.15rem 0 0' }}>
              נותר לגבות: {formatShekels(totalOutstanding)} מ-{owingCount} {owingCount === 1 ? 'לקוחה' : 'לקוחות'}{' '}
              <Link href="/dashboard/reports" style={{ color: theme.textMuted, fontSize: 12 }}>
                (פירוט בדוחות)
              </Link>
            </p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
          <Link href="/dashboard/galleries/new" style={{ ...goldButtonStyle, textDecoration: 'none' }}>
            + גלריה חדשה
          </Link>
          {/* רק כשהמגבלה הושגה - המונה המלא (X/Y פעילות) וייצוא אנשי הקשר עברו להגדרות */}
          {freeLimitReached && (
            <p style={{ color: theme.errorText, fontSize: 12, margin: 0, maxWidth: 240, textAlign: 'left' }}>
              הגעת למגבלת הגלריות הפעילות בחשבון החינמי ({activeCount}/{freeGalleryLimit})
            </p>
          )}
        </div>
      </div>

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
          <span style={{ fontSize: 13 }}>
            {visibleSelectedRows.length} נבחרו
            {hiddenSelectedCount > 0 && (
              <span style={{ color: theme.textFaint }}> · {hiddenSelectedCount} נבחרות מוסתרות בסינון (לא ייכללו)</span>
            )}
          </span>
          <button onClick={handleBulkReminder} disabled={bulkWorking || visibleSelectedRows.length === 0} style={{ ...outlineButtonStyle, padding: '0.35rem 0.75rem', fontSize: 12, opacity: bulkWorking || visibleSelectedRows.length === 0 ? 0.6 : 1 }}>
            🔔 שליחת תזכורת לנבחרות
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkWorking || visibleSelectedRows.length === 0}
            style={{ ...outlineButtonStyle, padding: '0.35rem 0.75rem', fontSize: 12, color: theme.errorText, borderColor: theme.errorText, opacity: bulkWorking || visibleSelectedRows.length === 0 ? 0.6 : 1 }}
          >
            {bulkWorking ? 'מבצעת...' : '🗑 מחיקת הנבחרות'}
          </button>
          <button onClick={() => setSelectedIds(new Set())} style={{ background: 'none', border: 'none', color: theme.textFaint, fontSize: 12, cursor: 'pointer', padding: 0 }}>
            ביטול בחירה
          </button>
        </div>
      )}

      {bulkMessage && (
        <p
          style={{
            background: bulkError ? theme.errorBg : theme.successBg,
            color: bulkError ? theme.errorText : theme.successText,
            padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 13,
          }}
        >
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
        const overagePrice = Number(row.packages?.extra_photo_price ?? 0);
        const overageTotal = rowRevenue(row).overage;
        const payment = rowPaymentSummary(row);

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

            {pendingExtensionIds.has(row.id) && (
              <span
                title="הלקוחה ביקשה הארכה - לאישור או דחייה בדף עריכת הגלריה"
                style={{ padding: '0.25rem 0.75rem', borderRadius: 16, fontSize: 12, whiteSpace: 'nowrap', border: `1px solid ${theme.gold}`, color: theme.gold }}
              >
                ⏳ בקשת הארכה
              </span>
            )}

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

            {/* מסירה מתחילה את ספירת 30 הימים למחיקת המקור - חסום כשהבחירה
                נפתחה מחדש ללקוחה (ביטול סימון קיים תמיד מותר). */}
            {status === 'completed' && (
              <button
                onClick={(e) => handleToggleDelivered(row, e)}
                disabled={togglingDeliveredId === row.id || (!row.delivered_at && !canDeliverFinals(row))}
                title={
                  row.delivered_at
                    ? 'לחצי כדי לבטל את סימון המסירה'
                    : !canDeliverFinals(row)
                      ? 'הבחירה פתוחה מחדש ללקוחה - אפשר לסמן כנמסר רק אחרי שתסיים לבחור שוב'
                      : 'לחצי אחרי שמסרת ללקוחה את התמונות הסופיות'
                }
                style={{
                  padding: '0.25rem 0.75rem', borderRadius: 16, fontSize: 12, whiteSpace: 'nowrap',
                  cursor: !row.delivered_at && !canDeliverFinals(row) ? 'not-allowed' : 'pointer',
                  border: `1px solid ${row.delivered_at ? theme.successText : theme.border}`,
                  color: row.delivered_at ? theme.successText : theme.textFaint,
                  background: 'transparent',
                  opacity: togglingDeliveredId === row.id || (!row.delivered_at && !canDeliverFinals(row)) ? 0.5 : 1,
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
                  מחיר חבילה: {formatShekels(Number(row.packages.base_price))}
                </div>
              )}
              {overageCount > 0 && (
                <div style={{ fontSize: 12, color: theme.gold, marginTop: '0.15rem' }}>
                  חריגה: {overageCount} תמונות{overagePrice > 0 && !payment.isOverridden ? ` (${formatShekels(overageTotal)})` : ''}
                </div>
              )}
              {payment.paymentCount > 0 && (
                <div style={{ fontSize: 12, color: theme.textMuted, marginTop: '0.15rem' }}>
                  שולם {formatShekels(payment.paid)} מתוך {formatShekels(payment.total)}
                </div>
              )}
              {payment.outstanding > 0 && (
                <div style={{ fontSize: 12, color: theme.warningText, fontWeight: 'bold', marginTop: '0.15rem' }}>
                  יתרה לתשלום: {formatShekels(payment.outstanding)}
                </div>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 'bold' }}>{row.clients?.full_name ?? 'ללא שם'}{sampleIds.has(row.id) && <SampleGalleryTag />}</div>
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
