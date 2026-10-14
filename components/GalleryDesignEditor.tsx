'use client';

import { useState } from 'react';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import {
  THEME_PRESETS,
  extractLogoColors,
  textOn,
  themeWarnings,
  themesFromLogo,
  type GalleryColors,
} from '@/lib/galleryTheme';

// "עיצוב הגלריה" בהגדרות: הצלמת בוחרת את צבעי הגלריה שהלקוחות רואות - כל
// אלמנט בנפרד, מתוך פלטות מוכנות, או מהצבעים של הלוגו שלה. נשמר ל-
// photographers.custom_theme (וצבע הכפתורים גם ל-brand_color), ראו lib/galleryTheme.ts.

const ELEMENTS: { key: keyof GalleryColors; label: string; hint: string }[] = [
  { key: 'bg', label: 'רקע הגלריה', hint: 'הצבע של כל הדף' },
  { key: 'panel', label: 'כרטיסים וחלונות', hint: 'מסגרות התמונות, חלונות ותפריטים' },
  { key: 'text', label: 'טקסט', hint: 'כותרות והסברים (הגוונים המשניים נגזרים ממנו)' },
  { key: 'accent', label: 'כפתורים והדגשה', hint: 'כפתורים, לב הבחירה, פס ההתקדמות' },
];

interface Props {
  savedTheme: GalleryColors | null;
  brandColor: string;
  logoUrl: string | null;
  onSaved: (saved: GalleryColors | null) => void;
}

