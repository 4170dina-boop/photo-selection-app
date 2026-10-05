'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { israelDateString, daysBetweenDateStrings } from '@/lib/israelTime';
import {
  buildMonthGrid,
  monthRange,
  formatShootTime,
  formatShootDateLabel,
  daysUntilLabel,
  compareShoots,
} from '@/lib/shoots';
import EmailInput from '@/components/EmailInput';

// יומן צילומים - תצוגת חודש + רשימת הצילומים הקרובים, ויצירה/עריכה/מחיקה של
// צילום. הנתונים מ-app/api/shoots (session הצלמת + RLS). התזכורות ללקוחה
// והסיכום היומי לצלמת נשלחים אוטומטית מ-app/api/cron/tick (ראו lib/shoots.ts).

interface Shoot {
  id: string;
  shoot_date: string;
  start_time: string;
  location: string;
  notes: string | null;
  client_id: string;
  gallery_id: string | null;
  confirmation_sent_at: string | null;
  reminder_sent_at: string | null;
  clients: { full_name: string; email: string } | null;
}

interface ClientOption {
  id: string;
  full_name: string;
  email: string;
}

interface GalleryOption {
  id: string;
  client_id: string;
  created_at: string;
  client_name: string;
}

interface FormState {
  shootId: string | null; // null = צילום חדש
  clientMode: 'existing' | 'new';
  clientId: string;
  clientName: string;
  clientEmail: string;
  shootDate: string;
  startTime: string;
  location: string;
  notes: string;
  galleryId: string;
  sendEmail: boolean; // ביצירה: אישור ללקוחה (ברירת מחדל מופעל). בעריכה: שליחת הפרטים המעודכנים (ברירת מחדל כבוי).
}

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
const WEEKDAY_HEADERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

const panelStyle: React.CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  padding: '1rem',
};

const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: 14 };

function emptyForm(date: string, clients: ClientOption[]): FormState {
  return {
    shootId: null,
    clientMode: clients.length > 0 ? 'existing' : 'new',
    clientId: '',
    clientName: '',
    clientEmail: '',
    shootDate: date,
    startTime: '10:00',
    location: '',
    notes: '',
    galleryId: '',
    sendEmail: true,
  };
}

