'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { theme, outlineButtonStyle } from '@/lib/theme';
import { templateSummary, type GalleryTemplate } from '@/lib/galleryTemplates';

// "תבניות גלריה" בהגדרות - רשימה, שינוי שם ומחיקה. יצירה: "שמירה כתבנית"
// בטופס גלריה חדשה (components/GalleryTemplatePicker.tsx). מוסתר כשהטבלה
// עוד לא קיימת (available: false).
export default function GalleryTemplatesManager() {
  const [available, setAvailable] = useState(false);
  const [templates, setTemplates] = useState<GalleryTemplate[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/gallery-templates')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setAvailable(!!data.available);
        setTemplates(data.templates ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  async function handleRename(template: GalleryTemplate) {
    const name = window.prompt('שם חדש לתבנית:', template.name);
    if (name === null || name.trim() === template.name) return;
    setBusyId(template.id);
    setError('');
    try {
      const res = await fetch(`/api/gallery-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'שינוי השם נכשל');
        return;
      }
      setTemplates((prev) => prev.map((t) => (t.id === template.id ? { ...t, name: data.template.name } : t)));
    } catch {
      setError('שגיאת רשת - בדקי את החיבור ונסי שוב');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(template: GalleryTemplate) {
    if (!window.confirm(`למחוק את התבנית "${template.name}"? גלריות שכבר נוצרו ממנה לא משתנות.`)) return;
    setBusyId(template.id);
    setError('');
    try {
      const res = await fetch(`/api/gallery-templates/${template.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'מחיקת התבנית נכשלה');
        return;
      }
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
    } catch {
      setError('שגיאת רשת - בדקי את החיבור ונסי שוב');
    } finally {
      setBusyId(null);
    }
  }

  const smallButton = { ...outlineButtonStyle, padding: '0.25rem 0.65rem', fontSize: 12.5 };

  return (
    <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` }}>
      <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.5rem' }}>תבניות גלריה</h2>
      {templates.length === 0 ? (
        <p style={{ color: theme.textMuted, fontSize: 13 }}>
          אין עדיין תבניות. אפשר לשמור תבנית (חבילה, תוקף, לשון פנייה ושפה) מתוך{' '}
          <Link href="/dashboard/galleries/new" style={{ color: theme.gold }}>
            גלריה חדשה
          </Link>{' '}
          ← &quot;שמירה כתבנית&quot;.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {templates.map((t) => (
            <li
              key={t.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap',
                background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '0.5rem 0.75rem',
                opacity: busyId === t.id ? 0.6 : 1,
              }}
            >
              <div>
                <div style={{ fontSize: 14 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: theme.textMuted }}>{templateSummary(t.data)}</div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button type="button" onClick={() => handleRename(t)} disabled={busyId === t.id} style={smallButton}>
                  שינוי שם
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t)}
                  disabled={busyId === t.id}
                  style={{ ...smallButton, borderColor: theme.errorText, color: theme.errorText }}
                >
                  מחיקה
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p style={{ color: theme.errorText, fontSize: 13, marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}
