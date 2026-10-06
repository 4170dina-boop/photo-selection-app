'use client';

import { useEffect, useState } from 'react';
import { theme, inputStyle, outlineButtonStyle } from '@/lib/theme';
import {
  PAYMENT_METHOD_ICONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_TEXT_MAX,
  emptyPaymentMethods,
  normalizePaymentMethods,
  parsePaymentMethodsInput,
  type PaymentMethod,
  type PaymentMethodType,
} from '@/lib/paymentMethods';

// "אמצעי תשלום שאת מקבלת" בהגדרות (app/dashboard/settings) - בלוק עצמאי עם
// כפתור שמירה משלו (PATCH /api/photographer עם paymentMethods בלבד), כדי לא
// לגעת בשאר הטופס. הלקוחה תראה אחרי הבחירה "איך נוח לך לשלם?" עם האמצעים
// שמופעלים כאן (components/ClientPayButton.tsx). אין עיבוד תשלומים - רק פרטים.

const PLACEHOLDERS: Record<PaymentMethodType, string> = {
  bank: 'בנק, סניף, מספר חשבון, שם המוטב',
  cash: 'למשל: בעת מסירת התמונות',
  check: 'למשל: לפקודת רחל כהן',
  phone: '050-1234567',
  bit: 'https://www.bitpay.co.il/...',
  paybox: 'https://...',
};

const FIELD_LABELS: Record<PaymentMethodType, string> = {
  bank: 'פרטי החשבון (הלקוחה תוכל להעתיק את מספר החשבון בלחיצה)',
  cash: 'הערה ללקוחה (אופציונלי)',
  check: 'הערה ללקוחה (אופציונלי)',
  phone: 'מספר טלפון לתיאום',
  bit: 'קישור לתשלום בביט',
  paybox: 'קישור PayBox',
};

const MAIN_TYPES: PaymentMethodType[] = ['bank', 'cash', 'check', 'phone'];
const APP_TYPES: PaymentMethodType[] = ['bit', 'paybox'];