export default function CalendarPage() {
  const today = israelDateString(new Date());
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)));

  const [monthShoots, setMonthShoots] = useState<Shoot[]>([]);
  const [upcoming, setUpcoming] = useState<Shoot[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [galleries, setGalleries] = useState<GalleryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    loadOptions(true);
    loadUpcoming();
  }, []);

  useEffect(() => {
    loadMonth(year, month);
  }, [year, month]);

  async function loadOptions(prefillFromUrl = false) {
    const res = await fetch('/api/shoots/options');
    if (res.ok) {
      const data = await res.json();
      const options: ClientOption[] = data.clients ?? [];
      setClients(options);
      setGalleries(data.galleries ?? []);
      if (prefillFromUrl) openPrefilledFromUrl(options);
    }
  }

  // ?name=&email= - "צילום חדש" מדף הלקוחה (app/dashboard/clients/[key]):
  // פותחים טופס צילום חדש עם הלקוחה הקיימת (לפי מייל), או כלקוחה חדשה ממולאת.
  function openPrefilledFromUrl(options: ClientOption[]) {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name')?.trim() ?? '';
    const email = params.get('email')?.trim() ?? '';
    if (!name && !email) return;
    const existing = email ? options.find((c) => c.email.trim().toLowerCase() === email.toLowerCase()) : undefined;
    const base = emptyForm(today, options);
    setForm(
      existing
        ? { ...base, clientMode: 'existing', clientId: existing.id }
        : { ...base, clientMode: 'new', clientName: name, clientEmail: email }
    );
  }

  async function loadUpcoming() {
    const res = await fetch('/api/shoots');
    if (res.ok) {
      const data = await res.json();
      setUpcoming(data.shoots ?? []);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'טעינת הצילומים נכשלה');
    }
    setLoading(false);
  }

  async function loadMonth(y: number, m: number) {
    const { from, to } = monthRange(y, m);
    const res = await fetch(`/api/shoots?from=${from}&to=${to}`);
    if (res.ok) {
      const data = await res.json();
      setMonthShoots(data.shoots ?? []);
    }
  }

  function refreshAll() {
    loadMonth(year, month);
    loadUpcoming();
    loadOptions();
  }

  function shiftMonth(delta: number) {
    const index = year * 12 + (month - 1) + delta;
    setYear(Math.floor(index / 12));
    setMonth((index % 12) + 1);
  }

  function goToToday() {
    setYear(Number(today.slice(0, 4)));
    setMonth(Number(today.slice(5, 7)));
  }

  function openNew(date: string) {
    setForm(emptyForm(date < today ? today : date, clients));
    setFormError('');
    setNotice('');
    setConfirmingDelete(false);
  }

  function openEdit(shoot: Shoot) {
    // רשימת הלקוחות מסוננת לפי מייל (ראו app/api/shoots/options), אז ייתכן
    // שהשורה המקושרת לצילום לא ברשימה - מוסיפים אותה כדי שהבחירה תוצג נכון.
    if (shoot.clients && !clients.some((c) => c.id === shoot.client_id)) {
      setClients((prev) => [{ id: shoot.client_id, full_name: shoot.clients!.full_name, email: shoot.clients!.email }, ...prev]);
    }
    setForm({
      shootId: shoot.id,
      clientMode: 'existing',
      clientId: shoot.client_id,
      clientName: '',
      clientEmail: '',
      shootDate: shoot.shoot_date,
      startTime: formatShootTime(shoot.start_time),
      location: shoot.location,
      notes: shoot.notes ?? '',
      galleryId: shoot.gallery_id ?? '',
      sendEmail: false,
    });
    setFormError('');
    setNotice('');
    setConfirmingDelete(false);
  }

  function updateForm(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError('');

    if (form.clientMode === 'existing' && !form.clientId) {
      setFormError('בחרי לקוחה מהרשימה, או הוסיפי לקוחה חדשה');
      return;
    }

    setSaving(true);
    const isNew = form.shootId === null;
    const payload: Record<string, unknown> = {
      shootDate: form.shootDate,
      startTime: form.startTime,
      location: form.location,
      notes: form.notes,
      galleryId: form.galleryId || null,
    };
    if (form.clientMode === 'existing') payload.clientId = form.clientId;
    else {
      payload.clientName = form.clientName;
      payload.clientEmail = form.clientEmail;
    }
    if (isNew) payload.sendConfirmation = form.sendEmail;
    else payload.sendUpdate = form.sendEmail;

    const res = await fetch(isNew ? '/api/shoots' : `/api/shoots/${form.shootId}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(data.error ?? 'שמירת הצילום נכשלה');
      return;
    }

    const wantedEmail = form.sendEmail;
    let message = isNew ? 'הצילום נשמר ביומן' : 'השינויים נשמרו';
    if (wantedEmail) {
      message += data.emailSent ? ' - ונשלח מייל ללקוחה ✓' : ' - אבל שליחת המייל ללקוחה נכשלה';
    }
    setNotice(message);
    setForm(null);

    // אם הצילום בחודש אחר מזה שמוצג - עוברים אליו, כדי שהצלמת תראה אותו מיד
    const savedYear = Number(form.shootDate.slice(0, 4));
    const savedMonth = Number(form.shootDate.slice(5, 7));
    if (savedYear !== year || savedMonth !== month) {
      setYear(savedYear);
      setMonth(savedMonth);
      loadUpcoming();
      loadOptions();
    } else {
      refreshAll();
    }
  }

  async function handleDelete() {
    if (!form?.shootId) return;
    setSaving(true);
    const res = await fetch(`/api/shoots/${form.shootId}`, { method: 'DELETE' });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error ?? 'מחיקת הצילום נכשלה');
      return;
    }
    setNotice('הצילום נמחק');
    setForm(null);
    setConfirmingDelete(false);
    refreshAll();
  }

  const shootsByDate = new Map<string, Shoot[]>();
  for (const shoot of [...monthShoots].sort(compareShoots)) {
    const list = shootsByDate.get(shoot.shoot_date) ?? [];
    list.push(shoot);
    shootsByDate.set(shoot.shoot_date, list);
  }

  const weeks = buildMonthGrid(year, month);
  const galleryLabel = (g: GalleryOption) =>
    `${g.client_name || 'ללא שם'} · נוצרה ${new Date(g.created_at).toLocaleDateString('he-IL')}`;

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>יומן צילומים</h1>
          <p style={{ color: theme.textMuted, fontSize: 13, margin: '0.25rem 0 0' }}>
            תזכורות ללקוחות וסיכום יומי נשלחים אוטומטית - אפשר לשנות את זה ב
            <Link href="/dashboard/settings" style={{ color: theme.gold }}>הגדרות</Link>.
          </p>
        </div>
        <button onClick={() => openNew(today)} style={goldButtonStyle}>
          + צילום חדש
        </button>
      </div>

      {error && (
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, margin: 0 }}>{error}</p>
      )}
      {notice && (
        <p style={{ background: theme.successBg, color: theme.successText, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 13, margin: 0 }}>
          {notice}
        </p>
      )}

      {form && (
        <form onSubmit={handleSubmit} style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, margin: 0 }}>
            {form.shootId ? 'עריכת צילום' : 'צילום חדש'}
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', fontSize: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={form.clientMode === 'existing'}
                  onChange={() => updateForm({ clientMode: 'existing' })}
                  disabled={clients.length === 0}
                />
                לקוחה קיימת
              </label>
              {!form.shootId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input type="radio" checked={form.clientMode === 'new'} onChange={() => updateForm({ clientMode: 'new' })} />
                  לקוחה חדשה
                </label>
              )}
            </div>

            {form.clientMode === 'existing' ? (
              <select value={form.clientId} onChange={(e) => updateForm({ clientId: e.target.value })} style={inputStyle}>
                <option value="">בחרי לקוחה...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} ({c.email})
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <input
                  placeholder="שם הלקוחה"
                  value={form.clientName}
                  onChange={(e) => updateForm({ clientName: e.target.value })}
                  style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                  required
                />
                <EmailInput
                  placeholder="email@example.com"
                  value={form.clientEmail}
                  onValueChange={(v) => updateForm({ clientEmail: v })}
                  style={{ ...inputStyle, flex: 1, minWidth: 180 }}
                  required
                />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <label style={{ ...labelStyle, flex: 1, minWidth: 150 }}>
              תאריך
              <input type="date" value={form.shootDate} onChange={(e) => updateForm({ shootDate: e.target.value })} style={inputStyle} required />
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 120 }}>
              שעת התחלה
              <input type="time" value={form.startTime} onChange={(e) => updateForm({ startTime: e.target.value })} style={inputStyle} required />
            </label>
          </div>

          <label style={labelStyle}>
            מיקום
            <input
              value={form.location}
              onChange={(e) => updateForm({ location: e.target.value })}
              placeholder="למשל: פארק הירקון, כניסה ראשית"
              maxLength={200}
              style={inputStyle}
              required
            />
          </label>

          <label style={labelStyle}>
            הערות (רק בשבילך - לא נשלחות ללקוחה)
            <textarea
              value={form.notes}
              onChange={(e) => updateForm({ notes: e.target.value })}
              rows={3}
              maxLength={2000}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </label>

          <label style={labelStyle}>
            קישור לגלריה (אופציונלי)
            <select value={form.galleryId} onChange={(e) => updateForm({ galleryId: e.target.value })} style={inputStyle}>
              <option value="">ללא גלריה</option>
              {galleries.map((g) => (
                <option key={g.id} value={g.id}>
                  {galleryLabel(g)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.sendEmail} onChange={(e) => updateForm({ sendEmail: e.target.checked })} />
            {form.shootId ? 'לשלוח ללקוחה מייל עם הפרטים המעודכנים' : 'לשלוח ללקוחה מייל אישור על הצילום'}
          </label>

          {formError && (
            <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 13, margin: 0 }}>
              {formError}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" disabled={saving} style={{ ...goldButtonStyle, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'שומרת...' : 'שמירה'}
            </button>
            <button type="button" onClick={() => setForm(null)} style={outlineButtonStyle}>
              ביטול
            </button>
            {form.shootId && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                style={{ ...outlineButtonStyle, color: theme.errorText, borderColor: theme.errorText, marginInlineStart: 'auto' }}
              >
                מחיקה
              </button>
            )}
            {form.shootId && confirmingDelete && (
              <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginInlineStart: 'auto', fontSize: 13 }}>
                בטוחה?
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  style={{ ...outlineButtonStyle, color: theme.errorText, borderColor: theme.errorText, padding: '0.4rem 0.8rem' }}
                >
                  כן, למחוק
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} style={{ ...outlineButtonStyle, padding: '0.4rem 0.8rem' }}>
                  לא
                </button>
              </span>
            )}
          </div>
        </form>
      )}

      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem' }}>
          <button onClick={() => shiftMonth(-1)} style={{ ...outlineButtonStyle, padding: '0.35rem 0.75rem' }} aria-label="החודש הקודם">
            →
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontFamily: theme.fontSerif, fontSize: 17 }}>
              {HEBREW_MONTHS[month - 1]} {year}
            </span>
            <button onClick={goToToday} style={{ background: 'none', border: 'none', color: theme.gold, fontSize: 12, cursor: 'pointer', padding: 0 }}>
              היום
            </button>
          </div>
          <button onClick={() => shiftMonth(1)} style={{ ...outlineButtonStyle, padding: '0.35rem 0.75rem' }} aria-label="החודש הבא">
            ←
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {WEEKDAY_HEADERS.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 12, color: theme.textFaint, paddingBottom: 4 }}>
              {d}
            </div>
          ))}
          {weeks.flat().map((date, i) => {
            if (!date) return <div key={`empty-${i}`} />;
            const dayShoots = shootsByDate.get(date) ?? [];
            const isToday = date === today;
            const isPast = date < today;
            return (
              <div
                key={date}
                onClick={() => !isPast && openNew(date)}
                title={isPast ? undefined : 'הוספת צילום ביום הזה'}
                style={{
                  minHeight: 72,
                  border: `1px solid ${isToday ? theme.gold : theme.border}`,
                  borderRadius: 6,
                  padding: 4,
                  background: dayShoots.length > 0 ? theme.panelInput : 'transparent',
                  opacity: isPast ? 0.55 : 1,
                  cursor: isPast ? 'default' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  overflow: 'hidden',
                }}
              >
                <span style={{ fontSize: 12, color: isToday ? theme.gold : theme.textMuted, fontWeight: isToday ? 700 : 400 }}>
                  {Number(date.slice(8))}
                </span>
                {dayShoots.map((shoot) => (
                  <button
                    key={shoot.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(shoot);
                    }}
                    title={`${formatShootTime(shoot.start_time)} ${shoot.clients?.full_name ?? ''} - ${shoot.location}`}
                    style={{
                      background: theme.gold,
                      color: theme.goldText,
                      border: 'none',
                      borderRadius: 3,
                      fontSize: 11,
                      padding: '1px 4px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontFamily: theme.fontSans,
                    }}
                  >
                    <span dir="ltr">{formatShootTime(shoot.start_time)}</span> {shoot.clients?.full_name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, margin: '0.5rem 0 0' }}>צילומים קרובים</h2>
        {upcoming.length === 0 && (
          <p style={{ color: theme.textMuted, fontSize: 14, margin: 0 }}>
            אין צילומים קרובים ביומן. לחצי על "צילום חדש" או על יום בלוח כדי להוסיף.
          </p>
        )}
        {upcoming.map((shoot) => {
          const days = daysBetweenDateStrings(today, shoot.shoot_date);
          return (
            <div
              key={shoot.id}
              onClick={() => openEdit(shoot)}
              style={{ ...panelStyle, padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
                <span style={{ fontWeight: 700 }}>{shoot.clients?.full_name ?? 'לקוחה'}</span>
                <span style={{ fontSize: 13, color: theme.textMuted }}>
                  {formatShootDateLabel(shoot.shoot_date)} · <span dir="ltr">{formatShootTime(shoot.start_time)}</span> · 📍 {shoot.location}
                </span>
                <span style={{ fontSize: 12, color: theme.textFaint, display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {shoot.confirmation_sent_at && <span>✓ אישור נשלח</span>}
                  {shoot.reminder_sent_at && <span>✓ תזכורת נשלחה</span>}
                  {shoot.gallery_id && (
                    <Link
                      href={`/dashboard/galleries/${shoot.gallery_id}/edit`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: theme.gold }}
                    >
                      לגלריה
                    </Link>
                  )}
                </span>
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: days <= 1 ? theme.goldText : theme.textMuted,
                  background: days <= 1 ? theme.goldBright : 'transparent',
                  border: days <= 1 ? 'none' : `1px solid ${theme.border}`,
                  borderRadius: 999,
                  padding: '0.2rem 0.65rem',
                  whiteSpace: 'nowrap',
                }}
              >
                {daysUntilLabel(days)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
