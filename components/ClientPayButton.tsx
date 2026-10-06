'use client';

import React, { useEffect, useRef, useState } from 'react';
import { theme, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { formatShekels } from '@/lib/payments';
import { isSafePaymentUrl } from '@/lib/paymentLinks';
import {
  PAYMENT_METHOD_ICONS,
  extractAccountNumber,
  phoneTelHref,
  type PaymentMethod,
  type PaymentMethodType,
} from '@/lib/paymentMethods';
import { t, type Lang, type MessageKey, type MessageParams, type ViewerGender } from '@/lib/i18n';
import { useClientGalleryProgress } from '@/components/useClientGalleryProgress';

// "💳 תשלום: X ₪" ללקוחה + "איך נוח לך לשלם?" - כרטיסים לבחירה מתוך אמצעי
// התשלום שהצלמת הפעילה (app/dashboard/settings, lib/paymentMethods.ts). בחירה
// חושפת את הפרטים (העתקת מספר חשבון / טלפון, קישור לביט/PayBox), ו"אישור ✓"
// רושם את הבחירה (app/api/gallery/[id]/payment-choice) כדי שהצלמת תראה אותה.
// אין כאן עיבוד תשלומים; הצלמת רושמת את התשלום ידנית.
// מוצג רק כשיש לפחות אמצעי אחד וסכום > 0 (ורק לבעלים - השרת לא מחזיר
// payment לאורחים, ראו app/api/gallery/[id]/progress).

const METHOD_LABEL_KEY: Record<PaymentMethodType, MessageKey> = {
  bank: 'pay.method.bank',
  cash: 'pay.method.cash',
  check: 'pay.method.check',
  phone: 'pay.method.phone',
  bit: 'pay.method.bit',
  paybox: 'pay.method.paybox',
};

interface PayPanelProps {
  galleryId: string;
  amount: number;
  methods: PaymentMethod[] | null | undefined;
  // מה שהלקוחה כבר בחרה בביקור קודם (מהשרת)
  choice?: PaymentMethodType | null;
  lang?: Lang;
  gender?: ViewerGender;
  accent?: string;
  buttonStyle?: React.CSSProperties;
  compact?: boolean;
}

type CopyKey = 'account' | 'all' | 'phone';

// התצוגה עצמה, בלי טעינה - משמשת גם את ClientProgressTracker (שכבר טען את הנתונים).
export function ClientPayPanel({
  galleryId,
  amount,
  methods,
  choice = null,
  lang = 'he',
  gender = null,
  accent = theme.gold,
  buttonStyle = goldButtonStyle,
  compact,
}: PayPanelProps) {
  const tr = (key: MessageKey, params?: MessageParams) => t(lang, key, params, gender);
  const [selected, setSelected] = useState<PaymentMethodType | null>(choice);
  const [confirmed, setConfirmed] = useState<PaymentMethodType | null>(choice);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<CopyKey | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  // הבחירה מהשרת השתנתה (רענון בפוקוס, או שנבחרה בחלון אחר) - מסנכרנים רק
  // כשהערך מהשרת באמת משתנה, וכל עוד הלקוחה לא באמצע שינוי
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (!editingRef.current && choice) {
      setConfirmed(choice);
      setSelected(choice);
    }
  }, [choice]);

  // אימות נוסף בדפדפן - קישור שאינו https / טלפון לא תקין לא מוצג גם אם הגיע איכשהו
  const available = (methods ?? []).filter((m) => {
    if (m.type === 'bit' || m.type === 'paybox') return isSafePaymentUrl(m.text);
    if (m.type === 'phone') return !!phoneTelHref(m.text);
    return true;
  });
  if (available.length === 0 || !(amount > 0)) return null;

  const showChooser = !confirmed || editing;
  const activeType = showChooser ? selected : confirmed;
  const active = available.find((m) => m.type === activeType) ?? null;

  async function copy(key: CopyKey, value: string) {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
    window.setTimeout(() => setCopied(null), 2500);
  }

  async function handleConfirm() {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/gallery/${galleryId}/payment-choice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: selected }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // saved=false (מיגרציה שלא רצה) - ממשיכים כרגיל, הפרטים עדיין מוצגים
      setConfirmed(selected);
      setEditing(false);
    } catch {
      setError(tr('pay.choiceFailed'));
    } finally {
      setSaving(false);
    }
  }

  const smallButton: React.CSSProperties = { ...outlineButtonStyle, padding: '0.3rem 0.8rem', fontSize: 12, minHeight: 36 };
  const linkButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 44, textDecoration: 'none',
  };
  const detailText: React.CSSProperties = {
    margin: 0, padding: '0.6rem 0.75rem', borderRadius: 6, background: theme.panel, border: `1px solid ${theme.border}`,
    color: theme.text, fontFamily: theme.fontSans, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'all',
  };

  function renderDetails(m: PaymentMethod) {
    if (m.type === 'bank') {
      const account = extractAccountNumber(m.text);
      return (
        <>
          <pre style={detailText}>{m.text}</pre>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            {account && (
              <button type="button" onClick={() => copy('account', account)} style={smallButton}>
                {copied === 'account' ? tr('pay.copied') : `${tr('pay.copyAccount')} (${account})`}
              </button>
            )}
            <button type="button" onClick={() => copy('all', m.text)} style={smallButton}>
              {copied === 'all' ? tr('pay.copied') : tr('pay.copyAll')}
            </button>
          </div>
        </>
      );
    }
    if (m.type === 'phone') {
      const href = phoneTelHref(m.text);
      return (
        <>
          <p style={{ fontSize: 13, color: theme.textMuted, margin: '0 0 0.35rem' }}>{tr('pay.phoneHint')}</p>
          <p style={{ ...detailText, textAlign: 'center', fontSize: 16 }}>
            <bdi dir="ltr">{m.text}</bdi>
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.5rem' }}>
            {href && (
              <a href={href} style={linkButtonStyle}>
                {tr('pay.call')}
              </a>
            )}
            <button type="button" onClick={() => copy('phone', m.text)} style={{ ...smallButton, minHeight: 44 }}>
              {copied === 'phone' ? tr('pay.copied') : tr('pay.copyPhone')}
            </button>
          </div>
        </>
      );
    }
    if (m.type === 'bit' || m.type === 'paybox') {
      return (
        <div style={{ textAlign: 'center' }}>
          <a href={m.text} target="_blank" rel="noopener noreferrer" style={linkButtonStyle}>
            {tr(m.type === 'bit' ? 'pay.openBit' : 'pay.openPaybox')}
          </a>
        </div>
      );
    }
    // מזומן / צ'ק - הטקסט של הצלמת, או משפט ברירת מחדל
    return <p style={{ fontSize: 14, color: theme.text, margin: 0, whiteSpace: 'pre-wrap' }}>{m.text || tr(m.type === 'cash' ? 'pay.cashDefault' : 'pay.checkDefault')}</p>;
  }

  return (
    <div
      style={{
        marginTop: compact ? '0.75rem' : '1.25rem', padding: compact ? '0.75rem' : '1rem', borderRadius: 10,
        background: theme.panelInput, border: `1px solid ${accent}44`, textAlign: 'center',
      }}
    >
      <p style={{ fontSize: compact ? 14 : 16, fontWeight: 700, color: theme.text, margin: 0 }}>
        <bdi>{tr('pay.title', { amount: formatShekels(amount) })}</bdi>
      </p>

      {showChooser ? (
        <>
          <p id={`pay-how-${galleryId}`} style={{ fontSize: 13, color: theme.textMuted, margin: '0.5rem 0 0.5rem' }}>{tr('pay.howToPay')}</p>
          <div role="radiogroup" aria-labelledby={`pay-how-${galleryId}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', textAlign: 'start' }}>
            {available.map((m) => {
              const isSelected = selected === m.type;
              return (
                <div key={m.type}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      setSelected(m.type);
                      setError('');
                    }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem', minHeight: 44,
                      padding: '0.55rem 0.75rem', borderRadius: 10, cursor: 'pointer', textAlign: 'start',
                      fontSize: 14, fontFamily: theme.fontSans, fontWeight: isSelected ? 700 : 400,
                      color: theme.text, background: isSelected ? `${accent}1f` : theme.panel,
                      border: `1px solid ${isSelected ? accent : theme.border}`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${isSelected ? accent : theme.borderLight}`,
                        background: isSelected ? accent : 'transparent', boxShadow: isSelected ? `inset 0 0 0 2px ${theme.panel}` : undefined,
                      }}
                    />
                    <span aria-hidden="true">{PAYMENT_METHOD_ICONS[m.type]}</span>
                    {tr(METHOD_LABEL_KEY[m.type])}
                  </button>
                  {isSelected && <div style={{ padding: '0.6rem 0.25rem 0.25rem' }}>{renderDetails(m)}</div>}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selected || saving}
            style={{ ...buttonStyle, marginTop: '0.75rem', minHeight: 44, opacity: !selected || saving ? 0.6 : 1 }}
          >
            {saving ? tr('pay.saving') : tr('pay.confirm')}
          </button>
          {!compact && !selected && <p style={{ fontSize: 12, color: theme.textMuted, margin: '0.5rem 0 0' }}>{tr('pay.hint')}</p>}
        </>
      ) : (
        active && (
          <>
            <p role="status" style={{ fontSize: 13, color: theme.successText, margin: '0.5rem 0 0.6rem' }}>
              {tr('pay.confirmed', { method: tr(METHOD_LABEL_KEY[active.type]) })}
            </p>
            <div style={{ textAlign: 'start' }}>{renderDetails(active)}</div>
            <button type="button" onClick={() => setEditing(true)} style={{ ...smallButton, marginTop: '0.6rem' }}>
              {tr('pay.change')}
            </button>
          </>
        )
      )}

      {copyFailed && (
        <p role="status" style={{ fontSize: 12, color: theme.warningText, margin: '0.35rem 0 0' }}>{tr('pay.copyFailed')}</p>
      )}
      {error && (
        <p role="alert" style={{ fontSize: 12, color: theme.errorText, margin: '0.35rem 0 0' }}>{error}</p>
      )}
    </div>
  );
}

interface ClientPayButtonProps {
  galleryId: string;
  // סכום מחושב בדפדפן (למשל בחלון הסיכום לפני השליחה, שכולל גם בחירות שעוד
  // בתור) - בלעדיו משתמשים בסכום שהשרת חישב (כולל סכום ידני ותשלומים שנרשמו)
  amount?: number;
  lang?: Lang;
  gender?: ViewerGender;
  accent?: string;
  buttonStyle?: React.CSSProperties;
  compact?: boolean;
}

// גרסה עצמאית שטוענת לבד את אמצעי התשלום - לחלון הסיכום של "סיימתי לבחור".
export default function ClientPayButton({ galleryId, amount, lang, gender, accent, buttonStyle, compact }: ClientPayButtonProps) {
  const data = useClientGalleryProgress(galleryId);
  if (!data?.payment || data.payment.settled) return null;
  return (
    <ClientPayPanel
      galleryId={galleryId}
      amount={amount ?? data.payment.amount}
      methods={data.payment.methods}
      choice={data.payment.choice}
      lang={lang}
      gender={gender}
      accent={accent}
      buttonStyle={buttonStyle}
      compact={compact}
    />
  );
}
