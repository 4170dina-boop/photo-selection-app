'use client';

import { useEffect, useState } from 'react';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { formatShekels, type PaymentSummary } from '@/lib/payments';
import { israelDateString } from '@/lib/israelTime';
import { toHebrewDateString } from '@/lib/hebrewDate';
import { formatIsraelDate } from '@/lib/israelTime';
import { PAYMENT_METHOD_ICONS, isPaymentMethodType, paymentMethodLabel } from '@/lib/paymentMethods';

// אזור "תשלומים" בדף עריכת גלריה - סכום לתשלום (אוטומטי מהחבילה או דריסה
// ידנית), רשימת תשלומים שהתקבלו, והיתרה. עצמאי לגמרי מטופס העריכה הראשי
// (כל פעולה נשמרת מיד דרך app/api/galleries/[id]/payments, בלי "שמירת שינויים").

interface Payment {
  id: string;
  amount: number;
  paid_on: string;
  method: string | null;
  note: string | null;
}

interface PaymentsState {
  payments: Payment[];
  summary: PaymentSummary;
  amountDueOverride: number | null;
  paidAt: string | null;
  clientPaymentChoice?: string | null;
  clientPaymentChoiceAt?: string | null;
}

const METHOD_SUGGESTIONS = ['מזומן', 'ביט', 'פייבוקס', 'העברה בנקאית', "צ'ק", 'אשראי'];

