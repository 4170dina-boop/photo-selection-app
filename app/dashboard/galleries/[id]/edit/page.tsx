'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import MagicButton from '@/components/MagicButton';

interface EditGalleryPageProps {
  params: { id: string };
}

export default function EditGalleryPage({ params }: EditGalleryPageProps) {
  const galleryId = params.id;
  const router = useRouter();

  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [includedPhotos, setIncludedPhotos] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [extraPhotoPrice, setExtraPhotoPrice] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  async function loadGallery() {
    setLoading(true);
    const res = await fetch(`/api/galleries/${galleryId}`);

    if (!res.ok) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const data = await res.json();
    setClientName(data.clients?.full_name ?? '');
    setClientEmail(data.clients?.email ?? '');
    setIncludedPhotos(String(data.packages?.included_photos ?? 0));
    setBasePrice(String(data.packages?.base_price ?? 0));
    setExtraPhotoPrice(String(data.packages?.extra_photo_price ?? 0));
    setExpiresAt(data.expires_at ? data.expires_at.slice(0, 10) : '');
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);

    const res = await fetch(`/api/galleries/${galleryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName,
        clientEmail,
        includedPhotos: Number(includedPhotos),
        basePrice: Number(basePrice),
        extraPhotoPrice: Number(extraPhotoPrice),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'עדכון הגלריה נכשל');
      return;
    }

    router.push('/dashboard/galleries');
    router.refresh();
  }

  async function handleResendInvite() {
    setResendMessage('');
    setError('');
    setResending(true);

    const res = await fetch(`/api/galleries/${galleryId}/resend-invite`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setResending(false);

    if (!res.ok) {
      setError(data.error ?? 'שליחת ההזמנה נכשלה');
      return;
    }

    setResendMessage(data.emailSent ? 'ההזמנה נשלחה שוב בהצלחה' : 'שליחת המייל נכשלה - ודאו ששירות המייל מוגדר');
  }

  async function handleDelete() {
    if (!window.confirm('למחוק את הגלריה הזו? כל התמונות והבחירות יימחקו לצמיתות - אי אפשר לבטל את זה.')) return;

    setDeleting(true);
    const res = await fetch(`/api/galleries/${galleryId}`, { method: 'DELETE' });
    setDeleting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'מחיקת הגלריה נכשלה');
      return;
    }

    router.push('/dashboard/galleries');
    router.refresh();
  }

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  if (notFound) {
    return (
      <div>
        <p style={{ color: theme.errorText, marginBottom: '1rem' }}>הגלריה לא נמצאה.</p>
        <Link href="/dashboard/galleries" style={{ color: theme.textMuted }}>
          חזרה לרשימת הגלריות
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h1 style={{ fontSize: 20, marginBottom: '1.5rem' }}>עריכת גלריה</h1>

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
          מחיר החבילה (₪)
          <input
            type="number"
            min={0}
            step="0.01"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            style={inputStyle}
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

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <button type="submit" disabled={saving} style={{ ...goldButtonStyle, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'שומרת...' : 'שמירת שינויים'}
          </button>
          <button
            type="button"
            onClick={handleResendInvite}
            disabled={resending}
            style={{ ...outlineButtonStyle, opacity: resending ? 0.6 : 1 }}
          >
            {resending ? 'שולחת...' : 'שליחת הזמנה מחדש'}
          </button>
          <Link href="/dashboard/galleries" style={{ ...outlineButtonStyle, textDecoration: 'none' }}>
            ביטול
          </Link>
        </div>
      </form>

      {resendMessage && (
        <p style={{ background: theme.successBg, color: theme.successText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
          {resendMessage}
        </p>
      )}

      {error && (
        <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
          {error}
        </p>
      )}

      <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` }}>
        <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.5rem' }}>תמונות שנבחרו</h2>
        <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '1rem' }}>
          מיון אוטומטי מול תיקייה מקומית (Chrome/Edge), או הורדת כל התמונות שנבחרו כקובץ ZIP אחד.
        </p>
        <MagicButton galleryId={galleryId} />
        <a
          href={`/api/galleries/${galleryId}/selections-export`}
          style={{ display: 'inline-block', marginTop: '0.75rem', color: theme.textMuted, fontSize: 13, textDecoration: 'underline' }}
        >
          הורדת רשימת הבחירה כקובץ CSV
        </a>
      </div>

      <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` }}>
        <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '0.75rem' }}>
          מחיקת גלריה מוחקת לצמיתות את כל התמונות, הבחירות, ופרטי הלקוחה - אי אפשר לשחזר.
        </p>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            background: 'transparent',
            border: `1px solid ${theme.errorText}`,
            color: theme.errorText,
            borderRadius: 4,
            padding: '0.6rem 1.1rem',
            cursor: 'pointer',
            opacity: deleting ? 0.6 : 1,
          }}
        >
          {deleting ? 'מוחקת...' : 'מחיקת גלריה'}
        </button>
      </div>
    </div>
  );
}
