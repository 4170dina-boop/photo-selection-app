'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { theme, outlineButtonStyle, goldButtonStyle } from '@/lib/theme';
import { formatShekels } from '@/lib/payments';
import { toHebrewDateString } from '@/lib/hebrewDate';
import { formatIsraelDate } from '@/lib/israelTime';
import { PAYMENT_METHOD_ICONS, isPaymentMethodType, paymentMethodLabel } from '@/lib/paymentMethods';
import {
  buildTodayView,
  daysSince,
  daysUntilExpiry,
  editingProgress,
  isSelectingNow,
  lastClientActivityAt,
  TODAY_SECTION_ORDER,
  wazeUrl,
  googleMapsUrl,
  type TodayGalleryRow,
  type TodayItem,
  type TodaySection,
  type TodayShoot,
} from '@/lib/todayDashboard';

// מסך הנחיתה של הצלמת אחרי התחברות: רק מה שדורש ממנה פעולה עכשיו, מסודר לפי
// דחיפות. כל גלריה מופיעה במקטע אחד (הדחוף ביותר, ראו lib/todayDashboard.ts),
// ושאר המצבים שלה כתגיות קטנות. מקטע ריק לא מוצג בכלל. רשימת הגלריות המלאה
// (חיפוש/סינון/פעולות מרוכזות) נשארת ב"הגלריות שלי".

const SECTION_META: Record<TodaySection, { title: string; tag: string }> = {
  extension: { title: '⏳ בקשות הארכה', tag: '⏳ ביקשה הארכה' },
  expiring: { title: '⚠️ עומדות לפוג', tag: '⚠️ עומדת לפוג' },
  finished: { title: '🔔 סיימו לבחור', tag: '🔔 סיימה לבחור' },
  editing: { title: '✏️ תור עריכה', tag: '✏️ בעריכה' },
  stalled: { title: '🐢 נעצרו באמצע', tag: '🐢 נעצרה באמצע' },
  payment: { title: '💰 ממתין לתשלום', tag: '💰 ממתין לתשלום' },
};

// אין עדיין בהגדרות "ימי מסירה" - null = מציגים רק כמה ימים בעריכה.
// כשתתווסף הגדרה כזו, מספיק להעביר אותה ל-editingProgress.
const DEFAULT_DELIVERY_DAYS: number | null = null;

const TOAST_MS = 5000;

type KpiFilter = 'payment' | 'selecting' | null;

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
  undo?: () => void;
}

function daysWord(n: number): string {
  if (n === 0) return 'היום';
  if (n === 1) return 'אתמול';
  if (n === 2) return 'שלשום';
  return `לפני ${n} ימים`;
}

function expiryLabel(daysLeft: number | null): string {
  if (daysLeft === null) return '';
  const whole = Math.ceil(daysLeft);
  if (whole <= 0) return 'פג היום';
  if (whole === 1) return 'נשאר יום אחד';
  return `נשארו ${whole} ימים`;
}

const smallButton: CSSProperties = { ...outlineButtonStyle, padding: '0.45rem 0.85rem', fontSize: 13, whiteSpace: 'nowrap' };
const primaryButton: CSSProperties = { ...goldButtonStyle, padding: '0.45rem 0.9rem', fontSize: 13, whiteSpace: 'nowrap' };
const linkButton: CSSProperties = { ...smallButton, textDecoration: 'none', display: 'inline-block' };

