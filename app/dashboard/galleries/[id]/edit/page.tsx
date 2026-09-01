'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { toHebrewDateString } from '@/lib/hebrewDate';
import MagicButton from '@/components/MagicButton';

interface EditGalleryPageProps {
  params: { id: string };
}

export default function EditGalleryPage({ params }: EditGalleryPageProps) {
  const galleryId = params.id;
  const router = useRouter();

  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [includedPhotos, setIncludedPhotos] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [extraPhotoPrice, setExtraPhotoPrice] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [photographerNotes, setPhotographerNotes] = useState('');
  const [reminderDays, setReminderDays] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderMessage, setReminderMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [viewCount, setViewCount] = useState(0);
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null);

  useEffect(() => {
    loadGallery();
    // רק למותג בהודעה המוכנה להעתקה (handleCopyFormattedMessage) - לא
    // קריטי לשאר הדף, אז כישלון כאן פשוט משאיר כותרת גנרית ולא חוסם כלום.
    (async () => {
      const res = await fetch('/api/photographer');
      if (!res.ok) return;
      const data = await res.json();
      setBusinessName(data.business_name ?? '');
      setLogoUrl(data.logo_url ?? '');
    })();
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
    setAccessCode(data.clients?.access_code ?? '');
    setIncludedPhotos(String(data.packages?.included_photos ?? 0));
    setBasePrice(String(data.packages?.base_price ?? 0));
    setExtraPhotoPrice(String(data.packages?.extra_photo_price ?? 0));
    setExpiresAt(data.expires_at ? data.expires_at.slice(0, 10) : '');
    setPhotographerNotes(data.photographer_notes ?? '');
    setReminderDays(data.reminder_days != null ? String(data.reminder_days) : '');
    setViewCount(data.view_count ?? 0);
    setLastViewedAt(data.last_viewed_at ?? null);
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
        photographerNotes,
        reminderDays: reminderDays ? Number(reminderDays) : null,
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

    setResendMessage(
      data.emailSent
        ? 'ההזמנה נשלחה שוב בהצלחה'
        : 'שליחת המייל האוטומטי נכשלה - אפשר להעתיק הודעה מוכנה למטה ולשלוח בעצמך (וואטסאפ/מייל)'
    );
  }

  // גרסת HTML מעוצבת של אותה הודעה, באותו סגנון בדיוק כמו המיילים האוטומטיים
  // הממותגים (lib/email.ts: wrapEmailHtml/accessCodeBadge - כותרת כהה+זהב,
  // כרטיס לבן, כפתור זהב). לא ניתן לייבא את lib/email.ts כאן (הוא משתמש
  // ב-service_role client, לא מיועד לרוץ בדפדפן) אז זה כפול בכוונה - קטן
  // ומוגדר-עצמאי מספיק שזה לא מצדיק שיתוף קוד בין שרת ללקוח בשביל זה.
  function buildInviteEmailHtml(galleryUrl: string, expiryLine: string) {
    return `
      <div dir="rtl" style="font-family: sans-serif; background: #f4f1ec; padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e7e0d5;">
          <tr>
            <td style="background: #0f1626; padding: 20px 28px; text-align: center;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="${businessName || 'הגלריה שלך'}" width="44" height="44" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #e3b3ac; display: block; margin: 0 auto 8px;" />`
                  : ''
              }
              <span style="font-family: sans-serif; font-size: 18px; font-weight: 700; color: #e3b3ac;">${logoUrl ? '' : '✨ '}${businessName || 'הגלריה שלך'}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px; text-align: center; color: #2a2420; font-size: 15px; line-height: 1.7;">
              <p style="margin: 0 0 8px;">היי ${clientName || ''}! 📸</p>
              <p style="margin: 0 0 8px;">הגלריה שלך עם התמונות מוכנה לבחירה.${expiryLine}</p>
              <div style="margin: 18px 0; padding: 12px 20px; background: #f4f1ec; border: 1px dashed #c98f89; border-radius: 8px; display: inline-block;">
                <span style="font-size: 12px; color: #9a8f7d;">קוד גישה</span><br />
                <span style="font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #a06a63; font-family: monospace;">${accessCode}</span>
              </div>
              <p style="margin: 12px 0 0; font-size: 13px; color: #6b6156;">מחכה לראות מה תבחרי! ✨</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto 0;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #e3b3ac, #c98f89);">
                    <a href="${galleryUrl}" style="display: inline-block; padding: 14px 32px; font-family: sans-serif; font-size: 15px; font-weight: 700; color: #20120f; text-decoration: none;">
                      כניסה לגלריה
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;
  }

  // הודעה חמה ומוכנה לשליחה ידנית (וואטסאפ/מייל רגיל) - הפתרון המעשי כל עוד
  // אין דומיין מאומת ב-Resend ומיילים אוטומטיים לא מגיעים ללקוחות אמיתיות
  // (ראו README, "מיילים אוטומטיים"). מעתיקים גם טקסט רגיל וגם HTML מעוצב
  // באותה פעולה (navigator.clipboard.write עם שני ה-MIME types) - וואטסאפ
  // ואפליקציות טקסט פשוט משתמשות בגרסת הטקסט, וג'ימייל/אאוטלוק (עריכת טקסט
  // עשיר) מדביקים את גרסת ה-HTML המעוצבת אוטומטית. דפדפנים ישנים שלא תומכים
  // ב-ClipboardItem נופלים בחזרה לטקסט רגיל בלבד.
  async function handleCopyFormattedMessage() {
    const galleryUrl = `${window.location.origin}/gallery/${galleryId}`;
    const expiryLine = expiresAt ? `\nהגלריה פתוחה לבחירה עד ${toHebrewDateString(new Date(expiresAt))}.` : '';
    const message = `היי ${clientName || ''}! 📸\n\nהגלריה שלך עם התמונות מוכנה לבחירה.\n\nקישור: ${galleryUrl}\nקוד גישה: ${accessCode}${expiryLine}\n\nמחכה לראות מה תבחרי! ✨`;

    try {
      const html = buildInviteEmailHtml(galleryUrl, expiryLine ? `<br />הגלריה פתוחה לבחירה עד ${toHebrewDateString(new Date(expiresAt))}.` : '');
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([message], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(message);
    }

    setMessageCopied(true);
    setTimeout(() => setMessageCopied(false), 2000);
  }

  async function handleSendReminder() {
    setReminderMessage('');
    setError('');
    setSendingReminder(true);

    const res = await fetch(`/api/galleries/${galleryId}/send-reminder`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setSendingReminder(false);

    if (!res.ok) {
      setError(data.error ?? 'שליחת התזכורת נכשלה');
      return;
    }

    setReminderMessage(data.emailSent ? 'התזכורת נשלחה בהצלחה' : 'שליחת המייל נכשלה - ודאו ששירות המייל מוגדר');
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

      {accessCode && (
        <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: '0.25rem' }}>קוד גישה</div>
              <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 'bold', color: theme.gold, letterSpacing: 1 }}>{accessCode}</div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={async () => {
                  const galleryUrl = `${window.location.origin}/gallery/${galleryId}`;
                  await navigator.clipboard.writeText(`${galleryUrl}\nקוד גישה: ${accessCode}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{ ...outlineButtonStyle, padding: '0.5rem 1rem' }}
              >
                {copied ? 'הועתק!' : 'העתקת קישור וקוד'}
              </button>
              <button
                type="button"
                onClick={handleCopyFormattedMessage}
                title="הודעה מוכנה עם ברכה, קישור וקוד - להדביק בוואטסאפ כטקסט, או בג'ימייל/אאוטלוק בתור מייל מעוצב"
                style={{ ...outlineButtonStyle, padding: '0.5rem 1rem', borderColor: theme.gold, color: theme.gold }}
              >
                {messageCopied ? 'הועתק!' : '✎ העתקת הודעה מוכנה לשליחה'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: `1px solid ${theme.border}`, fontSize: 12, color: theme.textMuted }}>
            {viewCount > 0
              ? `👁 הלקוחה פתחה את הגלריה ${viewCount} פעמים${lastViewedAt ? ` - לאחרונה ב-${toHebrewDateString(new Date(lastViewedAt))}` : ''}`
              : '👁 הלקוחה עדיין לא פתחה את הגלריה'}
          </div>
        </div>
      )}

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
            step="1"
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
            step="1"
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

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          ימים לפני תפוגה לשליחת תזכורת (אופציונלי)
          <input
            type="number"
            min={1}
            value={reminderDays}
            onChange={(e) => setReminderDays(e.target.value)}
            placeholder="ברירת המחדל שלך מ-ההגדרות"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          הערות פרטיות (רק את רואה, לא הלקוחה)
          <textarea
            value={photographerNotes}
            onChange={(e) => setPhotographerNotes(e.target.value)}
            placeholder="למשל: צולם בגן החורשה, ביקשה הדגשה על התמונות בשחור-לבן"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
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
          {expiresAt && (
            <button
              type="button"
              onClick={handleSendReminder}
              disabled={sendingReminder}
              title="שולחת עכשיו את אותה תזכורת תפוגה שנשלחת אוטומטית, בלי לחכות לתזמון היומי"
              style={{ ...outlineButtonStyle, opacity: sendingReminder ? 0.6 : 1 }}
            >
              {sendingReminder ? 'שולחת...' : '🔔 שליחת תזכורת עכשיו'}
            </button>
          )}
          <Link
            href={`/dashboard/galleries/new?fromGallery=${galleryId}`}
            title="פתיחת גלריה חדשה עם אותה חבילה (תמונות כלולות ומחירים) - ללקוחה חדשה"
            style={{ ...outlineButtonStyle, textDecoration: 'none' }}
          >
            שכפול גלריה ללקוחה חדשה
          </Link>
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

      {reminderMessage && (
        <p style={{ background: theme.successBg, color: theme.successText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
          {reminderMessage}
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
          מיון אוטומטי מול תיקייה מקומית (Chrome/Edge) - מעתיק לשלוש תת-תיקיות ביעד: Selected (נבחרו),
          Maybe (אולי) ו-Extras (לא סומנו בכלל), או הורדת כל התמונות שנבחרו כקובץ ZIP אחד.
        </p>
        <MagicButton galleryId={galleryId} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem', marginTop: '0.75rem' }}>
          <a
            href={`/api/galleries/${galleryId}/selections-export`}
            style={{ color: theme.textMuted, fontSize: 13, textDecoration: 'underline' }}
          >
            הורדת רשימת הבחירה כקובץ CSV
          </a>
          <a
            href={`/api/galleries/${galleryId}/lightroom-export`}
            style={{ color: theme.textMuted, fontSize: 13, textDecoration: 'underline' }}
          >
            ייצוא ל-Lightroom/Capture One (CSV)
          </a>
        </div>
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
