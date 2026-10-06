'use client';

import React, { useState } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { formatShekels } from '@/lib/payments';
import { hasAnyPaymentLink, isSafePaymentUrl, type PaymentLinks } from '@/lib/paymentLinks';
import { useClientGalleryProgress } from '@/components/useClientGalleryProgress';

// "💳 תשלום על התוספת" ללקוחה - קישורים לביט / PayBox ותיבת פרטי העברה בנקאית
// להעתקה, לפי מה שהצלמת הגדירה (app/dashboard/settings, lib/paymentLinks.ts).
// אין כאן עיבוד תשלומים - רק קישורים חיצוניים; הצלמת רושמת את התשלום ידנית.
// מוצג רק כשיש לפחות קישור אחד וסכום > 0 (ורק לבעלים - השרת לא מחזיר
// payment לאורחים, ראו app/api/gallery/[id]/progress).

// TODO i18n: להעביר ל-lib/i18n
const STRINGS = {
  title: (amount: string) => `💳 תשלום על התוספת: ${amount} ₪`,
  hint: 'אפשר לשלם בדרך הנוחה לך - הצלמת תעדכן כשהתשלום התקבל.',
  bit: 'תשלום בביט',
  paybox: 'PayBox',
  bankTitle: 'פרטי העברה בנקאית',
  copy: 'העתקה',
  copied: '✓ הועתק',
  copyFailed: 'לא הצלחנו להעתיק - אפשר לסמן ולהעתיק ידנית',
};

interface PayPanelProps {
  amount: number;
  links: PaymentLinks | null | undefined;
  accent?: string;
  buttonStyle?: React.CSSProperties;
  compact?: boolean;
}

// התצוגה עצמה, בלי טעינה - משמשת גם את ClientProgressTracker (שכבר טען את הנתונים).
export function ClientPayPanel({ amount, links, accent = theme.gold, buttonStyle = goldButtonStyle, compact }: PayPanelProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  if (!links || !hasAnyPaymentLink(links) || !(amount > 0)) return null;
  // אימות נוסף בדפדפן - קישור שאינו https לא מוצג גם אם הגיע איכשהו
  const bitUrl = isSafePaymentUrl(links.bitUrl) ? links.bitUrl : null;
  const payboxUrl = isSafePaymentUrl(links.payboxUrl) ? links.payboxUrl : null;
  const bankDetails = links.bankDetails;
  if (!bitUrl && !payboxUrl && !bankDetails) return null;

  async function handleCopy() {
    if (!bankDetails) return;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(bankDetails);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 2500);
  }

  const linkButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 44, textDecoration: 'none',
  };

  return (
    <div
      style={{
        marginTop: compact ? '0.75rem' : '1.25rem', padding: compact ? '0.75rem' : '1rem', borderRadius: 10,
        background: theme.panelInput, border: `1px solid ${accent}44`, textAlign: 'center',
      }}
    >
      <p style={{ fontSize: compact ? 14 : 16, fontWeight: 700, color: theme.text, margin: 0 }}>
        <bdi dir="rtl">{STRINGS.title(formatShekels(amount))}</bdi>
      </p>
      {!compact && <p style={{ fontSize: 12, color: theme.textMuted, margin: '0.35rem 0 0' }}>{STRINGS.hint}</p>}

      {(bitUrl || payboxUrl) && (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          {bitUrl && (
            <a href={bitUrl} target="_blank" rel="noopener noreferrer" style={linkButtonStyle}>
              {STRINGS.bit}
            </a>
          )}
          {payboxUrl && (
            <a href={payboxUrl} target="_blank" rel="noopener noreferrer" style={{ ...outlineButtonStyle, ...linkButtonStyle, background: 'transparent', color: theme.text, border: `1px solid ${accent}` }}>
              {STRINGS.paybox}
            </a>
          )}
        </div>
      )}

      {bankDetails && (
        <div style={{ marginTop: '0.75rem', textAlign: 'start' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: 13, color: theme.textMuted }}>{STRINGS.bankTitle}</span>
            <button type="button" onClick={handleCopy} style={{ ...outlineButtonStyle, padding: '0.3rem 0.8rem', fontSize: 12, minHeight: 36 }}>
              {copyState === 'copied' ? STRINGS.copied : STRINGS.copy}
            </button>
          </div>
          <pre
            style={{
              margin: 0, padding: '0.6rem 0.75rem', borderRadius: 6, background: theme.panel, border: `1px solid ${theme.border}`,
              color: theme.text, fontFamily: theme.fontSans, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'all',
            }}
          >
            {bankDetails}
          </pre>
          {copyState === 'failed' && (
            <p role="status" style={{ fontSize: 12, color: theme.warningText, margin: '0.35rem 0 0' }}>{STRINGS.copyFailed}</p>
          )}
        </div>
      )}
    </div>
  );
}

interface ClientPayButtonProps {
  galleryId: string;
  // סכום מחושב בדפדפן (למשל בחלון הסיכום לפני השליחה, שכולל גם בחירות שעוד
  // בתור) - בלעדיו משתמשים בסכום שהשרת חישב (כולל תשלומים שכבר נרשמו)
  amount?: number;
  accent?: string;
  buttonStyle?: React.CSSProperties;
  compact?: boolean;
}

// גרסה עצמאית שטוענת לבד את הקישורים - לחלון הסיכום של "סיימתי לבחור".
export default function ClientPayButton({ galleryId, amount, accent, buttonStyle, compact }: ClientPayButtonProps) {
  const data = useClientGalleryProgress(galleryId);
  if (!data?.payment || data.payment.settled) return null;
  return (
    <ClientPayPanel
      amount={amount ?? data.payment.amount}
      links={data.payment.links}
      accent={accent}
      buttonStyle={buttonStyle}
      compact={compact}
    />
  );
}
