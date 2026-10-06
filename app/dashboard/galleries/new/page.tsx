'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import PriceInput from '@/components/PriceInput';
import { israelEndOfDayIso } from '@/lib/israelTime';
import EmailInput from '@/components/EmailInput';
import ClientInviteMessageCopy from '@/components/ClientInviteMessageCopy';
import ClientGenderField from '@/components/ClientGenderField';
import GalleryLanguageField from '@/components/GalleryLanguageField';
import { normalizeLang, type Lang } from '@/lib/i18n/types';
import type { Gender } from '@/lib/gender';
import GalleryTemplatePicker from '@/components/GalleryTemplatePicker';
import { expiryDateFromDays, expiryDaysFromDate } from '@/lib/galleryTemplates';

interface CreatedGallery {
  galleryId: string;
  accessCode: string;
  emailSent: boolean;
}

export default function NewGalleryPage() {
  return (
    <Suspense fallback={null}>
      <NewGalleryForm />
    </Suspense>
  );
}

function NewGalleryForm() {
  const searchParams = useSearchParams();
  const fromGalleryId = searchParams.get('fromGallery');

  // ?name=&email= - מילוי מראש מדף הלקוחה (app/dashboard/clients/[key])
  const [clientName, setClientName] = useState(() => searchParams.get('name') ?? '');
  const [clientEmail, setClientEmail] = useState(() => searchParams.get('email') ?? '');
  const [includedPhotos, setIncludedPhotos] = useState('30');
  const [basePrice, setBasePrice] = useState('0');
  const [extraPhotoPrice, setExtraPhotoPrice] = useState('0');
  const [expiresAt, setExpiresAt] = useState('');
  const [duplicatedFrom, setDuplicatedFrom] = useState('');
  const [duplicateLoadError, setDuplicateLoadError] = useState('');
  // כתובות מייל נוספות (למשל בני משפחה) שמקבלות את אותו מייל הזמנה - ראו
  // additional_invite_emails ב-supabase/schema.sql. רשימה פשוטה של שדות טקסט,
  // לא טבלה - אין כאן עוד שום מושג זהות, רק עוד נמענים לאותו מייל.
  const [additionalEmails, setAdditionalEmails] = useState<string[]>([]);
  // לשון פנייה ללקוח/ה בגלריה ובמיילים (galleries.client_gender) - ברירת מחדל נקבה
  const [clientGender, setClientGender] = useState<Gender>('f');
  // שפת הגלריה והמיילים ללקוח/ה (galleries.language) - ברירת מחדל עברית
  const [language, setLanguage] = useState<Lang>('he');

  // ממלאים את השדות מברירות המחדל שהצלמת הגדירה בהגדרות (app/dashboard/settings/page.tsx),
  // כדי שלא תצטרך להקליד את אותם מספרים בכל גלריה - עדיין אפשר לשנות פה לפני היצירה.
  // אם הגענו משכפול גלריה (?fromGallery=) - החבילה של הגלריה המקורית גוברת על
  // ברירות המחדל, כי הכוונה המפורשת היא "אותה חבילה בדיוק", לא ברירת המחדל הכללית.
  useEffect(() => {
    (async () => {
      if (fromGalleryId) {
        try {
          const res = await fetch(`/api/galleries/${fromGalleryId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.packages?.included_photos != null) setIncludedPhotos(String(data.packages.included_photos));
            if (data.packages?.base_price != null) setBasePrice(String(data.packages.base_price));
            if (data.packages?.extra_photo_price != null) setExtraPhotoPrice(String(data.packages.extra_photo_price));
            setDuplicatedFrom(data.clients?.full_name ?? '');
            return;
          }
        } catch {
          // נופלים לברירות המחדל למטה
        }
        // שכפול נכשל - לא משאירים את הטופס עם ערכים קבועים בשקט: ממלאים
        // מברירות המחדל של הצלמת ומודיעים לה שהחבילה המקורית לא נטענה.
        setDuplicateLoadError('לא הצלחנו לטעון את החבילה של הגלריה המקורית - מולאו ברירות המחדל מההגדרות, בדקי את הערכים לפני היצירה.');
      }

      try {
        const res = await fetch('/api/photographer');
        if (!res.ok) return;
        const data = await res.json();
        if (data.default_included_photos != null) setIncludedPhotos(String(data.default_included_photos));
        if (data.default_base_price != null) setBasePrice(String(data.default_base_price));
        if (data.default_extra_photo_price != null) setExtraPhotoPrice(String(data.default_extra_photo_price));
      } catch {
        // ברירות מחדל הן רק נוחות - הטופס נשאר עם הערכים ההתחלתיים
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromGalleryId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedGallery | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/galleries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName,
          clientEmail,
          includedPhotos: Number(includedPhotos),
          basePrice: Number(basePrice),
          extraPhotoPrice: Number(extraPhotoPrice),
          expiresAt: expiresAt ? israelEndOfDayIso(expiresAt) : null,
          additionalInviteEmails: additionalEmails.map((email) => email.trim()).filter((email) => email.length > 0),
          clientGender,
          language,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'יצירת הגלריה נכשלה');
        return;
      }

      const data = await res.json();
      setCreated(data);
    } catch {
      setError('שגיאת רשת - בדקי את החיבור ונסי שוב');
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    const galleryUrl = `${window.location.origin}/gallery/${created.galleryId}`;

    return (
      <div style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 20, marginBottom: '1rem', color: theme.gold }}>✓ הגלריה נוצרה!</h1>

        {created.emailSent ? (
          <p style={{ background: theme.successBg, color: theme.successText, padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
            ✓ מייל עם הקישור והקוד נשלח אוטומטית ללקוחה
          </p>
        ) : (
          <p style={{ background: theme.warningBg, color: theme.warningText, padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '1rem' }}>
            המייל לא נשלח (שירות המייל לא מוגדר או נכשל) - אפשר להעתיק את ההודעה המעוצבת ולשלוח בעצמך (וואטסאפ/מייל):
          </p>
        )}

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
          {/* אותה הודעה מעוצבת כמו בדף עריכת הגלריה (טקסט לוואטסאפ + HTML לג'ימייל) */}
          <ClientInviteMessageCopy
            galleryId={created.galleryId}
            accessCode={created.accessCode}
            clientName={clientName}
            clientGender={clientGender}
            language={language}
            expiresAt={expiresAt || null}
            prominent
          />
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(`${galleryUrl}\nקוד גישה: ${created.accessCode}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            style={outlineButtonStyle}
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
      <h1 style={{ fontSize: 20, marginBottom: duplicatedFrom || duplicateLoadError ? '0.5rem' : '1.5rem' }}>גלריה חדשה</h1>

      {duplicateLoadError && (
        <p style={{ background: theme.warningBg, color: theme.warningText, padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '1.5rem', fontSize: 13 }}>
          {duplicateLoadError}
        </p>
      )}

      {duplicatedFrom && (
        <p style={{ background: theme.panel, border: `1px solid ${theme.border}`, color: theme.textMuted, padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '1.5rem', fontSize: 13 }}>
          החבילה מולאה אוטומטית מהגלריה של <b>{duplicatedFrom}</b> - אפשר לשנות לפני היצירה.
        </p>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* תבניות גלריה (lib/galleryTemplates.ts) - מוסתר אם הטבלה עוד לא קיימת */}
        <GalleryTemplatePicker
          current={() => ({
            includedPhotos: Number(includedPhotos) || 0,
            basePrice: Number(basePrice) || 0,
            extraPhotoPrice: Number(extraPhotoPrice) || 0,
            expiryDays: expiryDaysFromDate(expiresAt),
            clientGender,
            language,
          })}
          onApply={(data) => {
            setIncludedPhotos(String(data.includedPhotos));
            setBasePrice(String(data.basePrice));
            setExtraPhotoPrice(String(data.extraPhotoPrice));
            setExpiresAt(expiryDateFromDays(data.expiryDays));
            setClientGender(data.clientGender);
            setLanguage(data.language);
          }}
        />

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
          <EmailInput
            value={clientEmail}
            onValueChange={setClientEmail}
            style={inputStyle}
            required
          />
        </label>

        <ClientGenderField value={clientGender} onChange={setClientGender} />

        <GalleryLanguageField value={language} onChange={setLanguage} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {additionalEmails.map((email, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <EmailInput
                value={email}
                placeholder="כתובת מייל נוספת (למשל בן/בת משפחה)"
                onValueChange={(next) =>
                  setAdditionalEmails((prev) => prev.map((v, idx) => (idx === i ? next : v)))
                }
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => setAdditionalEmails((prev) => prev.filter((_, idx) => idx !== i))}
                title="הסרת כתובת זו"
                style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: 16 }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAdditionalEmails((prev) => [...prev, ''])}
            style={{ ...outlineButtonStyle, alignSelf: 'flex-start', padding: '0.4rem 0.8rem', fontSize: 13 }}
          >
            + הוספת כתובת מייל נוספת
          </button>
        </div>

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
          <PriceInput
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          מחיר לתמונה נוספת (₪)
          <PriceInput
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
