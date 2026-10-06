'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { theme, goldButtonStyle, inputStyle, outlineButtonStyle } from '@/lib/theme';
import { clampWelcomeStep, ONBOARDING_LOCAL_KEY, parseBusinessName, WELCOME_STEP_COUNT } from '@/lib/onboarding';

// אשף פתיחה לצלמת חדשה - מוצג פעם אחת (ההפניה: app/dashboard/useOnboardingRedirect.ts,
// ההחלטה: lib/onboarding.ts). 3 שלבים, כל אחד אפשר לדלג:
//   1. שם העסק + לוגו (POST /api/photographer/onboarding, ואותה העלאת לוגו כמו בהגדרות)
//   2. חבילת ברירת מחדל (PATCH /api/photographer - אותם שדות כמו בהגדרות)
//   3. גלריה ראשונה / גלריית דוגמה (POST /api/galleries/sample) / דלגי
// "סיום" נשמר ב-photographers.onboarding_done_at, ואם העמודה חסרה - ב-localStorage.

const LOGO_BUCKET = 'photographer-logos';
const STEP_TITLES = ['העסק שלך', 'חבילת ברירת מחדל', 'מתחילות'];

const card: CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 14,
  padding: '1.5rem 1.25rem',
  width: '100%',
  maxWidth: 520,
  margin: '0 auto',
  boxSizing: 'border-box',
};
const label: CSSProperties = { display: 'block', fontSize: 13, color: theme.textMuted, marginBottom: '0.35rem' };
const fullInput: CSSProperties = { ...inputStyle, width: '100%', boxSizing: 'border-box' };
const skipButton: CSSProperties = { background: 'none', border: 'none', color: theme.textFaint, cursor: 'pointer', fontSize: 14, padding: '0.5rem' };

