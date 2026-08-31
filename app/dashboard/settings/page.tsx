'use client';

import { useEffect, useState } from 'react';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { createClient } from '@/lib/supabase/client';

const DEFAULT_BRAND_COLOR = '#c98f89'; // theme.gold - הגוון הקבוע, מוצג כברירת מחדל בבורר הצבע
const LOGO_BUCKET = 'photographer-logos';

export default function SettingsPage() {
  const [supabase] = useState(() => createClient());
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [watermarkText, setWatermarkText] = useState('');
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [defaultIncludedPhotos, setDefaultIncludedPhotos] = useState('30');
  const [defaultBasePrice, setDefaultBasePrice] = useState('0');
  const [defaultExtraPhotoPrice, setDefaultExtraPhotoPrice] = useState('0');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/photographer');
      if (res.ok) {
        const data = await res.json();
        setPhotographerId(data.id ?? null);
        setBusinessName(data.business_name ?? '');
        setWatermarkText(data.watermark_text ?? '');
        setLogoUrl(data.logo_url ?? null);
        setDefaultIncludedPhotos(String(data.default_included_photos ?? 30));
        setDefaultBasePrice(String(data.default_base_price ?? 0));
        setDefaultExtraPhotoPrice(String(data.default_extra_photo_price ?? 0));
        // '#000000' הוא ברירת המחדל של העמודה (=טרם הוגדר) - מציגים את גוון
        // הפלטה המקורי בבורר הצבע במקום שחור, כך שמה שרואים תואם למה שהלקוחה רואה כרגע
        setBrandColor(data.brand_color && data.brand_color !== '#000000' ? data.brand_color : DEFAULT_BRAND_COLOR);
      }
      setLoading(false);
    })();
  }, []);

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // מאפשר לבחור שוב את אותו קובץ אם רוצים להעלות מחדש
    if (!file || !photographerId) return;

    if (!file.type.startsWith('image/')) {
      setLogoError('יש להעלות קובץ תמונה');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('התמונה גדולה מדי (מקסימום 2MB)');
      return;
    }

    setLogoError('');
    setUploadingLogo(true);

    // upsert על נתיב קבוע (לא כולל סיומת) - כל העלאה חדשה דורסת את הקודמת,
    // כדי שלא ייצברו קבצי לוגו ישנים יתומים ב-bucket בכל פעם שצלמת מחליפה תמונה.
    const path = `${photographerId}/logo`;
    const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { upsert: true });

    if (uploadError) {
      setUploadingLogo(false);
      setLogoError('העלאת הלוגו נכשלה, נסי שוב');
      return;
    }

    const { data: publicUrlData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    // מוסיפים חותמת זמן כדי לעקוף cache של הדפדפן/CDN על אותו נתיב אחרי דריסה
    const publicUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

    const res = await fetch('/api/photographer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watermarkText, brandColor, logoUrl: publicUrl }),
    });

    setUploadingLogo(false);

    if (!res.ok) {
      setLogoError('שמירת הלוגו נכשלה, נסי שוב');
      return;
    }

    setLogoUrl(publicUrl);
  }

  async function handleRemoveLogo() {
    setLogoError('');
    setUploadingLogo(true);

    const res = await fetch('/api/photographer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watermarkText, brandColor, logoUrl: null }),
    });

    setUploadingLogo(false);

    if (!res.ok) {
      setLogoError('הסרת הלוגו נכשלה, נסי שוב');
      return;
    }

    setLogoUrl(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);

    const res = await fetch('/api/photographer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        watermarkText,
        brandColor,
        defaultIncludedPhotos: Number(defaultIncludedPhotos),
        defaultBasePrice: Number(defaultBasePrice),
        defaultExtraPhotoPrice: Number(defaultExtraPhotoPrice),
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'עדכון ההגדרות נכשל');
      return;
    }

    setSaved(true);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSaved(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('הסיסמאות לא תואמות');
      return;
    }

    setChangingPassword(true);
    // בניגוד ל-app/login/reset-password/page.tsx (שם ה-session הוא "recovery"
    // מקישור במייל), כאן כבר יש session רגיל של צלמת מחוברת - אותה קריאה
    // בדיוק (updateUser) עובדת גם עליו, בלי צורך בסיסמה הישנה.
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);

    if (updateError) {
      setPasswordError('עדכון הסיסמה נכשל, נסי שוב');
      return;
    }

    setNewPassword('');
    setConfirmPassword('');
    setPasswordSaved(true);
  }

  if (loading) return <p style={{ color: theme.textMuted }}>טוען...</p>;

  return (
    <div style={{ maxWidth: 420 }}>
      <h1 style={{ fontFamily: theme.fontSerif, fontSize: 20, marginBottom: '1.5rem' }}>הגדרות</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <span>לוגו</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
              background: theme.panelInput, border: `1px solid ${theme.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <span style={{ color: theme.textFaint, fontSize: 22 }}>{(businessName || '?').trim().charAt(0)}</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ ...outlineButtonStyle, padding: '0.4rem 0.9rem', fontSize: 13, cursor: 'pointer', opacity: uploadingLogo ? 0.6 : 1 }}>
              {uploadingLogo ? 'מעלה...' : logoUrl ? 'החלפת לוגו' : 'העלאת לוגו'}
              <input type="file" accept="image/*" onChange={handleLogoChange} disabled={uploadingLogo} style={{ display: 'none' }} />
            </label>
            {logoUrl && (
              <button type="button" onClick={handleRemoveLogo} disabled={uploadingLogo} style={{ background: 'none', border: 'none', color: theme.textFaint, fontSize: 12, cursor: 'pointer', textAlign: 'right', padding: 0 }}>
                הסרת לוגו
              </button>
            )}
          </div>
        </div>
        <span style={{ color: theme.textFaint, fontSize: 12 }}>
          מוצג ללקוחה במסך הפתיחה של הגלריה שלה. עד 2MB, מומלץ תמונה מרובעת עם רקע שקוף.
        </span>
        {logoError && (
          <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 13 }}>
            {logoError}
          </p>
        )}
      </div>

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

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          צבע מותג
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <input
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              style={{ width: 44, height: 36, padding: 2, background: theme.panelInput, border: `1px solid ${theme.border}`, borderRadius: 4, cursor: 'pointer' }}
            />
            <span style={{ color: theme.textFaint, fontSize: 12 }}>{brandColor}</span>
          </div>
          <span style={{ color: theme.textFaint, fontSize: 12 }}>
            צבע ההדגשה (לב הבחירה, פס ההתקדמות, הכפתורים) שהלקוחה רואה בדף הגלריה שלה.
          </span>
        </label>

        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '1rem', marginTop: '0.25rem' }}>
          <p style={{ fontSize: 14, marginBottom: '0.75rem' }}>חבילת ברירת מחדל לגלריה חדשה</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              תמונות כלולות בחבילה
              <input
                type="number"
                min={0}
                value={defaultIncludedPhotos}
                onChange={(e) => setDefaultIncludedPhotos(e.target.value)}
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              מחיר החבילה (₪)
              <input
                type="number"
                min={0}
                step="0.01"
                value={defaultBasePrice}
                onChange={(e) => setDefaultBasePrice(e.target.value)}
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              מחיר לתמונה נוספת (₪)
              <input
                type="number"
                min={0}
                step="0.01"
                value={defaultExtraPhotoPrice}
                onChange={(e) => setDefaultExtraPhotoPrice(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <span style={{ color: theme.textFaint, fontSize: 12, display: 'block', marginTop: '0.5rem' }}>
            הערכים האלה ימלאו אוטומטית את טופס "גלריה חדשה" - אפשר תמיד לשנות אותם לגלריה ספציפית.
          </span>
        </div>

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

      <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` }}>
        <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '1rem' }}>שינוי סיסמה</h2>

        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            סיסמה חדשה
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
              minLength={6}
              required
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            אימות סיסמה חדשה
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
              minLength={6}
              required
            />
          </label>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button type="submit" disabled={changingPassword} style={{ ...outlineButtonStyle, opacity: changingPassword ? 0.6 : 1 }}>
              {changingPassword ? 'מעדכנת...' : 'עדכון סיסמה'}
            </button>
            {passwordSaved && <span style={{ color: theme.successText, fontSize: 13 }}>הסיסמה עודכנה!</span>}
          </div>
        </form>

        {passwordError && (
          <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.75rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
            {passwordError}
          </p>
        )}
      </div>
    </div>
  );
}
