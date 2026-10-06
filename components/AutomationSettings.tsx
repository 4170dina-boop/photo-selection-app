'use client';

import { useEffect, useState } from 'react';
import { theme } from '@/lib/theme';

// בלוק "אוטומציות" בהגדרות (app/dashboard/settings/page.tsx) - נפרד מטופס
// ההגדרות הראשי: כל מתג נשמר מיד בלחיצה דרך app/api/photographer/automations.
type Field = 'respectShabbat' | 'anniversaryEmails';

export default function AutomationSettings() {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [values, setValues] = useState<Record<Field, boolean>>({ respectShabbat: true, anniversaryEmails: false });
  const [saving, setSaving] = useState<Field | null>(null);
  const [error, setError] = useState('');
  const [savedField, setSavedField] = useState<Field | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/photographer/automations');
        if (res.ok) {
          const data = await res.json();
          setValues({ respectShabbat: data.respect_shabbat !== false, anniversaryEmails: data.anniversary_emails === true });
          setAvailable(data.available !== false);
        } else {
          setError('טעינת האוטומציות נכשלה');
        }
      } catch {
        setError('טעינת האוטומציות נכשלה');
      }
      setLoading(false);
    })();
  }, []);

  async function toggle(field: Field, next: boolean) {
    setError('');
    setSavedField(null);
    const previous = values[field];
    setValues((v) => ({ ...v, [field]: next }));
    setSaving(field);
    let ok = false;
    try {
      const res = await fetch('/api/photographer/automations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      ok = res.ok;
      if (!ok) {
        const data = await res.json().catch(() => ({}));
        if (data.missingColumns) setAvailable(false);
        setError(data.error ?? 'השמירה נכשלה, נסי שוב');
      }
    } catch {
      setError('השמירה נכשלה, נסי שוב');
    }
    setSaving(null);
    if (ok) setSavedField(field);
    else setValues((v) => ({ ...v, [field]: previous }));
  }

  const row = (field: Field, label: string, hint: string) => (
    <div style={{ marginBottom: '0.9rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: available ? 'pointer' : 'default' }}>
        <input
          type="checkbox"
          checked={values[field]}
          disabled={!available || saving !== null}
          onChange={(e) => toggle(field, e.target.checked)}
        />
        {label}
        {saving === field && <span style={{ color: theme.textFaint, fontSize: 12 }}>שומרת...</span>}
        {savedField === field && <span style={{ color: theme.successText, fontSize: 12 }}>נשמר!</span>}
      </label>
      <span style={{ color: theme.textFaint, fontSize: 12, display: 'block', marginTop: '0.3rem' }}>{hint}</span>
    </div>
  );

  return (
    <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` }}>
      <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.75rem' }}>אוטומציות</h2>
      {loading ? (
        <p style={{ color: theme.textMuted, fontSize: 13 }}>טוען...</p>
      ) : (
        <>
          {!available && (
            <p style={{ background: theme.warningBg, color: theme.warningText, padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: 13, marginBottom: '0.75rem' }}>
              כדי לשנות את האוטומציות צריך להריץ פעם אחת את המיגרציה &quot;אוטומציות&quot; בסוף supabase/schema.sql.
              עד אז: לא נשלחים מיילים ללקוחות בשבת ובחג, ומייל &quot;לפני שנה&quot; כבוי.
            </p>
          )}
          {row(
            'respectShabbat',
            'לא לשלוח מיילים אוטומטיים ללקוחות בשבת ובחג',
            'תזכורות תפוגה, תזכורות לפני צילום ומייל "לפני שנה" יוצאים ביום החול הבא. גלריה שהתוקף שלה נופל בשבת/חג תישאר פתוחה עד סוף יום החול שאחריו.'
          )}
          {row(
            'anniversaryEmails',
            'לשלוח ללקוחות מייל "לפני שנה צילמנו 💛"',
            'כ-11 חודשים אחרי שסימנת גלריה כנמסרה, הלקוחה מקבלת מייל אישי (בשפת הגלריה, עם הלוגו שלך) שמזמין לתאם צילום נוסף. תשובה למייל מגיעה ישירות אלייך. פעם אחת לכל גלריה.'
          )}
          {error && (
            <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 13 }}>{error}</p>
          )}
        </>
      )}
    </div>
  );
}