interface SampleResult {
  galleryId: string;
  accessCode: string;
  photoCount: number;
}

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [initialBusinessName, setInitialBusinessName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [includedPhotos, setIncludedPhotos] = useState('30');
  const [basePrice, setBasePrice] = useState('');
  const [extraPrice, setExtraPrice] = useState('');

  const [sample, setSample] = useState<SampleResult | null>(null);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  useEffect(() => {
    fetch('/api/photographer')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setPhotographerId(data.id ?? null);
          setBusinessName(data.business_name ?? '');
          setInitialBusinessName(data.business_name ?? '');
          setLogoUrl(data.logo_url ?? null);
          if (data.default_included_photos != null) setIncludedPhotos(String(data.default_included_photos));
          if (Number(data.default_base_price) > 0) setBasePrice(String(Number(data.default_base_price)));
          if (Number(data.default_extra_photo_price) > 0) setExtraPrice(String(Number(data.default_extra_photo_price)));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function go(next: number) {
    setError('');
    setStep(clampWelcomeStep(next));
    window.scrollTo?.({ top: 0 });
  }

  // מסמנת שהאשף הסתיים. כישלון / עמודה חסרה -> דגל מקומי, כך שלא נחזור לכאן.
  async function markDone() {
    let savedInDb = false;
    try {
      const res = await fetch('/api/photographer/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: true }),
      });
      const data = res.ok ? await res.json().catch(() => null) : null;
      savedInDb = !!data && data.onboardingSaved !== false;
    } catch {
      savedInDb = false;
    }
    if (!savedInDb) {
      try {
        window.localStorage.setItem(ONBOARDING_LOCAL_KEY, '1');
      } catch {
        // בכוונה שקט
      }
    }
  }

  async function finishTo(href: string) {
    setSaving(true);
    await markDone();
    router.replace(href);
  }

  // ----- שלב 1 -----
  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !photographerId) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('יש להעלות קובץ PNG, JPEG או WebP');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('התמונה גדולה מדי (מקסימום 2MB)');
      return;
    }
    setError('');
    setUploadingLogo(true);
    const supabase = createClient();
    // אותו נתיב קבוע כמו בהגדרות (upsert) - בלי קבצי לוגו יתומים
    const path = `${photographerId}/logo`;
    const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { upsert: true });
    if (uploadError) {
      setUploadingLogo(false);
      setError('העלאת הלוגו נכשלה, נסי שוב');
      return;
    }
    const { data: publicUrlData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    const publicUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
    const res = await fetch('/api/photographer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logoUrl: publicUrl }),
    });
    setUploadingLogo(false);
    if (!res.ok) {
      setError('שמירת הלוגו נכשלה, נסי שוב');
      return;
    }
    setLogoUrl(publicUrl);
  }

  async function saveBusiness() {
    const parsed = parseBusinessName(businessName);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.value !== initialBusinessName) {
      setSaving(true);
      const res = await fetch('/api/photographer/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName: parsed.value }),
      }).catch(() => null);
      setSaving(false);
      if (!res?.ok) {
        const data = await res?.json().catch(() => null);
        setError(data?.error || 'שמירת שם העסק נכשלה, נסי שוב');
        return;
      }
      setInitialBusinessName(parsed.value);
    }
    go(1);
  }

  // ----- שלב 2 -----
  async function savePackage() {
    const included = Number(includedPhotos);
    const base = basePrice.trim() === '' ? 0 : Number(basePrice);
    const extra = extraPrice.trim() === '' ? 0 : Number(extraPrice);
    if (!Number.isInteger(included) || included < 0) {
      setError('מספר התמונות בחבילה צריך להיות מספר שלם');
      return;
    }
    if (!Number.isFinite(base) || base < 0 || !Number.isFinite(extra) || extra < 0) {
      setError('המחירים צריכים להיות מספרים אי-שליליים');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/photographer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultIncludedPhotos: included, defaultBasePrice: base, defaultExtraPhotoPrice: extra }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      setError(data?.error || 'שמירת החבילה נכשלה, נסי שוב');
      return;
    }
    go(2);
  }

  // ----- שלב 3 -----
  async function createSample() {
    setSaving(true);
    setError('');
    const res = await fetch('/api/galleries/sample', { method: 'POST' }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok || !data?.galleryId) {
      setSaving(false);
      setError(data?.error || 'יצירת גלריית הדוגמה נכשלה, נסי שוב');
      return;
    }
    await markDone();
    setSaving(false);
    setSample(data as SampleResult);
  }

  const galleryUrl = sample && typeof window !== 'undefined' ? `${window.location.origin}/gallery/${sample.galleryId}` : '';

  async function copy(text: string, which: 'link' | 'code') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // בכוונה שקט - הטקסט מוצג על המסך וניתן להעתקה ידנית
    }
  }

  const dots = (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.25rem' }} aria-label={`שלב ${step + 1} מתוך ${WELCOME_STEP_COUNT}`}>
      {Array.from({ length: WELCOME_STEP_COUNT }, (_, i) => (
        <span
          key={i}
          style={{
            width: i === step ? 22 : 8,
            height: 8,
            borderRadius: 999,
            background: i <= step ? theme.gold : theme.borderLight,
            transition: 'width 0.2s',
          }}
        />
      ))}
    </div>
  );

  if (loading) {
    return <p style={{ color: theme.textMuted, textAlign: 'center' }}>טוען...</p>;
  }

  return (
    <div style={{ padding: '0.5rem 0 2rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ fontFamily: theme.fontSerif, fontSize: 26, margin: 0 }}>ברוכה הבאה ✨</h1>
        <p style={{ color: theme.textMuted, fontSize: 14, margin: '0.4rem 0 0' }}>שלוש דקות של הגדרות, ואת מוכנה לגלריה הראשונה</p>
      </div>

      {dots}

      <div style={card}>
        <h2 style={{ fontSize: 18, margin: '0 0 1rem' }}>
          {step + 1}. {STEP_TITLES[step]}
        </h2>

        {error && (
          <p role="alert" style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 0.85rem', borderRadius: 8, fontSize: 14, margin: '0 0 1rem' }}>
            {error}
          </p>
        )}

        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label htmlFor="welcome-business" style={label}>
                שם העסק (מופיע ללקוחות בגלריה ובמיילים)
              </label>
              <input
                id="welcome-business"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="למשל: סטודיו דינה"
                maxLength={80}
                style={fullInput}
              />
            </div>
            <div>
              <span style={label}>לוגו (גם סימן המים על התמונות)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 10,
                    border: `1px solid ${theme.border}`,
                    background: theme.panelInput,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ color: theme.textFaint, fontSize: 22 }}>{(businessName || '?').trim().charAt(0)}</span>
                  )}
                </div>
                <label style={{ ...outlineButtonStyle, display: 'inline-block', opacity: uploadingLogo || !photographerId ? 0.6 : 1 }}>
                  {uploadingLogo ? 'מעלה...' : logoUrl ? 'החלפת לוגו' : 'העלאת לוגו'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoChange}
                    disabled={uploadingLogo || !photographerId}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ color: theme.textMuted, fontSize: 14, margin: 0 }}>ממלא אוטומטית כל גלריה חדשה - תמיד אפשר לשנות לגלריה מסוימת.</p>
            <div>
              <label htmlFor="welcome-included" style={label}>
                כמה תמונות כלולות בחבילה
              </label>
              <input
                id="welcome-included"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={includedPhotos}
                onChange={(e) => setIncludedPhotos(e.target.value)}
                style={fullInput}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 180px' }}>
                <label htmlFor="welcome-base" style={label}>
                  מחיר החבילה (₪)
                </label>
                <input
                  id="welcome-base"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  placeholder="0"
                  style={fullInput}
                />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label htmlFor="welcome-extra" style={label}>
                  מחיר לתמונה נוספת (₪)
                </label>
                <input
                  id="welcome-extra"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={extraPrice}
                  onChange={(e) => setExtraPrice(e.target.value)}
                  placeholder="0"
                  style={fullInput}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && !sample && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ color: theme.textMuted, fontSize: 14, margin: 0 }}>
              אפשר ליצור גלריה ללקוחה אמיתית, או קודם להציץ בגלריית דוגמה - כדי לראות בדיוק מה הלקוחות שלך יראו.
            </p>
            <button onClick={() => finishTo('/dashboard/galleries/new')} disabled={saving} style={{ ...goldButtonStyle, width: '100%', padding: '0.85rem' }}>
              צרי גלריה ראשונה
            </button>
            <button onClick={createSample} disabled={saving} style={{ ...outlineButtonStyle, width: '100%', padding: '0.85rem', color: theme.text }}>
              {saving ? 'יוצרת גלריית דוגמה...' : '✨ גלריית דוגמה'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => go(1)} disabled={saving} style={skipButton}>
                → חזרה
              </button>
              <button onClick={() => finishTo('/dashboard/today')} disabled={saving} style={skipButton}>
                דלגי
              </button>
            </div>
          </div>
        )}

        {step === 2 && sample && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <p style={{ background: theme.successBg, color: theme.successText, padding: '0.6rem 0.85rem', borderRadius: 8, fontSize: 14, margin: 0 }}>
              גלריית הדוגמה מוכנה ({sample.photoCount} תמונות). פתחי אותה כמו לקוחה והזיני את קוד הגישה.
            </p>
            <div>
              <span style={label}>קישור</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <code dir="ltr" style={{ ...fullInput, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                  {galleryUrl}
                </code>
                <button onClick={() => copy(galleryUrl, 'link')} style={{ ...outlineButtonStyle, whiteSpace: 'nowrap' }}>
                  {copied === 'link' ? 'הועתק ✓' : 'העתקה'}
                </button>
              </div>
            </div>
            <div>
              <span style={label}>קוד גישה</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <code dir="ltr" style={{ ...fullInput, flex: 1, letterSpacing: 2, fontWeight: 'bold' }}>
                  {sample.accessCode}
                </code>
                <button onClick={() => copy(sample.accessCode, 'code')} style={{ ...outlineButtonStyle, whiteSpace: 'nowrap' }}>
                  {copied === 'code' ? 'הועתק ✓' : 'העתקה'}
                </button>
              </div>
            </div>
            <a
              href={`/gallery/${sample.galleryId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...goldButtonStyle, display: 'block', textAlign: 'center', textDecoration: 'none', padding: '0.85rem' }}
            >
              פתחי כלקוחה ↗
            </a>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Link href="/dashboard/galleries/new" style={{ color: theme.gold, fontSize: 14 }}>
                צרי גלריה אמיתית
              </Link>
              <Link href="/dashboard/galleries" style={{ color: theme.textMuted, fontSize: 14 }}>
                לגלריות שלי
              </Link>
            </div>
          </div>
        )}

        {step < 2 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {step > 0 && (
                <button onClick={() => go(step - 1)} disabled={saving} style={outlineButtonStyle}>
                  חזרה
                </button>
              )}
              <button onClick={() => go(step + 1)} disabled={saving} style={skipButton}>
                דלגי
              </button>
            </div>
            <button onClick={step === 0 ? saveBusiness : savePackage} disabled={saving || uploadingLogo} style={goldButtonStyle}>
              {saving ? 'שומרת...' : 'המשך'}
            </button>
          </div>
        )}
      </div>

      {!sample && (
        <p style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button onClick={() => finishTo('/dashboard/today')} disabled={saving} style={skipButton}>
            דלגי על הכול - אסדר אחר כך בהגדרות
          </button>
        </p>
      )}
    </div>
  );
}