export default function PaymentMethodsSettings() {
  const [methods, setMethods] = useState<PaymentMethod[]>(emptyPaymentMethods);
  const [source, setSource] = useState<'methods' | 'legacy' | 'none'>('methods');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/photographer');
        if (res.ok) {
          const data = await res.json();
          setMethods(normalizePaymentMethods({ payment_methods: data.payment_methods }));
          if (data.payment_methods_source === 'legacy' || data.payment_methods_source === 'none') setSource(data.payment_methods_source);
        }
      } catch {
        // שקט - נשארים עם ברירת המחדל (הכל כבוי)
      }
      setLoading(false);
    })();
  }, []);

  function update(type: PaymentMethodType, patch: Partial<PaymentMethod>) {
    setSaved(false);
    setMethods((prev) => prev.map((m) => (m.type === type ? { ...m, ...patch } : m)));
  }

  async function handleSave() {
    setError('');
    setNotice('');
    setSaved(false);
    // בדיקה מקדימה בדפדפן (השרת בודק שוב)
    const r = parsePaymentMethodsInput(methods);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/photographer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethods: r.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'שמירת אמצעי התשלום נכשלה');
        return;
      }
      setMethods(r.value);
      if (data.paymentMethodsSaved === 'legacy') {
        setSource('legacy');
        setNotice('נשמרו רק העברה בנקאית, ביט ו-PayBox. כדי לשמור גם מזומן, צ\'ק ותיאום טלפוני צריך להריץ את המיגרציה "אמצעי תשלום" בסוף supabase/schema.sql.');
      } else if (data.paymentMethodsSaved === 'none') {
        setSource('none');
        setNotice('אמצעי התשלום לא נשמרו - צריך להריץ את המיגרציה "אמצעי תשלום" בסוף supabase/schema.sql.');
      }
      setSaved(true);
    } catch {
      setError('שמירת אמצעי התשלום נכשלה - בדקי את החיבור ונסי שוב');
    } finally {
      setSaving(false);
    }
  }

  function renderMethod(type: PaymentMethodType) {
    const m = methods.find((x) => x.type === type)!;
    const multiline = type === 'bank';
    const isUrl = type === 'bit' || type === 'paybox';
    const fieldId = `payment-method-${type}`;
    return (
      <div
        key={type}
        style={{
          padding: '0.65rem 0.75rem', borderRadius: 8,
          border: `1px solid ${m.enabled ? theme.borderLight : theme.border}`,
          background: m.enabled ? theme.panelInput : 'transparent',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: m.enabled ? 700 : 400 }}>
          <input type="checkbox" checked={m.enabled} onChange={(e) => update(type, { enabled: e.target.checked })} disabled={loading} />
          <span aria-hidden="true">{PAYMENT_METHOD_ICONS[type]}</span>
          {PAYMENT_METHOD_LABELS[type]}
        </label>
        {m.enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem' }}>
            <label htmlFor={fieldId} style={{ fontSize: 13, color: theme.textMuted }}>{FIELD_LABELS[type]}</label>
            {multiline ? (
              <textarea
                id={fieldId}
                value={m.text}
                onChange={(e) => update(type, { text: e.target.value })}
                placeholder={PLACEHOLDERS[type]}
                maxLength={PAYMENT_METHOD_TEXT_MAX[type]}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            ) : (
              <input
                id={fieldId}
                type={isUrl ? 'url' : type === 'phone' ? 'tel' : 'text'}
                dir={isUrl || type === 'phone' ? 'ltr' : undefined}
                value={m.text}
                onChange={(e) => update(type, { text: e.target.value })}
                placeholder={PLACEHOLDERS[type]}
                maxLength={PAYMENT_METHOD_TEXT_MAX[type]}
                style={inputStyle}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '1rem', marginTop: '0.25rem' }}>
      <span style={{ fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>אמצעי תשלום שאת מקבלת</span>
      <span style={{ color: theme.textFaint, fontSize: 12, display: 'block', marginBottom: '0.75rem' }}>
        הלקוחה תראה אחרי הבחירה &quot;💳 תשלום&quot; עם הסכום, ותבחר איך נוח לה לשלם מתוך האמצעים שמופעלים כאן.
        הבחירה שלה תופיע לך באזור התשלומים בעריכת הגלריה. האפליקציה לא מעבדת תשלומים - את התשלום עצמו ממשיכים לרשום ידנית.
      </span>
      {source !== 'methods' && (
        <p style={{ background: theme.warningBg, color: theme.warningText, padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: 13, marginBottom: '0.75rem' }}>
          {source === 'legacy'
            ? 'כרגע נשמרים רק העברה בנקאית, ביט ו-PayBox. כדי להפעיל את כל האמצעים צריך להריץ פעם אחת את המיגרציה "אמצעי תשלום" בסוף supabase/schema.sql.'
            : 'כדי להפעיל את אמצעי התשלום צריך להריץ פעם אחת את המיגרציות "קישורי תשלום" ו"אמצעי תשלום" בסוף supabase/schema.sql.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: loading ? 0.5 : 1 }}>
        {MAIN_TYPES.map(renderMethod)}
        <span style={{ color: theme.textFaint, fontSize: 12, marginTop: '0.35rem' }}>אפליקציות תשלום (אופציונלי, כבוי כברירת מחדל) - קישורים רק ב-https://</span>
        {APP_TYPES.map(renderMethod)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={handleSave} disabled={saving || loading} style={{ ...outlineButtonStyle, minHeight: 40 }}>
          {saving ? 'שומרת...' : 'שמירת אמצעי התשלום'}
        </button>
        {saved && !notice && <span role="status" style={{ color: theme.successText, fontSize: 13 }}>✓ נשמר</span>}
      </div>
      {error && <p role="alert" style={{ color: theme.errorText, fontSize: 13, marginTop: '0.5rem' }}>{error}</p>}
      {notice && <p role="status" style={{ color: theme.warningText, fontSize: 13, marginTop: '0.5rem' }}>{notice}</p>}
    </div>
  );
}
