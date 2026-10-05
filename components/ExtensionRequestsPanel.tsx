'use client';

import { useEffect, useState } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { formatIsraelDate } from '@/lib/israelTime';
import { toHebrewDateString } from '@/lib/hebrewDate';
import { EXTENSION_MAX_REQUESTS } from '@/lib/extensionRequests';

interface ExtensionRequest {
  id: string;
  requested_days: number;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
  decided_at: string | null;
}

// בקשות הארכה של הלקוחה בדף עריכת הגלריה: בקשה ממתינה עם "אישור (+N ימים)" /
// "דחייה", ושורת סיכום קצרה של בקשות קודמות. לא מוצג כלום כשאין בקשות בכלל
// או כשהטבלה עוד לא קיימת (available=false). onApproved - עדכון התוקף/הסטטוס
// בדף אחרי אישור.
export default function ExtensionRequestsPanel({
  galleryId,
  onApproved,
}: {
  galleryId: string;
  onApproved: (newExpiresAt: string, newStatus: string | null) => void;
}) {
  const [requests, setRequests] = useState<ExtensionRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await fetch(`/api/galleries/${galleryId}/extension-requests`);
      if (!res.ok) return;
      const data = await res.json();
      setRequests(data.available ? data.requests ?? [] : []);
    } catch {
      // best-effort - האזור פשוט לא מוצג
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  async function decide(request: ExtensionRequest, action: 'approve' | 'decline') {
    setBusyId(request.id);
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/galleries/${galleryId}/extension-requests/${request.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'העדכון נכשל, נסי שוב');
      } else if (action === 'approve' && data?.expiresAt) {
        const date = `${formatIsraelDate(data.expiresAt)} · ${toHebrewDateString(new Date(data.expiresAt))}`;
        setMessage(`הבחירה הוארכה עד ${date}${data.emailSent ? ' - הלקוחה קיבלה מייל' : ''}`);
        onApproved(data.expiresAt, data.galleryStatus ?? null);
      } else {
        setMessage('הבקשה נדחתה');
      }
    } catch {
      setError('העדכון נכשל - בדקי את החיבור ונסי שוב');
    } finally {
      setBusyId(null);
      load();
    }
  }

  if (requests.length === 0 && !message && !error) return null;

  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  return (
    <div
      style={{
        background: theme.panel, border: `1px solid ${pending.length ? theme.gold : theme.border}`,
        borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: '0.5rem' }}>⏳ בקשות הארכה מהלקוחה</div>

      {pending.map((r) => (
        <div key={r.id} style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: 13, color: theme.text, marginBottom: '0.5rem' }}>
            הלקוחה ביקשה הארכה של <b>{r.requested_days}</b> ימים ({toHebrewDateString(new Date(r.created_at))})
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => decide(r, 'approve')}
              style={{ ...goldButtonStyle, opacity: busyId === r.id ? 0.6 : 1 }}
            >
              {busyId === r.id ? 'מעדכנת...' : `אישור (+${r.requested_days} ימים)`}
            </button>
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => decide(r, 'decline')}
              style={{ ...outlineButtonStyle, opacity: busyId === r.id ? 0.6 : 1 }}
            >
              דחייה
            </button>
          </div>
        </div>
      ))}

      {decided.length > 0 && (
        <div style={{ fontSize: 12, color: theme.textMuted }}>
          {decided
            .map((r) => `${r.requested_days} ימים - ${r.status === 'approved' ? 'אושרה' : 'נדחתה'}`)
            .join(' · ')}
        </div>
      )}
      <div style={{ fontSize: 12, color: theme.textFaint, marginTop: '0.25rem' }}>
        נוצלו {requests.length} מתוך {EXTENSION_MAX_REQUESTS} בקשות אפשריות
      </div>

      {message && <div style={{ fontSize: 13, color: theme.successText, marginTop: '0.5rem' }}>{message}</div>}
      {error && <div style={{ fontSize: 13, color: theme.errorText, marginTop: '0.5rem' }}>{error}</div>}
    </div>
  );
}
