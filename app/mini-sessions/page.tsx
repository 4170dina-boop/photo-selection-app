'use client';

import { useEffect, useMemo, useState } from 'react';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';

interface MiniSessionPublicItem {
  id: string;
  photographer_id: string;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  price: number | null;
  deposit: number | null;
  notes: string | null;
  availableSlots: string[];
}

const today = new Date();
const initialDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function MiniSessionsPage() {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [miniSessions, setMiniSessions] = useState<MiniSessionPublicItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMiniSessionId, setSelectedMiniSessionId] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [form, setForm] = useState({
    clientName: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');

  const selectedMiniSession = useMemo(
    () => miniSessions.find((session) => session.id === selectedMiniSessionId) ?? null,
    [miniSessions, selectedMiniSessionId]
  );

  useEffect(() => {
    loadMiniSessions(selectedDate);
  }, [selectedDate]);

  async function loadMiniSessions(date: string) {
    setLoading(true);
    setError('');
    setSelectedMiniSessionId('');
    setSelectedSlot('');
    setSuccess('');

    try {
      const res = await fetch(`/api/mini-sessions/public?date=${encodeURIComponent(date)}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'טעינת המיני-סשנים נכשלה');
        setMiniSessions([]);
        return;
      }

      const items = Array.isArray(data.miniSessions) ? data.miniSessions : [];
      setMiniSessions(items);
      if (items.length > 0) {
        setSelectedMiniSessionId(items[0].id);
        setSelectedSlot(items[0].availableSlots[0] ?? '');
      }
    } catch {
      setError('לא ניתן לטעון את המיני-סשנים כרגע');
      setMiniSessions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedMiniSession) {
      setSelectedSlot('');
      return;
    }

    if (!selectedMiniSession.availableSlots.includes(selectedSlot)) {
      setSelectedSlot(selectedMiniSession.availableSlots[0] ?? '');
    }
  }, [selectedMiniSession, selectedSlot]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMiniSession || !selectedSlot) {
      setError('יש לבחור שעה זמינה');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/mini-sessions/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          miniSessionId: selectedMiniSession.id,
          clientName: form.clientName,
          phone: form.phone,
          email: form.email,
          selectedSlot,
          notes: form.notes,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'שמירת ההזמנה נכשלה');
        return;
      }

      setSuccess('הזמנת המיני-סשן נקלטה. ניצור איתך קשר כדי לאשר את הפרטים.');
      setForm({ clientName: '', phone: '', email: '', notes: '' });
      setSelectedSlot('');
      await loadMiniSessions(selectedDate);
    } catch {
      setError('לא ניתן לשלוח את ההזמנה כרגע');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: theme.bg,
        color: theme.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
        direction: 'rtl',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>תזמון צילום</div>
          <h1 style={{ margin: 0, fontSize: 28, color: theme.gold }}>מיני-סשן</h1>
        </div>

        <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 18, padding: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: theme.textMuted }}>
            תאריך
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ ...inputStyle, width: '100%' }}
            />
          </label>

          {loading && <div style={{ marginTop: 16, color: theme.textMuted }}>טוען זמינות...</div>}

          {!loading && error && (
            <div style={{ marginTop: 16, padding: '0.75rem 0.9rem', borderRadius: 10, background: theme.errorBg, color: theme.errorText }}>
              {error}
            </div>
          )}

          {!loading && !error && miniSessions.length === 0 && (
            <div style={{ marginTop: 16, color: theme.textMuted }}>אין מיני-סשנים זמינים בתאריך הזה.</div>
          )}

          {!loading && !error && miniSessions.length > 0 && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {miniSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      setSelectedMiniSessionId(session.id);
                      setSelectedSlot(session.availableSlots[0] ?? '');
                    }}
                    style={{
                      background: selectedMiniSessionId === session.id ? 'rgba(201,143,137,0.18)' : theme.panelInput,
                      border: selectedMiniSessionId === session.id ? `1px solid ${theme.gold}` : `1px solid ${theme.border}`,
                      color: theme.text,
                      borderRadius: 12,
                      padding: '0.9rem',
                      textAlign: 'right',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{session.date}</div>
                    <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}>
                      {session.start_time} - {session.end_time} · {session.duration_minutes} דק'
                    </div>
                    <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}>
                      {session.price ? `₪${session.price}` : 'מחיר לפי התעריף'}
                      {session.deposit ? ` · מקדמה ₪${session.deposit}` : ''}
                    </div>
                  </button>
                ))}
              </div>

              {selectedMiniSession && (
                <>
                  <div>
                    <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>שעות זמינות</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {selectedMiniSession.availableSlots.length > 0 ? (
                        selectedMiniSession.availableSlots.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            style={{
                              background: selectedSlot === slot ? theme.gold : 'rgba(201,143,137,0.08)',
                              color: selectedSlot === slot ? theme.goldText : theme.text,
                              border: `1px solid ${selectedSlot === slot ? theme.gold : theme.border}`,
                              borderRadius: 8,
                              padding: '0.45rem 0.7rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {slot}
                          </button>
                        ))
                      ) : (
                        <div style={{ color: theme.textMuted }}>לא נותרו שעות פנויות</div>
                      )}
                    </div>
                  </div>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: theme.textMuted }}>
                    שם מלא
                    <input
                      type="text"
                      value={form.clientName}
                      onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                      style={{ ...inputStyle, width: '100%' }}
                      required
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: theme.textMuted }}>
                    טלפון
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      style={{ ...inputStyle, width: '100%' }}
                      required
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: theme.textMuted }}>
                    אימייל
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      style={{ ...inputStyle, width: '100%' }}
                      required
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: theme.textMuted }}>
                    הערות (אופציונלי)
                    <textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={3}
                      style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
                    />
                  </label>

                  <button type="submit" disabled={submitting || !selectedSlot} style={{ ...goldButtonStyle, width: '100%', opacity: submitting || !selectedSlot ? 0.7 : 1 }}>
                    {submitting ? 'שומר...' : 'שליחה להזמנה'}
                  </button>
                </>
              )}

              {success && (
                <div style={{ padding: '0.75rem 0.9rem', borderRadius: 10, background: theme.successBg, color: theme.successText }}>
                  {success}
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
