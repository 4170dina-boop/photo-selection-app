'use client';

import { useState } from 'react';
import Link from 'next/link';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';

interface CreatedGallery {
  galleryId: string;
  accessCode: string;
}

export default function NewGalleryPage() {
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [includedPhotos, setIncludedPhotos] = useState('30');
  const [extraPhotoPrice, setExtraPhotoPrice] = useState('0');
  const [expiresAt, setExpiresAt] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedGallery | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await fetch('/api/galleries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName,
        clientEmail,
        includedPhotos: Number(includedPhotos),
        extraPhotoPrice: Number(extraPhotoPrice),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'יצירת הגלריה נכשלה');
      return;
    }

    const data = await res.json();
    setCreated(data);
  }

  if (created) {
    const galleryUrl = `${window.location.origin}/gallery/${created.galleryId}`;

    return (
      <div style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 20, marginBottom: '1rem', color: theme.gold }}>✓ הגלריה נוצרה!</h1>
        <p style={{ marginBottom: '1rem', color: theme.textMuted }}>שלחי ללקוחה את הקישור והקוד הבאים:</p>

        <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: '0.25rem' }}>קישור לגלריה</div>
            <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{galleryUrl}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: '0.25rem' }}>קוד גישה</div>
            <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 'bold', color: theme.gold, letterSpacing: 1 }}>{created.accessCode}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(`${galleryUrl}\nקוד גישה: ${created.accessCode}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            style={goldButtonStyle}
          >
            {copied ? 'הועתק!' : 'העתקת קישור וקוד'}
          </button>
          <Link href={`/dashboard/upload/${created.galleryId}`} style={{ ...outlineButtonStyle, textDecoration: 'none' }}>
            להעלאת תמונות
          </Link>
          <Link href="/dashboard/galleries" style={{ ...outlineButtonStyle, textDecoration: 'none', border: 'none', color: theme.textMuted }}>
            חזרה לרשימת הגלריות
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h1 style={{ fontSize: 20, marginBottom: '1.5rem' }}>גלריה חדשה</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          שם הלקוחה
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            style={inputStyle}
            required
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          אימייל הלקוחה
          <input
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            style={inputStyle}
            required
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          תמונות כלולות בחבילה
          <input
            type="number"
            min={0}
            value={includedPhotos}
            onChange={(e) => setIncludedPhotos(e.target.value)}
            style={inputStyle}
            required
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          מחיר לתמונה נוספת (₪)
          <input
            type="number"
            min={0}
            step="0.01"
            value={extraPhotoPrice}
            onChange={(e) => setExtraPhotoPrice(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          תוקף הגלריה (אופציונלי)
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            style={inputStyle}
          />
        </label>

        <button type="submit" disabled={loading} style={{ ...goldButtonStyle, marginTop: '0.5rem', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'יוצרת גלריה...' : 'יצירת גלריה'}
        </button>
      </form>

      {error && (
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
