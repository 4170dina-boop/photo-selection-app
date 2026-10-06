'use client';

import { useEffect, useMemo, useState } from 'react';
import { theme, goldButtonStyle } from '@/lib/theme';
import { deliveryMatchSummary, matchDelivery } from '@/lib/deliveryMatch';
import { formatCooldownLeft } from '@/lib/manualEmailCooldown';

// בדיקת התאמה בין התמונות הסופיות שהועלו לבין מה שהלקוחה בחרה (+ מתנות),
// ו"מסירה ללקוחה ✓" בלחיצה אחת: סימון "נמסר" (toggle-delivered עם
// value: true - לא הופך סימון קיים) + שליחת ההתראה "התמונות מוכנות"
// (send-delivery-notification, עם מגבלת הקצב הידנית בשרת). כשיש אי-התאמות -
// מבקשים אישור לפני. הלוגיקה: lib/deliveryMatch.ts.
interface DeliveryMatchPanelProps {
  galleryId: string;
  finalFilenames: string[];
  deliveredAt: string | null;
  // שניות עד שמותר לשלוח שוב את התראת המסירה (המצב נשמר בדף העריכה)
  cooldownLeft: number;
  onDelivered: (deliveredAt: string | null) => void;
  // emailSent=true -> הדף מתחיל ספירת המתנה; retryAfterSeconds -> 429 מהשרת
  onNotificationResult: (result: { emailSent: boolean; retryAfterSeconds?: number }) => void;
}

export default function DeliveryMatchPanel({
  galleryId,
  finalFilenames,
  deliveredAt,
  cooldownLeft,
  onDelivered,
  onNotificationResult,
}: DeliveryMatchPanelProps) {
  const [expected, setExpected] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/galleries/${galleryId}/selected-photos?names=1`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
      .then((data) => {
        if (!cancelled) setExpected((data.photos ?? []).map((p: { filename?: string }) => p.filename ?? ''));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [galleryId]);

  const result = useMemo(() => (expected ? matchDelivery(expected, finalFilenames) : null), [expected, finalFilenames]);

  async function handleDeliver() {
    if (result && !result.allMatched) {
      const ok = window.confirm(
        `${deliveryMatchSummary(result)}\n\nהתמונות הסופיות לא תואמות בדיוק לבחירה של הלקוחה. למסור בכל זאת?`
      );
      if (!ok) return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!deliveredAt) {
        const res = await fetch(`/api/galleries/${galleryId}/toggle-delivered`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? 'סימון המסירה נכשל');
          return;
        }
        onDelivered(data.deliveredAt ?? null);
      }

      const res = await fetch(`/api/galleries/${galleryId}/send-delivery-notification`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) onNotificationResult({ emailSent: false, retryAfterSeconds: Number(data?.retryAfterSeconds) || undefined });
        setError(`סומן כנמסר, אבל ההתראה ללקוחה לא נשלחה: ${data.error ?? 'שגיאה'}`);
        return;
      }
      onNotificationResult({ emailSent: !!data.emailSent });
      setMessage(
        data.emailSent
          ? '✓ נמסר! הלקוחה קיבלה מייל שהתמונות מוכנות'
          : 'סומן כנמסר, אבל שליחת המייל נכשלה - אפשר להעתיק הודעה מוכנה ולשלוח בעצמך'
      );
    } catch {
      setError('שגיאת רשת - בדקי את החיבור ונסי שוב');
    } finally {
      setBusy(false);
    }
  }

  if (finalFilenames.length === 0) return null;

  return (
    <div style={{ marginTop: '1rem', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '0.85rem 1rem' }}>
      <div style={{ fontSize: 13, color: result?.allMatched ? theme.successText : theme.warningText, lineHeight: 1.6, wordBreak: 'break-word' }}>
        {loadError
          ? 'לא הצלחנו לטעון את רשימת הבחירה להשוואה'
          : result
            ? deliveryMatchSummary(result)
            : 'בודקת התאמה לבחירה...'}
      </div>
      <button
        type="button"
        onClick={handleDeliver}
        disabled={busy || cooldownLeft > 0}
        title="סימון הגלריה כנמסרה + שליחת מייל ללקוחה שהתמונות מוכנות"
        style={{ ...goldButtonStyle, marginTop: '0.65rem', opacity: busy || cooldownLeft > 0 ? 0.6 : 1 }}
      >
        {busy ? 'מוסרת...' : cooldownLeft > 0 ? `מסירה ללקוחה ✓ (שוב בעוד ${formatCooldownLeft(cooldownLeft)})` : 'מסירה ללקוחה ✓'}
      </button>
      {message && <p style={{ color: theme.successText, fontSize: 13, margin: '0.5rem 0 0' }}>{message}</p>}
      {error && <p style={{ color: theme.errorText, fontSize: 13, margin: '0.5rem 0 0' }}>{error}</p>}
    </div>
  );
}
