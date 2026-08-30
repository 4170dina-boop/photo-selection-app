'use client';

import { useEffect, useState } from 'react';
import { theme, inputStyle, goldButtonStyle } from '@/lib/theme';

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState('');
  const [watermarkText, setWatermarkText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/photographer');
      if (res.ok) {
        const data = await res.json();
        setBusinessName(data.business_name ?? '');
        setWatermarkText(data.watermark_text ?? '');
      }
      setLoading(false);
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);

    const res = await fetch('/api/photographer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watermarkText }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'עדכון ההגדרות נכשל');
      return;
    }

    setSaved(true);
  }

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  return (
    <div style={{ maxWidth: 420 }}>
      <h1 style={{ fontFamily: theme.fontSerif, fontSize: 20, marginBottom: '1.5rem' }}>הגדרות</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          טקסט סימן המים
          <input
            type="text"
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            placeholder={businessName || 'שם העסק שלך'}
            maxLength={60}
            style={inputStyle}
          />
          <span style={{ color: theme.textFaint, fontSize: 12 }}>
            הטקסט שיוטבע על כל תמונה שהלקוחה רואה בגלריה (עד 60 תווים). אם משאירים ריק - יוצג
            {businessName ? ` "${businessName}"` : ' שם העסק'} כברירת מחדל.
          </span>
        </label>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', alignItems: 'center' }}>
          <button type="submit" disabled={saving} style={{ ...goldButtonStyle, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'שומר...' : 'שמירה'}
          </button>
          {saved && <span style={{ color: theme.successText, fontSize: 13 }}>נשמר!</span>}
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