export default function GalleryPaymentsSection({ galleryId }: { galleryId: string }) {
  const [state, setState] = useState<PaymentsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(() => israelDateString(new Date()));
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');

  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/galleries/${galleryId}/payments`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setState(data);
      else setError(data.error ?? 'טעינת התשלומים נכשלה');
      setLoading(false);
    })();
  }, [galleryId]);

  async function send(url: string, init: RequestInit, fallbackError: string): Promise<boolean> {
    setError('');
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? fallbackError);
      return false;
    }
    setState(data);
    return true;
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    const ok = await send(
      `/api/galleries/${galleryId}/payments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount), paidOn, method, note }),
      },
      'הוספת התשלום נכשלה'
    );
    setWorking(false);
    if (ok) {
      setAmount('');
      setNote('');
      setMethod('');
      setPaidOn(israelDateString(new Date()));
    }
  }

  async function handleDeletePayment(payment: Payment) {
    if (!window.confirm(`למחוק את התשלום של ${formatShekels(payment.amount)}?`)) return;
    setDeletingId(payment.id);
    await send(`/api/galleries/${galleryId}/payments/${payment.id}`, { method: 'DELETE' }, 'מחיקת התשלום נכשלה');
    setDeletingId(null);
  }

  async function saveOverride(value: string | null) {
    setWorking(true);
    const ok = await send(
      `/api/galleries/${galleryId}/payments`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountDueOverride: value }),
      },
      'עדכון הסכום לתשלום נכשל'
    );
    setWorking(false);
    if (ok) setEditingTotal(false);
  }

  const sectionStyle = { marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` };

  if (loading) {
    return (
      <div style={sectionStyle}>
        <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.5rem' }}>תשלומים</h2>
        <p style={{ color: theme.textMuted, fontSize: 13 }}>טוען...</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div style={sectionStyle}>
        <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.5rem' }}>תשלומים</h2>
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8 }}>{error}</p>
      </div>
    );
  }

  const { summary, payments, paidAt } = state;
  // "איך נוח לך לשלם?" בגלריה (components/ClientPayButton.tsx)
  const choice = state.clientPaymentChoice;
  const choiceLabel = paymentMethodLabel(choice);
  const balanceColor = summary.balance > 0 && !paidAt ? theme.warningText : theme.successText;

  let balanceLabel: string;
  if (summary.balance > 0 && paidAt) balanceLabel = `סומן כשולם (נותרו ${formatShekels(summary.balance)} לא רשומים)`;
  else if (summary.balance > 0) balanceLabel = formatShekels(summary.balance);
  else if (summary.balance < 0) balanceLabel = `שולם ביתר ${formatShekels(-summary.balance)}`;
  else balanceLabel = summary.total > 0 || summary.paid > 0 ? 'שולם במלואו ✓' : '₪0';

  return (
    <div style={sectionStyle}>
      <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.5rem' }}>תשלומים</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '1rem' }}>
        רישום התשלומים שקיבלת מהלקוחה. כשהתשלומים מכסים את הסכום לתשלום, הגלריה מסומנת אוטומטית כ&quot;שולם&quot; ברשימת הגלריות
        (ואם מוחקים תשלום והיתרה נפתחת שוב - הסימון יורד).
      </p>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {[
          { label: 'לתשלום', value: formatShekels(summary.total), color: theme.text },
          { label: 'שולם', value: formatShekels(summary.paid), color: theme.gold },
          { label: 'יתרה', value: balanceLabel, color: balanceColor },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              flex: '1 1 110px', background: theme.panel, border: `1px solid ${theme.border}`,
              borderRadius: 10, padding: '0.65rem 0.85rem', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: stat.value.length > 12 ? 13 : 18, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: '0.15rem' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {choiceLabel && isPaymentMethodType(choice) && (
        <p
          style={{
            background: theme.panel, border: `1px solid ${theme.borderLight}`, borderRadius: 8,
            padding: '0.5rem 0.75rem', fontSize: 14, marginBottom: '1rem',
          }}
        >
          {PAYMENT_METHOD_ICONS[choice]} הלקוחה בחרה לשלם: <b>{choiceLabel}</b>
          {state.clientPaymentChoiceAt && (
            <span style={{ color: theme.textFaint, fontSize: 12 }}> · {formatIsraelDate(state.clientPaymentChoiceAt)}</span>
          )}
        </p>
      )}

      {editingTotal ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveOverride(totalInput);
          }}
          style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}
        >
          <input
            type="number"
            min={0}
            step="any"
            value={totalInput}
            onChange={(e) => setTotalInput(e.target.value)}
            placeholder="סכום לתשלום (₪)"
            style={{ ...inputStyle, width: 160 }}
            autoFocus
            required
          />
          <button type="submit" disabled={working} style={{ ...goldButtonStyle, padding: '0.5rem 1rem', opacity: working ? 0.6 : 1 }}>
            שמירה
          </button>
          <button type="button" onClick={() => setEditingTotal(false)} style={{ ...outlineButtonStyle, padding: '0.5rem 1rem' }}>
            ביטול
          </button>
        </form>
      ) : (
        <p style={{ color: theme.textFaint, fontSize: 12, marginBottom: '1rem' }}>
          {summary.isOverridden
            ? `סכום שקבעת ידנית (לפי החבילה: ${formatShekels(summary.packageAmount)}). `
            : 'מחושב אוטומטית מהחבילה השמורה: מחיר חבילה + תמונות נוספות מעבר לכלולות. '}
          <button
            type="button"
            onClick={() => {
              setTotalInput(String(summary.total));
              setEditingTotal(true);
            }}
            style={{ background: 'none', border: 'none', color: theme.gold, cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline' }}
          >
            שינוי הסכום
          </button>
          {summary.isOverridden && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => saveOverride(null)}
                disabled={working}
                style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline' }}
              >
                חזרה לחישוב אוטומטי
              </button>
            </>
          )}
        </p>
      )}

      {payments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
          {payments.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                padding: '0.55rem 0.8rem', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                <span>
                  <b style={{ color: theme.gold }}>{formatShekels(p.amount)}</b>
                  <span style={{ color: theme.textMuted }}>
                    {' · '}
                    {toHebrewDateString(new Date(`${p.paid_on}T12:00:00`))}
                    {p.method ? ` · ${p.method}` : ''}
                  </span>
                </span>
                {p.note && <span style={{ color: theme.textFaint, fontSize: 12 }}>{p.note}</span>}
              </div>
              <button
                type="button"
                onClick={() => handleDeletePayment(p)}
                disabled={deletingId === p.id}
                title="מחיקת התשלום"
                style={{
                  background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: 16,
                  opacity: deletingId === p.id ? 0.5 : 1,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAddPayment} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="number"
            min={0.01}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="סכום (₪)"
            style={{ ...inputStyle, flex: '1 1 110px' }}
            required
          />
          <input
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            style={{ ...inputStyle, flex: '1 1 140px' }}
            required
          />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            list="payment-method-suggestions"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="אמצעי תשלום (אופציונלי)"
            style={{ ...inputStyle, flex: '1 1 140px' }}
          />
          <datalist id="payment-method-suggestions">
            {METHOD_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="הערה (למשל: מקדמה)"
            style={{ ...inputStyle, flex: '1 1 140px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="submit" disabled={working} style={{ ...outlineButtonStyle, borderColor: theme.gold, color: theme.gold, opacity: working ? 0.6 : 1 }}>
            {working ? 'שומרת...' : '+ הוספת תשלום'}
          </button>
          {summary.balance > 0 && !paidAt && (
            <button
              type="button"
              onClick={() => setAmount(String(summary.balance))}
              title="ממלא את סכום היתרה בשדה הסכום"
              style={{ ...outlineButtonStyle, padding: '0.5rem 0.9rem', fontSize: 12 }}
            >
              מילוי היתרה ({formatShekels(summary.balance)})
            </button>
          )}
        </div>
      </form>

      {error && (
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
