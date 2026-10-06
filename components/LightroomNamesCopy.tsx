'use client';

import { useState } from 'react';
import { theme, outlineButtonStyle } from '@/lib/theme';
import { buildLightroomSearchString, lightroomCopiedToast, lightroomSearchNames } from '@/lib/lightroomSearch';
import { copyToClipboard } from './clipboard';

// "📋 העתקת שמות לחיפוש ב-Lightroom" - שמות הקבצים המקוריים של התמונות
// שנבחרו (+ מתנות), מופרדים ב-", ", להדבקה בשדה החיפוש של Lightroom /
// Capture One. השמות מ-/api/galleries/[id]/selected-photos?names=1 (בלי
// חתימת URLs). הלוגיקה: lib/lightroomSearch.ts.
export default function LightroomNamesCopy({ galleryId }: { galleryId: string }) {
  const [withExtension, setWithExtension] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  // כשההעתקה האוטומטית לא זמינה - מציגים את המחרוזת להעתקה ידנית
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  async function handleCopy() {
    setBusy(true);
    setError('');
    setToast('');
    setFallbackText(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/selected-photos?names=1`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      const filenames: string[] = (data.photos ?? []).map((p: { filename?: string }) => p.filename ?? '');
      const names = lightroomSearchNames(filenames, { withExtension });
      if (names.length === 0) {
        setError('אין עדיין תמונות שנבחרו בגלריה הזו.');
        return;
      }
      const text = buildLightroomSearchString(filenames, { withExtension });
      if (await copyToClipboard(text)) {
        setToast(lightroomCopiedToast(names.length));
        setTimeout(() => setToast(''), 3000);
      } else {
        setFallbackText(text);
      }
    } catch {
      setError('שליפת שמות התמונות נכשלה - נסי שוב');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem', marginTop: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleCopy}
          disabled={busy}
          title="שמות הקבצים המקוריים של התמונות שנבחרו (כולל מתנות), מופרדים בפסיק - להדבקה בחיפוש של Lightroom / Capture One"
          style={{ ...outlineButtonStyle, padding: '0.45rem 0.9rem', fontSize: 13, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'מעתיקה...' : '📋 העתקת שמות לחיפוש ב-Lightroom'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: 12.5, color: theme.textMuted, cursor: 'pointer' }}>
          <input type="checkbox" checked={withExtension} onChange={(e) => setWithExtension(e.target.checked)} />
          עם סיומת
        </label>
      </div>
      {toast && (
        <span role="status" style={{ fontSize: 13, color: theme.successText }}>
          {toast}
        </span>
      )}
      {error && <span style={{ fontSize: 13, color: theme.errorText }}>{error}</span>}
      {fallbackText !== null && (
        <textarea
          readOnly
          dir="ltr"
          value={fallbackText}
          onFocus={(e) => e.currentTarget.select()}
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: theme.panelInput,
            color: theme.text,
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
            fontFamily: 'monospace',
            fontSize: 12.5,
          }}
        />
      )}
    </div>
  );
}
