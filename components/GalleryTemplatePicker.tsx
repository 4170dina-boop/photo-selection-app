'use client';

import { useEffect, useState } from 'react';
import { theme, inputStyle, outlineButtonStyle } from '@/lib/theme';
import { templateSummary, type GalleryTemplate, type GalleryTemplateData } from '@/lib/galleryTemplates';

// "תבנית:" בטופס גלריה חדשה - בחירה ממלאת חבילה, תוקף (היום + ימים), לשון
// פנייה ושפה; "שמירה כתבנית" שומרת את הערכים שבטופס כרגע. ניהול (שינוי
// שם/מחיקה): components/GalleryTemplatesManager.tsx בהגדרות. כל הרכיב מוסתר
// כשהטבלה עוד לא קיימת (available: false מ-/api/gallery-templates).
interface GalleryTemplatePickerProps {
  // הערכים הנוכחיים בטופס - ל"שמירה כתבנית"
  current: () => GalleryTemplateData;
  onApply: (data: GalleryTemplateData, name: string) => void;
}

export default function GalleryTemplatePicker({ current, onApply }: GalleryTemplatePickerProps) {
  const [available, setAvailable] = useState(false);
  const [templates, setTemplates] = useState<GalleryTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
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

  function handleSelect(id: string) {
    setSelectedId(id);
    setMessage('');
    setError('');
    const template = templates.find((t) => t.id === id);
    if (template) onApply(template.data, template.name);
  }

  async function handleSave() {
    const name = window.prompt('שם לתבנית (למשל: חתונה, בר מצווה, ניובורן):');
    if (name === null) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/gallery-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data: current() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'שמירת התבנית נכשלה');
        return;
      }
      setTemplates((prev) => [...prev, data.template].sort((a, b) => a.name.localeCompare(b.name, 'he')));
      setSelectedId(data.template.id);
      setMessage(`התבנית "${data.template.name}" נשמרה ✓`);
    } catch {
      setError('שגיאת רשת - בדקי את החיבור ונסי שוב');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 200 }}>
          תבנית:
          <select value={selectedId} onChange={(e) => handleSelect(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
            <option value="">{templates.length === 0 ? 'אין עדיין תבניות' : 'בחירת תבנית...'}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({templateSummary(t.data)})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          title="שמירת החבילה, התוקף, לשון הפנייה והשפה שבטופס כתבנית לגלריות הבאות"
          style={{ ...outlineButtonStyle, padding: '0.4rem 0.8rem', fontSize: 13, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'שומרת...' : 'שמירה כתבנית'}
        </button>
      </div>
      {message && <span style={{ fontSize: 12.5, color: theme.successText }}>{message}</span>}
      {error && <span style={{ fontSize: 12.5, color: theme.errorText }}>{error}</span>}
    </div>
  );
}