export default function TodayPage() {
  const [galleries, setGalleries] = useState<TodayGalleryRow[]>([]);
  const [shoots, setShoots] = useState<TodayShoot[]>([]);
  const [days, setDays] = useState<{ today: string; tomorrow: string }>({ today: '', tomorrow: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<KpiFilter>(null);
  // פעולה שרצה כרגע על שורה (מונע לחיצה כפולה)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  // תזכורות שנשלחו בהצלחה בישיבה הזו - הכפתור נשאר "נשלח ✓"
  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/dashboard/today');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error ?? 'טעינת הנתונים נכשלה');
        return;
      }
      setGalleries(data.galleries ?? []);
      setShoots(data.shoots ?? []);
      setDays({ today: data.today ?? '', tomorrow: data.tomorrow ?? '' });
      setNow(new Date());
    } catch {
      setLoadError('אין חיבור לשרת - בדקי את החיבור לאינטרנט');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function showToast(message: string, tone: Toast['tone'] = 'success', undo?: () => void) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const id = Date.now();
    setToast({ id, message, tone, undo });
    toastTimer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), TOAST_MS);
  }

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function patchGallery(id: string, patch: Partial<TodayGalleryRow>) {
    setGalleries((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  const view = useMemo(() => buildTodayView(galleries, now), [galleries, now]);

  // ---------- פעולות מהירות (עדכון אופטימי + toast) ----------

  // שולחים את הערך הרצוי (לא "הפוך") - כמו ברשימת הגלריות. ביטול = שליחת
  // הערך ההפוך, אז זו הפעולה היחידה כאן שיש לה "ביטול" אמיתי.
  async function setEditing(row: TodayGalleryRow, value: boolean, withUndo: boolean) {
    const previous = row.editing_started_at;
    setBusy(row.id, true);
    patchGallery(row.id, { editing_started_at: value ? new Date().toISOString() : null });
    try {
      const res = await fetch(`/api/galleries/${row.id}/toggle-editing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchGallery(row.id, { editing_started_at: previous });
        showToast(data.error ?? 'העדכון נכשל - נסי שוב', 'error');
        return;
      }
      patchGallery(row.id, { editing_started_at: data.editingStartedAt ?? null });
      if (withUndo) {
        showToast('בוצע ✓', 'success', () => setEditing({ ...row, editing_started_at: data.editingStartedAt ?? null }, !value, false));
      } else {
        showToast('בוטל ✓');
      }
    } catch {
      patchGallery(row.id, { editing_started_at: previous });
      showToast('אין חיבור לשרת - נסי שוב', 'error');
    } finally {
      setBusy(row.id, false);
    }
  }

  // שליחת מייל אי אפשר "להחזיר" - רק "נשלח ✓". מגבלת הקצב (429) של השרת
  // מוצגת כמו שהיא (lib/manualEmailCooldown.ts).
  async function sendReminder(row: TodayGalleryRow) {
    setBusy(row.id, true);
    setRemindedIds((prev) => new Set(prev).add(row.id));
    const revert = () =>
      setRemindedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    try {
      const res = await fetch(`/api/galleries/${row.id}/send-reminder`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        revert();
        showToast(data.error ?? 'שליחת התזכורת נכשלה', 'error');
        return;
      }
      if (!data.emailSent) {
        revert();
        showToast('המייל לא נשלח - נסי שוב בעוד רגע', 'error');
        return;
      }
      showToast('נשלח ✓');
    } catch {
      revert();
      showToast('אין חיבור לשרת - נסי שוב', 'error');
    } finally {
      setBusy(row.id, false);
    }
  }

  // אישור/דחייה שולחים מייל ללקוחה - אין "ביטול". דחייה מבקשת אישור קודם.
  async function decideExtension(row: TodayGalleryRow, action: 'approve' | 'decline') {
    const request = row.pendingExtension;
    if (!request) return;
    if (action === 'decline' && !window.confirm(`לדחות את בקשת ההארכה של ${row.clientName || 'הלקוחה'}? הלקוחה תקבל על כך מייל.`)) return;

    setBusy(row.id, true);
    patchGallery(row.id, { pendingExtension: null });
    try {
      const res = await fetch(`/api/galleries/${row.id}/extension-requests/${request.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = כבר הוחלט (לשונית אחרת) - לא מחזירים את הבקשה, רק מרעננים
        if (res.status === 409) {
          showToast(data.error ?? 'כבר הוחלט על הבקשה הזו', 'error');
          load();
        } else {
          patchGallery(row.id, { pendingExtension: request });
          showToast(data.error ?? 'העדכון נכשל - נסי שוב', 'error');
        }
        return;
      }
      if (action === 'approve') {
        patchGallery(row.id, {
          expires_at: data.expiresAt ?? row.expires_at,
          ...(data.galleryStatus ? { status: data.galleryStatus } : {}),
        });
        showToast(`ההארכה אושרה ✓ (${request.days} ימים)`);
      } else {
        showToast('הבקשה נדחתה ✓');
      }
    } catch {
      patchGallery(row.id, { pendingExtension: request });
      showToast('אין חיבור לשרת - נסי שוב', 'error');
    } finally {
      setBusy(row.id, false);
    }
  }

  function toggleFilter(next: Exclude<KpiFilter, null>) {
    setFilter((current) => (current === next ? null : next));
    // גלילה למקטעים (במובייל ה-KPI תופסים את כל המסך העליון)
    setTimeout(() => sectionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  // ---------- תצוגה ----------

  const gregorian = new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(now);

  const header = (
    <p style={{ color: theme.textMuted, fontSize: 14, margin: '0 0 1rem' }}>
      {gregorian} · {toHebrewDateString(now)}
    </p>
  );

  if (loading && galleries.length === 0) {
    return (
      <div>
        {header}
        <p style={{ color: theme.textMuted }}>טוען...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        {header}
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
          {loadError}
        </p>
        <button onClick={load} style={outlineButtonStyle}>
          נסי שוב
        </button>
      </div>
    );
  }

  const matchesFilter = (item: TodayItem) => {
    if (filter === 'payment') return item.gallery.outstanding > 0;
    if (filter === 'selecting') return isSelectingNow(item.gallery, now);
    return true;
  };

  const rowsById = new Map(galleries.map((g) => [g.id, g]));
  const nothingToDo = view.totalItems === 0;

  function renderDetails(item: TodayItem, row: TodayGalleryRow): ReactNode {
    const g = item.gallery;
    const picked = row.includedPhotos > 0 ? `נבחרו ${g.selectedCount}/${row.includedPhotos}` : `נבחרו ${g.selectedCount}`;
    switch (item.section) {
      case 'extension':
        return (
          <>
            ביקשה הארכה של {g.pendingExtension?.days} ימים
            {g.expires_at ? ` · התוקף כרגע עד ${formatIsraelDate(g.expires_at)}` : ''}
          </>
        );
      case 'expiring':
        return (
          <>
            {expiryLabel(daysUntilExpiry(g, now))} · {picked}
          </>
        );
      case 'finished': {
        const d = daysSince(g.last_activity_at, now);
        return (
          <>
            {d !== null ? `סיימה ${daysWord(d)}` : 'סיימה לבחור'} · {g.selectedCount} תמונות
          </>
        );
      }
      case 'editing': {
        const p = editingProgress(g.editing_started_at!, now, DEFAULT_DELIVERY_DAYS);
        const inEditing = p.daysInEditing === 0 ? 'התחלת לערוך היום' : p.daysInEditing === 1 ? 'יום אחד בעריכה' : `${p.daysInEditing} ימים בעריכה`;
        return (
          <>
            {inEditing} · {g.selectedCount} תמונות
            {p.dueDate && p.daysLeft !== null && (
              <span style={{ color: p.daysLeft < 0 ? theme.errorText : theme.textMuted }}>
                {' '}· {p.daysLeft < 0 ? `באיחור של ${-p.daysLeft} ימים` : `יעד מסירה ${formatIsraelDate(`${p.dueDate}T12:00:00Z`)}`}
              </span>
            )}
          </>
        );
      }
      case 'stalled': {
        const d = daysSince(lastClientActivityAt(g), now);
        return (
          <>
            {picked} · פעילות אחרונה {d !== null ? daysWord(d) : 'לא ידועה'}
          </>
        );
      }
      case 'payment':
        return (
          <>
            <span style={{ color: theme.warningText, fontWeight: 'bold' }}>יתרה לתשלום: {formatShekels(g.outstanding)}</span>
            {/* מה שהלקוחה בחרה ב"איך נוח לך לשלם?" (components/ClientPayButton.tsx) */}
            {isPaymentMethodType(row.paymentChoice) && (
              <span
                title="הלקוחה בחרה לשלם"
                style={{
                  marginInlineStart: '0.5rem', fontSize: 12, padding: '0.1rem 0.5rem', borderRadius: 999,
                  border: `1px solid ${theme.borderLight}`, color: theme.text, whiteSpace: 'nowrap',
                }}
              >
                {PAYMENT_METHOD_ICONS[row.paymentChoice]} {paymentMethodLabel(row.paymentChoice)}
              </span>
            )}
          </>
        );
    }
  }

  function renderActions(item: TodayItem, row: TodayGalleryRow): ReactNode {
    const busy = busyIds.has(row.id);
    const dim = { opacity: busy ? 0.6 : 1 };
    const reminded = remindedIds.has(row.id);
    switch (item.section) {
      case 'extension':
        return (
          <>
            <button onClick={() => decideExtension(row, 'approve')} disabled={busy} style={{ ...primaryButton, ...dim }}>
              אישור
            </button>
            <button onClick={() => decideExtension(row, 'decline')} disabled={busy} style={{ ...smallButton, ...dim }}>
              דחייה
            </button>
          </>
        );
      case 'expiring':
      case 'stalled':
        // תזכורת דורשת תוקף עתידי (app/api/galleries/[id]/send-reminder) -
        // גלריה "נעצרה" בלי תוקף מקבלת רק קישור לגלריה
        if (!row.expires_at) return null;
        return (
          <button onClick={() => sendReminder(row)} disabled={busy || reminded} style={{ ...(item.section === 'expiring' ? primaryButton : smallButton), ...dim }}>
            {reminded ? 'נשלח ✓' : item.section === 'expiring' ? 'שליחת תזכורת' : 'תזכורת עדינה'}
          </button>
        );
      case 'finished':
        return (
          <button onClick={() => setEditing(row, true, true)} disabled={busy} style={{ ...primaryButton, ...dim }}>
            התחלתי לערוך
          </button>
        );
      case 'editing':
        return (
          <Link href={`/dashboard/galleries/${row.id}/edit`} style={linkButton}>
            מסירת תמונות
          </Link>
        );
      case 'payment':
        return (
          <Link href={`/dashboard/galleries/${row.id}/edit#payments`} style={linkButton}>
            רישום תשלום
          </Link>
        );
    }
  }

  function renderTag(section: TodaySection, g: TodayItem['gallery']) {
    const label = section === 'payment' ? `💰 ${formatShekels(g.outstanding)}` : SECTION_META[section].tag;
    return (
      <span
        key={section}
        style={{ padding: '0.1rem 0.55rem', borderRadius: 12, fontSize: 11.5, border: `1px solid ${theme.borderLight}`, color: theme.textMuted, whiteSpace: 'nowrap' }}
      >
        {label}
      </span>
    );
  }

  const visibleSections = TODAY_SECTION_ORDER.map((section) => ({
    section,
    items: view.sections[section].filter(matchesFilter),
  })).filter((s) => s.items.length > 0);

  const kpiStyle = (active: boolean): CSSProperties => ({
    flex: '1 1 150px',
    background: theme.panel,
    border: `1px solid ${active ? theme.gold : theme.border}`,
    borderRadius: 10,
    padding: '0.85rem 1rem',
    textAlign: 'center',
    cursor: 'pointer',
    color: theme.text,
    fontFamily: theme.fontSans,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {header}

      {nothingToDo ? (
        <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '2rem 1rem', textAlign: 'center' }}>
          <p style={{ fontFamily: theme.fontSerif, fontSize: 22, margin: 0 }}>הכול זורם 💛</p>
          <p style={{ color: theme.textMuted, fontSize: 14, margin: '0.5rem 0 0' }}>
            {view.selectingCount === 0
              ? 'אין כרגע לקוחות באמצע בחירה'
              : view.selectingCount === 1
                ? 'לקוחה אחת בוחרת עכשיו'
                : `${view.selectingCount} לקוחות בוחרות עכשיו`}
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button onClick={() => toggleFilter('payment')} style={kpiStyle(filter === 'payment')} aria-pressed={filter === 'payment'}>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: view.outstandingTotal > 0 ? theme.warningText : theme.text }}>
                {formatShekels(view.outstandingTotal)}
              </div>
              <div style={{ fontSize: 12, color: theme.textMuted, marginTop: '0.15rem' }}>ממתין לתשלום</div>
            </button>
            <button onClick={() => toggleFilter('selecting')} style={kpiStyle(filter === 'selecting')} aria-pressed={filter === 'selecting'}>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: theme.gold }}>{view.selectingCount}</div>
              <div style={{ fontSize: 12, color: theme.textMuted, marginTop: '0.15rem' }}>לקוחות בוחרות עכשיו</div>
            </button>
          </div>

          <div ref={sectionsRef} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', scrollMarginTop: '1rem' }}>
            {filter && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13, color: theme.textMuted }}>
                מוצגות רק {filter === 'payment' ? 'גלריות עם יתרה לתשלום' : 'לקוחות שבוחרות עכשיו'}
                <button onClick={() => setFilter(null)} style={{ background: 'none', border: 'none', color: theme.gold, cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>
                  הצגת הכול
                </button>
              </div>
            )}

            {filter && visibleSections.length === 0 && (
              <p style={{ color: theme.textMuted, fontSize: 14, margin: 0 }}>אין כרגע מה להציג בסינון הזה.</p>
            )}

            {visibleSections.map(({ section, items }) => (
              <section key={section}>
                <h2 style={{ fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 17, margin: '0 0 0.5rem' }}>
                  {SECTION_META[section].title} <span style={{ color: theme.textFaint, fontSize: 14 }}>({items.length})</span>
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {items.map((item) => {
                    const row = rowsById.get(item.gallery.id);
                    if (!row) return null;
                    return (
                      <div
                        key={row.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem',
                          background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '0.75rem 1rem',
                        }}
                      >
                        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <Link href={`/dashboard/galleries/${row.id}/edit`} style={{ color: theme.text, fontWeight: 'bold', textDecoration: 'none' }}>
                              {row.clientName || 'ללא שם'}
                            </Link>
                            {item.tags.map((t) => renderTag(t, item.gallery))}
                          </div>
                          <div style={{ fontSize: 13, color: theme.textMuted, marginTop: '0.2rem' }}>{renderDetails(item, row)}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{renderActions(item, row)}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {shoots.length > 0 && (
        <section style={{ marginTop: '0.5rem' }}>
          <h2 style={{ fontFamily: theme.fontSerif, fontWeight: 500, fontSize: 17, margin: '0 0 0.5rem' }}>📅 היום ומחר</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {shoots.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem',
                  background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '0.75rem 1rem',
                }}
              >
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontWeight: 'bold' }}>
                    {s.shoot_date === days.today ? 'היום' : s.shoot_date === days.tomorrow ? 'מחר' : formatIsraelDate(`${s.shoot_date}T12:00:00Z`)}{' '}
                    {s.start_time.slice(0, 5)} · {s.clientName || 'ללא שם'}
                  </div>
                  <div style={{ fontSize: 13, color: theme.textMuted, marginTop: '0.2rem', overflowWrap: 'anywhere' }}>{s.location}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {s.location.trim() && (
                    <a href={wazeUrl(s.location)} target="_blank" rel="noopener noreferrer" style={linkButton}>
                      ניווט ב-Waze
                    </a>
                  )}
                  {s.location.trim() && (
                    <a href={googleMapsUrl(s.location)} target="_blank" rel="noopener noreferrer" style={linkButton}>
                      Google Maps
                    </a>
                  )}
                  <Link href="/dashboard/calendar" style={linkButton}>
                    ליומן
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
            maxWidth: 'calc(100vw - 32px)', display: 'flex', alignItems: 'center', gap: '0.75rem',
            background: theme.panel,
            border: `1px solid ${toast.tone === 'error' ? theme.errorText : theme.borderLight}`,
            color: toast.tone === 'error' ? theme.errorText : theme.text,
            borderRadius: 10, padding: '0.65rem 1rem', fontSize: 14, boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <span>{toast.message}</span>
          {toast.undo && (
            <>
              <span style={{ color: theme.textFaint }}>·</span>
              <button
                onClick={() => {
                  const undo = toast.undo;
                  setToast(null);
                  undo?.();
                }}
                style={{ background: 'none', border: 'none', color: theme.gold, cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: 0 }}
              >
                ביטול
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
