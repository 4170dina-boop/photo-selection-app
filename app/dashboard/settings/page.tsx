'use client';

import { useEffect, useState } from 'react';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import PriceInput from '@/components/PriceInput';
import { createClient } from '@/lib/supabase/client';
import { classifySignInError, isRateLimitError, RATE_LIMIT_MESSAGE } from '@/lib/authErrors';

const DEFAULT_BRAND_COLOR = '#c98f89'; // theme.gold - הגוון הקבוע, מוצג כברירת מחדל בבורר הצבע
const LOGO_BUCKET = 'photographer-logos';

interface CustomTheme {
  bg: string;
  panel: string;
  text: string;
  accent: string;
}

// מגבלת הגלריות הפעילות בחשבון חינמי - כמו freeGalleryLimit ב-app/dashboard/galleries/page.tsx
const FREE_GALLERY_LIMIT = 1;

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
  const [reminderDaysDefault, setReminderDaysDefault] = useState('5');
  const [reviewLink, setReviewLink] = useState('');
  const [shootReminderDays, setShootReminderDays] = useState('1');
  const [shootDailySummaryEnabled, setShootDailySummaryEnabled] = useState(true);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [customTheme, setCustomTheme] = useState<CustomTheme | null>(null);
  const [themeDescription, setThemeDescription] = useState('');
  const [previewTheme, setPreviewTheme] = useState<CustomTheme | null>(null);
  const [designingTheme, setDesigningTheme] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeError, setThemeError] = useState('');
  const [themeSaved, setThemeSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  // "חשבון וגלריות": מונה הגלריות הפעילות (מול מגבלת החשבון החינמי) וייצוא
  // אנשי הקשר - עברו לכאן מראש "הגלריות שלי". null = עוד לא נטען/נכשל.
  const [galleryCounts, setGalleryCounts] = useState<{ active: number; total: number; isUnlimited: boolean } | null>(null);

  // תואם ל-enforce_active_gallery_limit ב-supabase/schema.sql (ולחישוב ב-
  // app/dashboard/galleries/page.tsx): פעילה = כל סטטוס חוץ מ-completed/expired.
  // best-effort - כישלון פשוט מסתיר את השורה.
  useEffect(() => {
    Promise.all([
      supabase.from('galleries').select('status'),
      supabase.from('photographers').select('is_unlimited').maybeSingle(),
    ]).then(([galleriesRes, photographerRes]) => {
      if (galleriesRes.error || !galleriesRes.data) return;
      const statuses = galleriesRes.data as { status: string }[];
      setGalleryCounts({
        active: statuses.filter((g) => g.status !== 'completed' && g.status !== 'expired').length,
        total: statuses.length,
        isUnlimited: !!(photographerRes.data as { is_unlimited?: boolean } | null)?.is_unlimited,
      });
    }, () => {});
  }, [supabase]);

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
        setReminderDaysDefault(String(data.reminder_days_default ?? 5));
        setReviewLink(data.review_link ?? '');
        setShootReminderDays(String(data.shoot_reminder_days ?? 1));
        setShootDailySummaryEnabled(data.shoot_daily_summary_enabled ?? true);
        // '#000000' הוא ברירת המחדל של העמודה (=טרם הוגדר) - מציגים את גוון
        // הפלטה המקורי בבורר הצבע במקום שחור, כך שמה שרואים תואם למה שהלקוחה רואה כרגע
        setBrandColor(data.brand_color && data.brand_color !== '#000000' ? data.brand_color : DEFAULT_BRAND_COLOR);
        setCustomTheme(data.custom_theme ?? null);
      }
      setLoading(false);
    })();
  }, []);

  async function handleDesignTheme(e: React.FormEvent) {
    e.preventDefault();
    setThemeError('');
    setThemeSaved(false);
    setDesigningTheme(true);

    const res = await fetch('/api/photographer/design-theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: themeDescription }),
    });
    const data = await res.json().catch(() => ({}));
    setDesigningTheme(false);

    if (!res.ok) {
      setThemeError(data.error ?? 'עיצוב הגלריה נכשל, נסי שוב');
      return;
    }

    setPreviewTheme(data.theme);
  }

  async function handleSaveTheme() {
    if (!previewTheme) return;
    setThemeError('');
    setSavingTheme(true);

    const res = await fetch('/api/photographer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customTheme: previewTheme }),
    });

    setSavingTheme(false);

    if (!res.ok) {
      setThemeError('שמירת העיצוב נכשלה, נסי שוב');
      return;
    }

    setCustomTheme(previewTheme);
    setPreviewTheme(null);
    setThemeSaved(true);
  }

  async function handleResetTheme() {
    setThemeError('');
    setSavingTheme(true);

    const res = await fetch('/api/photographer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customTheme: null }),
    });

    setSavingTheme(false);

    if (!res.ok) {
      setThemeError('איפוס העיצוב נכשל, נסי שוב');
      return;
    }

    setCustomTheme(null);
    setPreviewTheme(null);
  }

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
        reminderDaysDefault: Number(reminderDaysDefault),
        reviewLink: reviewLink.trim() || null,
        shootReminderDays: Number(shootReminderDays),
        shootDailySummaryEnabled,
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
    // Supabase מאפשר updateUser על כל session מאומת, בלי הסיסמה הישנה - כך
    // שמי שתפס מחשב פתוח/session גנוב היה יכול להשתלט על החשבון. לכן כאן
    // (בניגוד ל-app/login/reset-password, שם ה-session הוא "recovery" מקישור
    // במייל) קודם מאמתים את הסיסמה הנוכחית מול Supabase.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      setChangingPassword(false);
      setPasswordError('לא הצלחנו לזהות את החשבון, נסי להתחבר מחדש');
      return;
    }

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      setChangingPassword(false);
      const kind = classifySignInError(verifyError);
      if (kind === 'rate_limited') {
        setPasswordError(RATE_LIMIT_MESSAGE);
      } else if (kind === 'invalid_credentials') {
        setPasswordError('הסיסמה הנוכחית שגויה');
      } else {
        console.error('current password verification failed', verifyError);
        setPasswordError('אימות הסיסמה הנוכחית נכשל, נסי שוב');
      }
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);

    if (updateError) {
      console.error('updateUser(password) failed', updateError);
      setPasswordError(
        isRateLimitError(updateError)
          ? RATE_LIMIT_MESSAGE
          : updateError.code === 'same_password'
            ? 'הסיסמה החדשה זהה לנוכחית'
            : 'עדכון הסיסמה נכשל, נסי שוב'
      );
      return;
    }

    setCurrentPassword('');
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
              <PriceInput
                value={defaultBasePrice}
                onChange={(e) => setDefaultBasePrice(e.target.value)}
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              מחיר לתמונה נוספת (₪)
              <PriceInput
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

        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '1rem', marginTop: '0.25rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            ימים לפני תפוגה לשליחת תזכורת
            <input
              type="number"
              min={1}
              value={reminderDaysDefault}
              onChange={(e) => setReminderDaysDefault(e.target.value)}
              style={{ ...inputStyle, maxWidth: 120 }}
            />
          </label>
          <span style={{ color: theme.textFaint, fontSize: 12, display: 'block', marginTop: '0.5rem' }}>
            כמה ימים לפני שהגלריה פגה נשלחת ללקוחה תזכורת אוטומטית (חד-פעמית) - בנוסף
            אפשר תמיד לשלוח תזכורת נוספת ידנית מדף עריכת הגלריה.
          </span>
        </div>

        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '1rem', marginTop: '0.25rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            קישור לביקורת (גוגל עסקי / פייסבוק וכו')
            <input
              type="url"
              dir="ltr"
              value={reviewLink}
              onChange={(e) => setReviewLink(e.target.value)}
              placeholder="https://g.page/r/..."
              style={inputStyle}
            />
          </label>
          <span style={{ color: theme.textFaint, fontSize: 12, display: 'block', marginTop: '0.5rem' }}>
            אם מוגדר, יופיע כפתור "בקשת ביקורת" בעריכת גלריה אחרי שסימנת אותה כנמסרה.
          </span>
        </div>

        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '1rem', marginTop: '0.25rem' }}>
          <span style={{ fontWeight: 700, display: 'block', marginBottom: '0.75rem' }}>יומן צילומים</span>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            ימים לפני צילום לשליחת תזכורת ללקוחה
            <input
              type="number"
              min={0}
              max={30}
              value={shootReminderDays}
              onChange={(e) => setShootReminderDays(e.target.value)}
              style={{ ...inputStyle, maxWidth: 120 }}
            />
          </label>
          <span style={{ color: theme.textFaint, fontSize: 12, display: 'block', marginTop: '0.5rem' }}>
            תזכורת אוטומטית (חד-פעמית) נשלחת ללקוחה כמה ימים לפני הצילום. 0 = בלי תזכורת אוטומטית.
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={shootDailySummaryEnabled}
              onChange={(e) => setShootDailySummaryEnabled(e.target.checked)}
            />
            לשלוח לי כל יום מייל עם הצילומים של מחר
          </label>
          <span style={{ color: theme.textFaint, fontSize: 12, display: 'block', marginTop: '0.5rem' }}>
            המייל נשלח רק בימים שבהם יש לך צילומים למחרת.
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
        <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.5rem' }}>עיצוב הגלריה עם AI</h2>
        <p style={{ color: theme.textMuted, fontSize: 13, marginBottom: '1rem' }}>
          תארי במילים שלך איך תרצי שגלריית הלקוחה שלך תיראה - הצבעים בלבד (רקע, כרטיסים, טקסט, הדגשה) משתנים,
          שאר ההגדרות (מחירים, לוגו, תזכורות וכו') נשארות אותו דבר.
          {customTheme && ' יש לך כרגע עיצוב מותאם אישית שמורה.'}
        </p>

        <form onSubmit={handleDesignTheme} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <textarea
            value={themeDescription}
            onChange={(e) => setThemeDescription(e.target.value)}
            placeholder="למשל: רומנטי ופסטלי, בהיר וחמים · או: כהה ודרמטי כמו מגזין יוקרה"
            rows={2}
            maxLength={300}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div>
            <button type="submit" disabled={designingTheme || !themeDescription.trim()} style={{ ...outlineButtonStyle, opacity: designingTheme || !themeDescription.trim() ? 0.6 : 1 }}>
              {designingTheme ? 'מעצבת...' : '✨ עצבי לי'}
            </button>
          </div>
        </form>

        {themeError && (
          <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: 13, marginTop: '0.75rem' }}>
            {themeError}
          </p>
        )}

        {previewTheme && (
          <div
            style={{
              marginTop: '1rem', padding: '1.25rem', borderRadius: 10, border: `1px solid ${theme.border}`,
              background: previewTheme.bg, color: previewTheme.text,
            }}
          >
            <p style={{ fontSize: 12, marginBottom: '0.5rem', opacity: 0.7 }}>תצוגה מקדימה</p>
            <div style={{ padding: '0.85rem 1rem', borderRadius: 8, background: previewTheme.panel, marginBottom: '0.75rem' }}>
              כך ייראו כרטיסים וטקסט בגלריה שלך.
            </div>
            <button
              type="button"
              style={{ background: previewTheme.accent, color: '#fff', border: 'none', borderRadius: 4, padding: '0.5rem 1.1rem', fontWeight: 700, cursor: 'default' }}
            >
              כפתור לדוגמה
            </button>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="button" onClick={handleSaveTheme} disabled={savingTheme} style={{ ...goldButtonStyle, opacity: savingTheme ? 0.6 : 1, padding: '0.5rem 1rem' }}>
                {savingTheme ? 'שומרת...' : 'שמירת העיצוב הזה'}
              </button>
              <button type="button" onClick={() => setPreviewTheme(null)} style={{ ...outlineButtonStyle, padding: '0.5rem 1rem', borderColor: previewTheme.text, color: previewTheme.text }}>
                ביטול
              </button>
            </div>
          </div>
        )}

        {customTheme && !previewTheme && (
          <button type="button" onClick={handleResetTheme} disabled={savingTheme} style={{ background: 'none', border: 'none', color: theme.textFaint, fontSize: 12, cursor: 'pointer', textAlign: 'right', padding: 0, marginTop: '0.75rem' }}>
            איפוס לעיצוב המקורי
          </button>
        )}

        {themeSaved && <p style={{ color: theme.successText, fontSize: 13, marginTop: '0.5rem' }}>העיצוב נשמר!</p>}
      </div>

      {galleryCounts && (
        <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` }}>
          <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.5rem' }}>חשבון וגלריות</h2>
          <p
            style={{
              fontSize: 13, margin: '0 0 0.5rem',
              color: !galleryCounts.isUnlimited && galleryCounts.active >= FREE_GALLERY_LIMIT ? theme.errorText : theme.textMuted,
            }}
          >
            {galleryCounts.isUnlimited
              ? `${galleryCounts.active} גלריות פעילות (חשבון ללא הגבלה)`
              : `${galleryCounts.active}/${FREE_GALLERY_LIMIT} גלריות פעילות (חשבון חינמי)`}
          </p>
          {galleryCounts.total > 0 && (
            <a href="/api/galleries/export-contacts" style={{ color: theme.textMuted, fontSize: 13, textDecoration: 'underline' }}>
              ייצוא רשימת אנשי קשר (CSV)
            </a>
          )}
        </div>
      )}

      <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.border}` }}>
        <h2 style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '1rem' }}>שינוי סיסמה</h2>

        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            סיסמה נוכחית
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={inputStyle}
              autoComplete="current-password"
              required
            />
          </label>

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
