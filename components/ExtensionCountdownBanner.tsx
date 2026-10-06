'use client';

import { useEffect, useState } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import {
  EXTENSION_DAY_OPTIONS,
  deadlineWarning,
  extensionButtonMode,
} from '@/lib/extensionRequests';
import type { ViewerGender } from '@/lib/gender';
import { formatDateWithHebrew, localizedErrorFromBody, t, type Lang, type MessageKey, type MessageParams } from '@/lib/i18n';

interface ExtensionStatus {
  available: boolean;
  requestsUsed: number;
  pending: { id: string; days: number } | null;
  lastDecision: { status: 'approved' | 'declined'; days: number } | null;
}

// באנר "נשארו X ימים לבחירה" בגלריית הלקוחה (3 ימים ומטה לפני הסיום), עם
// כפתור "לבקש הארכה" לבעלת הגלריה בלבד (לא לאורחות). המגבלות עצמן נאכפות
// בשרת (app/api/gallery/[id]/extension-request) - כאן רק מסתירים/מסבירים.
// אם הטבלה עוד לא קיימת (available=false) - הבאנר מוצג בלי הכפתור.
export default function ExtensionCountdownBanner(props: {
  galleryId: string;
  expiresAt: string | null;
  isOwner: boolean;
  selectionOpen: boolean;
  accent: string;
  // לשון פנייה לצופה (lib/gender.ts) - חסר = נקבה כמו קודם
  gender?: ViewerGender;
  // שפת התצוגה (lib/i18n) - חסר = עברית
  lang?: Lang;
}) {
  const { galleryId, expiresAt, isOwner, selectionOpen, accent } = props;
  const gender: ViewerGender = props.gender === undefined ? 'f' : props.gender;
  const lang: Lang = props.lang ?? 'he';
  const tr = (key: MessageKey, params?: MessageParams) => t(lang, key, params, gender);
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // מתעדכן כל דקה - כדי שמעבר יום (למשל "נשאר יום אחד" -> "היום הוא היום האחרון") ייקלט בלי רענון
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const warning = selectionOpen ? deadlineWarning(expiresAt, now) : null;

  useEffect(() => {
    if (!warning || !isOwner) return;
    let cancelled = false;
    fetch(`/api/gallery/${galleryId}/extension-request`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // נטען פעם אחת כשהבאנר מופיע (ושוב אם התוקף השתנה)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId, isOwner, expiresAt, !!warning]);

  if (!warning || !expiresAt) return null;

  const mode = extensionButtonMode({
    available: !!status?.available,
    isOwner,
    selectionOpen,
    requestsUsed: status?.requestsUsed ?? 0,
    hasPending: !!status?.pending,
  });

  async function requestExtension(days: number) {
    setSending(true);
    setError('');
    try {
      const res = await fetch(`/api/gallery/${galleryId}/extension-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(localizedErrorFromBody(lang, data, tr('ext.sendFailed'), gender));
        return;
      }
      if (data) setStatus(data);
      setChoosing(false);
      setMessage(tr('ext.sent', { count: days }));
    } catch {
      setError(tr('ext.sendFailedNet'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="status"
      style={{
        margin: '0.6rem 1.5rem 0', padding: '0.75rem 1rem', borderRadius: 8,
        background: theme.warningBg, border: `1px solid ${accent}66`, color: theme.text, fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 700, color: accent }}>
        {warning.daysLeft <= 0 ? tr('ext.lastDay') : tr('ext.daysLeft', { count: warning.daysLeft })}
      </div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 2 }}>
        {tr('ext.until', { date: formatDateWithHebrew(lang, expiresAt) })}
      </div>

      {mode === 'button' && !choosing && (
        <button
          type="button"
          onClick={() => {
            setChoosing(true);
            setMessage('');
          }}
          style={{ ...outlineButtonStyle, marginTop: '0.6rem', borderColor: accent, color: accent }}
        >
          {tr('ext.request')}
        </button>
      )}

      {mode === 'button' && choosing && (
        <div style={{ marginTop: '0.6rem' }}>
          <div style={{ fontSize: 13, marginBottom: '0.4rem' }}>{tr('ext.howMany')}</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {EXTENSION_DAY_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                disabled={sending}
                onClick={() => requestExtension(days)}
                style={{ ...goldButtonStyle, opacity: sending ? 0.6 : 1 }}
              >
                {tr('ext.daysOption', { count: days })}
              </button>
            ))}
            <button type="button" disabled={sending} onClick={() => setChoosing(false)} style={outlineButtonStyle}>
              {tr('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {mode === 'pending' && (
        <div style={{ fontSize: 13, marginTop: '0.5rem', color: theme.textMuted }}>
          {message || tr('ext.pending', { count: status?.pending?.days ?? 0 })}
        </div>
      )}

      {mode === 'limit_reached' && (
        <div style={{ fontSize: 13, marginTop: '0.5rem', color: theme.textMuted }}>{tr('ext.limit')}</div>
      )}

      {mode !== 'pending' && status?.lastDecision?.status === 'declined' && (
        <div style={{ fontSize: 12, marginTop: '0.4rem', color: theme.textFaint }}>{tr('ext.declined')}</div>
      )}

      {error && <div style={{ fontSize: 13, marginTop: '0.5rem', color: theme.errorText }}>{error}</div>}
    </div>
  );
}
