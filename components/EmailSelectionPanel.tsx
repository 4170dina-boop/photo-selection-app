'use client';

import { useEffect, useState } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle, inputStyle } from '@/lib/theme';

// "📧 שליחת התמונות במייל" - בחירה במייל ללקוחות עם סינון (משימה 21).
// התמונות נשלחות כקבצים מצורפים לג'ימייל של הלקוחה (lib/emailSelectionBatches.ts
// מסביר למה), חלק אחרי חלק דרך app/api/galleries/[id]/email-selection.

type Part = { index: number; from: number; to: number };
type PartState = 'waiting' | 'sending' | 'sent' | 'failed';

export default function EmailSelectionPanel({ galleryId }: { galleryId: string }) {
  const [total, setTotal] = useState<number | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [to, setTo] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [states, setStates] = useState<Record<number, PartState>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/galleries/${galleryId}/email-selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'plan' }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setTotal(data.total);
        setParts(data.parts);
        setTo(data.clientEmail || '');
        setMyEmail(data.myEmail || '');
      })
      .catch((e) => setMessage({ ok: false, text: e.message || 'טעינה נכשלה' }));
  }, [galleryId]);

  async function post(payload: object) {
    const res = await fetch(`/api/galleries/${galleryId}/email-selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'השליחה נכשלה');
    return data;
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      await post({ mode: 'test' });
      setMessage({ ok: true, text: `✓ מייל ניסיון נשלח אל ${myEmail}. פתחי אותו ובדקי שהתמונות המצורפות נפתחות.` });
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  // שולחים רק חלקים שעוד לא נשלחו - "שליחה" שנייה אחרי כישלון ממשיכה מאיפה שעצרה.
  async function sendAll() {
    setBusy(true);
    setMessage(null);
    for (const part of parts) {
      if (states[part.index] === 'sent') continue;
      setStates((s) => ({ ...s, [part.index]: 'sending' }));
      try {
        await post({ mode: 'send', part: part.index, to });
        setStates((s) => ({ ...s, [part.index]: 'sent' }));
      } catch (e: any) {
        setStates((s) => ({ ...s, [part.index]: 'failed' }));
        setMessage({ ok: false, text: `${e.message}. אפשר ללחוץ שוב "שליחה" - רק מה שלא נשלח יישלח.` });
        setBusy(false);
        return;
      }
    }
    setMessage({ ok: true, text: `✓ כל התמונות נשלחו אל ${to}` });
    setBusy(false);
  }

  const allSent = parts.length > 0 && parts.every((p) => states[p.index] === 'sent');
  const started = Object.keys(states).length > 0;

  return (
    <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.35rem', fontSize: 16 }}>📧 שליחת התמונות במייל</h3>
      <p style={{ margin: 0, fontSize: 13, color: theme.textMuted, lineHeight: 1.7 }}>
        ללקוחות עם סינון: התמונות נשלחות כקבצים מצורפים לג'ימייל שלה, והיא עונה עם המספרים של התמונות שבחרה.
      </p>

      <input
        type="email"
        dir="ltr"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="מייל הלקוחה"
        aria-label="מייל הלקוחה"
        disabled={busy}
        style={{ ...inputStyle, width: '100%', marginTop: '0.75rem', textAlign: 'left' }}
      />

      {total !== null && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: '0.6rem', fontSize: 13, color: theme.textMuted }}>
          <span><b style={{ color: theme.text }}>{total}</b> תמונות</span>
          <span>·</span>
          <span>יישלחו ב-<b style={{ color: theme.text }}>{parts.length}</b> {parts.length === 1 ? 'מייל' : 'מיילים'} לפחות</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: '0.75rem' }}>
        <button type="button" style={outlineButtonStyle} disabled={busy || !total || !myEmail} onClick={sendTest}>
          ✉️ שליחת ניסיון אליי
        </button>
        <button type="button" style={goldButtonStyle} disabled={busy || !total || !to || allSent} onClick={sendAll}>
          {busy && started ? 'שולחת…' : allSent ? '✓ נשלח' : 'שליחה ללקוחה'}
        </button>
      </div>

      {started && (
        <div style={{ display: 'grid', gap: 6, marginTop: '0.75rem' }}>
          {parts.map((p) => {
            const s = states[p.index] ?? 'waiting';
            const label = { waiting: 'ממתין', sending: 'שולחת…', sent: '✓ נשלח', failed: '✗ נכשל' }[s];
            const color = s === 'sent' ? '#7fae86' : s === 'failed' ? theme.errorText : theme.textMuted;
            return (
              <div key={p.index} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 10px', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
                <span>תמונות {p.from}–{p.to}</span>
                <span style={{ color, fontWeight: 700 }}>{label}</span>
              </div>
            );
          })}
        </div>
      )}

      {message && (
        <p style={{ margin: '0.75rem 0 0', fontSize: 13, color: message.ok ? '#7fae86' : theme.errorText, lineHeight: 1.6 }}>{message.text}</p>
      )}
      <p style={{ margin: '0.6rem 0 0', fontSize: 12, color: theme.textFaint }}>
        💡 כדאי קודם לשלוח ניסיון לעצמך ולבדוק שהתמונות נפתחות.
      </p>
    </div>
  );
}