export default function GalleryDesignEditor({ savedTheme, brandColor, logoUrl, onSaved }: Props) {
  const [draft, setDraft] = useState<GalleryColors>(
    () => savedTheme ?? { ...THEME_PRESETS[0].colors, accent: brandColor || THEME_PRESETS[0].colors.accent }
  );
  const [logoColors, setLogoColors] = useState<string[]>([]);
  const [readingLogo, setReadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiDescription, setAiDescription] = useState('');
  const [aiRunning, setAiRunning] = useState(false);

  const changed = !savedTheme || (Object.keys(draft) as (keyof GalleryColors)[]).some((k) => draft[k] !== savedTheme[k]);
  const warnings = themeWarnings(draft);
  const logoThemes = themesFromLogo(logoColors);

  function update(key: keyof GalleryColors, value: string) {
    setMessage(null);
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  // קריאת הצבעים מהלוגו בדפדפן (canvas) - הלוגו יושב ב-bucket ציבורי עם CORS
  async function readLogoColors() {
    if (!logoUrl) return;
    setReadingLogo(true);
    setMessage(null);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('load'));
        img.src = `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}palette=1`;
      });
      const size = 120;
      const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const colors = extractLogoColors(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      if (colors.length === 0) {
        setMessage({ ok: false, text: 'לא נמצאו צבעים בלוגו' });
      }
      setLogoColors(colors);
    } catch {
      setMessage({ ok: false, text: 'לא הצלחנו לקרוא את הצבעים מהלוגו - נסי להעלות אותו שוב (PNG או JPG)' });
    } finally {
      setReadingLogo(false);
    }
  }

  async function runAi(e: React.FormEvent) {
    e.preventDefault();
    setAiRunning(true);
    setMessage(null);
    try {
      const res = await fetch('/api/photographer/design-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.theme) {
        setMessage({ ok: false, text: data.error ?? 'העיצוב במילים לא זמין כרגע' });
        return;
      }
      setDraft(data.theme);
    } catch {
      setMessage({ ok: false, text: 'העיצוב במילים לא זמין כרגע' });
    } finally {
      setAiRunning(false);
    }
  }

  async function save(next: GalleryColors | null) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/photographer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next ? { customTheme: next, brandColor: next.accent } : { customTheme: null }),
      });
      if (!res.ok) {
        setMessage({ ok: false, text: 'השמירה נכשלה, נסי שוב' });
        return;
      }
      onSaved(next);
      if (!next) setDraft({ ...THEME_PRESETS[0].colors });
      setMessage({ ok: true, text: next ? 'העיצוב נשמר - הלקוחות יראו אותו בפעם הבאה שייכנסו לגלריה' : 'חזרת לעיצוב המקורי' });
    } catch {
      setMessage({ ok: false, text: 'השמירה נכשלה - בדקי את החיבור לאינטרנט' });
    } finally {
      setSaving(false);
    }
  }

  const swatch = (color: string, selected: boolean, onClick: () => void, title: string) => (
    <button
      key={title + color}
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={selected}
      style={{
        width: 26, height: 26, minHeight: 26, borderRadius: '50%', background: color, cursor: 'pointer', padding: 0,
        border: selected ? `2px solid ${theme.text}` : `1px solid ${theme.borderLight}`,
      }}
    />
  );

  return (
    <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` }}>
      <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.35rem' }}>עיצוב הגלריה</h2>
      <p style={{ color: theme.textMuted, fontSize: 13, margin: '0 0 1rem' }}>
        הצבעים שהלקוחות רואים בגלריה שלהן. אפשר לבחור פלטה מוכנה, לקחת את הצבעים מהלוגו, ולשנות כל חלק בנפרד.
      </p>

      {/* פלטות מוכנות */}
      <div style={{ fontSize: 13, marginBottom: '0.4rem' }}>פלטות מוכנות</div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {[...logoThemes, ...THEME_PRESETS].map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => { setMessage(null); setDraft(preset.colors); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.6rem', borderRadius: 999, cursor: 'pointer',
              background: preset.colors.bg, color: preset.colors.text, fontSize: 12, minHeight: 34,
              border: `1px solid ${preset.colors.accent}`,
            }}
          >
            <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: preset.colors.accent }} />
            {preset.name}
          </button>
        ))}
      </div>

      {/* צבעים מהלוגו */}
      {logoUrl ? (
        <div style={{ marginBottom: '1rem' }}>
          <button type="button" onClick={readLogoColors} disabled={readingLogo} style={{ ...outlineButtonStyle, padding: '0.4rem 0.9rem', fontSize: 13 }}>
            {readingLogo ? 'קוראת את הלוגו...' : logoColors.length ? '🎨 קריאה מחדש של צבעי הלוגו' : '🎨 צבעים לפי הלוגו שלי'}
          </button>
          {logoColors.length > 0 && (
            <p style={{ color: theme.textFaint, fontSize: 12, margin: '0.4rem 0 0' }}>
              נוספו למעלה שתי פלטות לפי הלוגו, וליד כל חלק למטה מופיעים צבעי הלוגו לבחירה מהירה.
            </p>
          )}
        </div>
      ) : (
        <p style={{ color: theme.textFaint, fontSize: 12, margin: '0 0 1rem' }}>העלי לוגו (למעלה בדף) כדי לקבל עיצוב לפי הצבעים שלו.</p>
      )}

      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* בחירה לכל אלמנט */}
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {ELEMENTS.map((el) => (
            <div key={el.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <input
                  type="color"
                  value={draft[el.key]}
                  onChange={(e) => update(el.key, e.target.value)}
                  aria-label={el.label}
                  style={{ width: 44, height: 36, padding: 2, background: theme.panelInput, border: `1px solid ${theme.border}`, borderRadius: 4, cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: 14 }}>{el.label}</div>
                  <div style={{ fontSize: 11, color: theme.textFaint }}>{el.hint}</div>
                </div>
              </div>
              {logoColors.length > 0 && (
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', paddingInlineStart: 52 }}>
                  {logoColors.map((c) => swatch(c, draft[el.key] === c, () => update(el.key, c), `${el.label}: ${c}`))}
                  {swatch('#ffffff', draft[el.key] === '#ffffff', () => update(el.key, '#ffffff'), `${el.label}: לבן`)}
                  {swatch('#111111', draft[el.key] === '#111111', () => update(el.key, '#111111'), `${el.label}: שחור`)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* תצוגה מקדימה - כמו הגלריה של הלקוחה */}
        <div
          aria-label="תצוגה מקדימה של הגלריה"
          style={{ flex: '1 1 260px', background: draft.bg, color: draft.text, borderRadius: 12, padding: '1rem', border: `1px solid ${theme.border}` }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: '0.5rem' }}>תצוגה מקדימה</div>
          <div style={{ fontFamily: theme.fontSerif, fontSize: 18, marginBottom: '0.15rem' }}>הגלריה של משפחת כהן</div>
          <div style={{ fontSize: 12, opacity: 0.66, marginBottom: '0.75rem' }}>
            נבחרו <b style={{ color: draft.accent }}>12</b> / 30 בחבילה
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: '0.75rem' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ background: draft.panel, borderRadius: 6, padding: 4, border: i === 0 ? `2px solid ${draft.accent}` : '2px solid transparent' }}>
                <div style={{ aspectRatio: '3/4', borderRadius: 4, background: `linear-gradient(160deg, ${draft.text}22, ${draft.text}08)` }} />
                <div style={{ fontSize: 10, textAlign: 'center', marginTop: 3, color: i === 0 ? draft.accent : draft.text, opacity: i === 0 ? 1 : 0.6 }}>
                  {i === 0 ? '♥ נבחרה' : `#${i + 1}`}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ background: draft.accent, color: textOn(draft.accent), borderRadius: 4, padding: '0.45rem 0.9rem', fontSize: 12, fontWeight: 700 }}>
              סיימתי לבחור
            </span>
            <span style={{ border: `1px solid ${draft.text}33`, color: draft.text, opacity: 0.75, borderRadius: 4, padding: '0.45rem 0.9rem', fontSize: 12, fontWeight: 700 }}>
              ⚡ בחירה מהירה
            </span>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <ul style={{ background: theme.warningBg, color: theme.warningText, borderRadius: 8, padding: '0.6rem 1.6rem', fontSize: 13, margin: '1rem 0 0' }}>
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
        <button type="button" onClick={() => save(draft)} disabled={saving || !changed} style={{ ...goldButtonStyle, opacity: saving || !changed ? 0.6 : 1 }}>
          {saving ? 'שומרת...' : 'שמירת העיצוב'}
        </button>
        {savedTheme && changed && (
          <button type="button" onClick={() => { setMessage(null); setDraft(savedTheme); }} style={outlineButtonStyle}>
            ביטול השינויים
          </button>
        )}
        {savedTheme && (
          <button type="button" onClick={() => save(null)} disabled={saving} style={{ background: 'none', border: 'none', color: theme.textFaint, fontSize: 12, cursor: 'pointer', padding: 0 }}>
            חזרה לעיצוב המקורי
          </button>
        )}
      </div>

      {message && (
        <p style={{ color: message.ok ? theme.successText : theme.errorText, fontSize: 13, margin: '0.6rem 0 0' }}>{message.text}</p>
      )}

      <details style={{ marginTop: '1.25rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: theme.textMuted }}>✨ או: לתאר במילים איך הגלריה תיראה</summary>
        <form onSubmit={runAi} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.6rem' }}>
          <textarea
            value={aiDescription}
            onChange={(e) => setAiDescription(e.target.value)}
            placeholder="למשל: רומנטי ופסטלי, בהיר וחמים · או: כהה ודרמטי כמו מגזין יוקרה"
            rows={2}
            maxLength={300}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div>
            <button type="submit" disabled={aiRunning || !aiDescription.trim()} style={{ ...outlineButtonStyle, opacity: aiRunning || !aiDescription.trim() ? 0.6 : 1 }}>
              {aiRunning ? 'מעצבת...' : 'עצבי לי'}
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
