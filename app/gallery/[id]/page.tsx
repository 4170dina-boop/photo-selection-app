'use client';

import React, { useEffect, useRef, useState } from 'react';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';

interface GalleryPageProps {
  params: { id: string };
}

interface GalleryPhoto {
  id: string;
  thumbnailUrl: string | null;
  fullUrl: string | null;
  original_filename: string;
  possiblyBlurry: boolean;
}

interface Participant {
  id: string;
  displayName: string;
  isOwner: boolean;
}

interface Mark {
  participantId: string;
  displayName: string;
  status: string;
}

// בוחר טקסט כהה/בהיר לפי בהירות צבע המותג, כדי שכפתורים יישארו קריאים
// גם אם הצלמת בוחרת צבע מותג כהה (ולא רק את הגוון הבהיר של הפלטה המקורית).
function contrastTextColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return theme.goldText;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? theme.goldText : '#ffffff';
}

// ראשי תיבות קצרים לתג "מי בחר מה" - שם מלא לא נכנס בעיגול קטן
function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export default function GalleryPage({ params }: GalleryPageProps) {
  const galleryId = params.id;

  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [myMarks, setMyMarks] = useState<Record<string, { status: 'maybe' | 'selected'; note: string | null }>>({});
  const [allMarks, setAllMarks] = useState<Record<string, Mark[]>>({});
  const [packageInfo, setPackageInfo] = useState<{ included: number; extraPrice: number } | null>(null);
  const [ownerSelectedCount, setOwnerSelectedCount] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [galleryStatus, setGalleryStatus] = useState<string>('sent');
  const [finishing, setFinishing] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [photographerName, setPhotographerName] = useState<string | null>(null);
  const [photographerLogo, setPhotographerLogo] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);

  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const enlargedImgRef = useRef<HTMLImageElement | null>(null);

  // React מצרף מאזיני wheel/touch כ-passive כברירת מחדל, כך ש-preventDefault
  // בתוך onWheel/onTouchMove רגילים בכלל לא עובד (ורק זורק אזהרה בקונסול) -
  // חייבים מאזינים native עם {passive:false}. גלגלת עכבר היא רק חצי מהתמונה:
  // בנייד אין גלגלת בכלל, אז צביטה בשתי אצבעות (pinch) היא הדרך היחידה לזום שם.
  useEffect(() => {
    const img = enlargedImgRef.current;
    if (!img) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      setZoomScale((prev) => Math.min(4, Math.max(1, prev - e.deltaY * 0.0015)));
    }

    let pinchStartDistance = 0;
    let pinchStartScale = 1;

    function touchDistance(touches: TouchList) {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      pinchStartDistance = touchDistance(e.touches);
      setZoomScale((current) => {
        pinchStartScale = current;
        return current;
      });
    }

    function handleTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2 || pinchStartDistance === 0) return;
      e.preventDefault();
      const ratio = touchDistance(e.touches) / pinchStartDistance;
      setZoomScale(Math.min(4, Math.max(1, pinchStartScale * ratio)));
    }

    img.addEventListener('wheel', handleWheel, { passive: false });
    img.addEventListener('touchstart', handleTouchStart, { passive: true });
    img.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      img.removeEventListener('wheel', handleWheel);
      img.removeEventListener('touchstart', handleTouchStart);
      img.removeEventListener('touchmove', handleTouchMove);
    };
  }, [enlargedId]);

  // ניווט בין תמונות עם מקשי חצים, ו-Escape לסגירה - עובד רק כשמצב ההגדלה פתוח.
  useEffect(() => {
    if (!enlargedId) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') navigateEnlarged(1);
      else if (e.key === 'ArrowLeft') navigateEnlarged(-1);
      else if (e.key === 'Escape') setEnlargedId(null);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enlargedId]);

  const [authorized, setAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [actionError, setActionError] = useState('');

  // שיתוף גלריה משפחתי: אחרי קוד גישה תקין, עוד לא ידוע מי בפועל נכנס/ת
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const [myParticipant, setMyParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [joiningAsGuest, setJoiningAsGuest] = useState(false);
  const [guestNameInput, setGuestNameInput] = useState('');
  const [identifying, setIdentifying] = useState(false);
  const [identityError, setIdentityError] = useState('');

  useEffect(() => {
    loadGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  // הטעינה עצמה היא גם בדיקת האימות: העוגייה httpOnly ולא ניתנת לקריאה
  // מ-JS, אז אי אפשר "לבדוק אם קיימת" מראש - פשוט מנסים לטעון, ו-401 אומר שצריך קוד גישה.
  async function loadGallery() {
    setLoading(true);
    setCheckingAuth(true);

    const res = await fetch(`/api/gallery/${galleryId}`);

    if (res.status === 401) {
      setAuthorized(false);
      setCheckingAuth(false);
      setLoading(false);
      return;
    }

    if (!res.ok) {
      setActionError('שגיאה בטעינת הגלריה. נסי לרענן.');
      setCheckingAuth(false);
      setLoading(false);
      return;
    }

    const data = await res.json();
    setAuthorized(true);

    if (data.needsIdentity) {
      setNeedsIdentity(true);
      setRegisteredName(data.registeredName ?? null);
      setCheckingAuth(false);
      setLoading(false);
      return;
    }

    setNeedsIdentity(false);
    setPhotos(data.photos ?? []);
    setMyMarks(data.myMarks ?? {});
    setAllMarks(data.allMarks ?? {});
    setPackageInfo(data.package ?? null);
    setOwnerSelectedCount(data.ownerSelectedCount ?? 0);
    setExpiresAt(data.expiresAt ?? null);
    setGalleryStatus(data.status ?? 'sent');
    setBrandColor(data.brandColor ?? null);
    setPhotographerName(data.photographerName ?? null);
    setPhotographerLogo(data.photographerLogo ?? null);
    setMyParticipant(data.myParticipant ?? null);
    setParticipants(data.participants ?? []);

    // שער פתיחה: מוצג פעם אחת לכל משתתף/ת בכל גלריה (נשמר ב-localStorage,
    // לא ב-DB - זו רק נוחות תצוגה, לא מידע קריטי ששווה טבלה/עמודה בשבילו).
    if (typeof window !== 'undefined' && data.myParticipant) {
      const seenKey = `gallery_welcome_seen_${galleryId}_${data.myParticipant.id}`;
      setShowWelcome(!localStorage.getItem(seenKey));
    }

    setCheckingAuth(false);
    setLoading(false);
  }

  function dismissWelcome() {
    if (typeof window !== 'undefined' && myParticipant) {
      localStorage.setItem(`gallery_welcome_seen_${galleryId}_${myParticipant.id}`, '1');
    }
    setShowWelcome(false);
  }

  async function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');

    const res = await fetch('/api/verify-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ galleryId, accessCode: codeInput.trim() }),
    });

    if (res.ok) {
      await loadGallery();
    } else {
      const data = await res.json();
      setAuthError(data.error ?? 'שגיאה באימות');
    }
  }

  async function confirmIdentity(body: { asOwner: true } | { displayName: string }) {
    setIdentityError('');
    setIdentifying(true);

    const res = await fetch(`/api/gallery/${galleryId}/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    setIdentifying(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setIdentityError(data.error ?? 'ההצטרפות נכשלה, נסי שוב');
      return;
    }

    await loadGallery();
  }

  if (checkingAuth) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: theme.textMuted }}>טוען...</p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form onSubmit={handleSubmitCode} style={{ maxWidth: 320, width: '100%', direction: 'rtl', textAlign: 'center', padding: '2rem' }}>
          <p style={{ marginBottom: '1.25rem', color: theme.gold, fontSize: 18 }}>✨ הזיני את קוד הגישה שקיבלת</p>
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            style={{ ...inputStyle, width: '100%', marginBottom: '0.75rem', textAlign: 'center', fontSize: 18, letterSpacing: 1 }}
            autoFocus
          />
          <button type="submit" style={{ ...goldButtonStyle, width: '100%' }}>
            כניסה לגלריה
          </button>
          {authError && (
            <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
              {authError}
            </p>
          )}
        </form>
      </div>
    );
  }

  if (needsIdentity) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 340, width: '100%', direction: 'rtl', textAlign: 'center', padding: '2rem' }}>
          <p style={{ marginBottom: '1.5rem', color: theme.gold, fontSize: 18, fontFamily: theme.fontSerif }}>
            👋 היי{registeredName ? `, ${registeredName}` : ''}!
          </p>

          {!joiningAsGuest ? (
            <>
              <p style={{ color: theme.textMuted, marginBottom: '1.25rem', fontSize: 14 }}>מי נכנס/ת עכשיו לגלריה?</p>
              <button
                onClick={() => confirmIdentity({ asOwner: true })}
                disabled={identifying}
                style={{ ...goldButtonStyle, width: '100%', opacity: identifying ? 0.6 : 1, marginBottom: '0.6rem' }}
              >
                {identifying ? 'רגע...' : `כן, זאת אני${registeredName ? ` (${registeredName})` : ''}`}
              </button>
              <button onClick={() => setJoiningAsGuest(true)} style={{ ...outlineButtonStyle, width: '100%' }}>
                לא, אני מישהי אחרת
              </button>
            </>
          ) : (
            <>
              <p style={{ color: theme.textMuted, marginBottom: '0.75rem', fontSize: 14 }}>איך קוראים לך?</p>
              <input
                type="text"
                value={guestNameInput}
                onChange={(e) => setGuestNameInput(e.target.value)}
                placeholder="למשל: סבתא רותי"
                style={{ ...inputStyle, width: '100%', marginBottom: '0.75rem', textAlign: 'center' }}
                maxLength={40}
                autoFocus
              />
              <button
                onClick={() => confirmIdentity({ displayName: guestNameInput })}
                disabled={identifying || !guestNameInput.trim()}
                style={{ ...goldButtonStyle, width: '100%', opacity: identifying || !guestNameInput.trim() ? 0.6 : 1, marginBottom: '0.6rem' }}
              >
                {identifying ? 'מצטרפת...' : 'הצטרפות לגלריה'}
              </button>
              <button onClick={() => setJoiningAsGuest(false)} style={{ ...outlineButtonStyle, width: '100%' }}>
                חזרה
              </button>
            </>
          )}

          {identityError && (
            <p style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
              {identityError}
            </p>
          )}
        </div>
      </div>
    );
  }

  function cycleStatus(photoId: string) {
    if (galleryStatus === 'completed' || !myParticipant) return; // הבחירה כבר נשלחה - נעול לעריכה
    const current = myMarks[photoId]?.status; // undefined | 'maybe' | 'selected'
    const next = current === undefined ? 'maybe' : current === 'maybe' ? 'selected' : null;
    return setPhotoStatus(photoId, next);
  }

  // מופרד מ-cycleStatus כדי שגם מצב ההשוואה יוכל לקבוע ישירות "נבחר" על תמונה
  // ספציפית, בלי לעבור דרך הריצה של אולי->נבחר->כלום.
  async function setPhotoStatus(photoId: string, next: 'maybe' | 'selected' | null) {
    if (galleryStatus === 'completed' || !myParticipant) return;
    const current = myMarks[photoId]?.status;

    const res = await fetch(`/api/gallery/${galleryId}/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId, status: next }),
    });

    if (!res.ok) {
      setActionError('העדכון לא נשמר, נסי שוב.');
      return;
    }
    setActionError('');

    setMyMarks((prev) => {
      const nextMarks = { ...prev };
      if (next === null) {
        delete nextMarks[photoId];
      } else {
        nextMarks[photoId] = { status: next, note: prev[photoId]?.note ?? null };
      }
      return nextMarks;
    });

    // מעדכנים גם את התג המשותף (allMarks) מקומית, כדי שבני משפחה אחרים שכבר
    // רואים את המסך הזה לא יראו תג ישן שלי - בלי לטעון מחדש את כל הגלריה.
    setAllMarks((prev) => {
      const others = (prev[photoId] ?? []).filter((m) => m.participantId !== myParticipant.id);
      const mine = next === null ? [] : [{ participantId: myParticipant.id, displayName: myParticipant.displayName, status: next }];
      return { ...prev, [photoId]: [...others, ...mine] };
    });

    if (myParticipant.isOwner && next === 'selected') {
      setOwnerSelectedCount((prev) => prev + (current === 'selected' ? 0 : 1));
    } else if (myParticipant.isOwner && current === 'selected' && next !== 'selected') {
      setOwnerSelectedCount((prev) => Math.max(0, prev - 1));
    }
  }

  function openNoteEditor(photoId: string, e: React.MouseEvent) {
    e.stopPropagation(); // לא לגעת בבחירה עצמה
    if (galleryStatus === 'completed') return;
    setNoteEditingId(photoId);
    setNoteDraft(myMarks[photoId]?.note ?? '');
  }

  async function handleFinish() {
    if (!window.confirm('לשלוח את הבחירה? אחרי זה לא ניתן יהיה לשנות אותה.')) return;

    setFinishing(true);
    const res = await fetch(`/api/gallery/${galleryId}/finish`, { method: 'POST' });
    setFinishing(false);

    if (!res.ok) {
      setActionError('שליחת הבחירה נכשלה, נסי שוב.');
      return;
    }

    setActionError('');
    setGalleryStatus('completed');
  }

  async function clearAllSelections() {
    if (!myParticipant || galleryStatus === 'completed') return;
    if (!window.confirm('לבטל את כל הבחירות שלך בגלריה הזו? אי אפשר לשחזר את זה.')) return;

    setClearingAll(true);
    const res = await fetch(`/api/gallery/${galleryId}/selection`, { method: 'DELETE' });
    setClearingAll(false);

    if (!res.ok) {
      setActionError('ביטול הבחירות נכשל, נסי שוב.');
      return;
    }
    setActionError('');

    setMyMarks({});
    setAllMarks((prev) => {
      const next: Record<string, Mark[]> = {};
      for (const [photoId, marks] of Object.entries(prev)) {
        const remaining = marks.filter((m) => m.participantId !== myParticipant.id);
        if (remaining.length > 0) next[photoId] = remaining;
      }
      return next;
    });
    if (myParticipant.isOwner) {
      setOwnerSelectedCount(0);
    }
  }

  async function saveNote() {
    if (!noteEditingId) return;
    const trimmed = noteDraft.trim();

    const res = await fetch(`/api/gallery/${galleryId}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: noteEditingId, note: trimmed }),
    });

    if (!res.ok) {
      setActionError('ההערה לא נשמרה, נסי שוב.');
      return;
    }
    setActionError('');

    setMyMarks((prev) => {
      const existing = prev[noteEditingId];
      if (!existing) return prev;
      return { ...prev, [noteEditingId]: { ...existing, note: trimmed || null } };
    });
    setNoteEditingId(null);
  }

  function toggleCompareSelect(photoId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCompareIds((prev) => {
      if (prev.includes(photoId)) return prev.filter((id) => id !== photoId);
      if (prev.length >= 2) return [prev[1], photoId]; // מחליף את הישן ביותר
      return [...prev, photoId];
    });
  }

  // דפדוף בין תמונות במצב הגדלה - בלי לצאת ולהיכנס מחדש מהגריד. מאפסת זום
  // בכל מעבר, כדי שלא להישאר מוגדלת על תמונה חדשה בטעות.
  function navigateEnlarged(delta: 1 | -1) {
    const currentIndex = photos.findIndex((p) => p.id === enlargedId);
    const nextIndex = currentIndex + delta;
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= photos.length) return;
    setZoomScale(1);
    setEnlargedId(photos[nextIndex].id);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, color: theme.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>טוען גלריה...</p>
      </div>
    );
  }

  // "נבחרו X/Y" ופס ההתקדמות תמיד לפי ה-ownerSelectedCount (הרשמי) - לא לפי
  // הבחירות המקומיות של המשתמש/ת הנוכחי/ת, כדי שאורחים לא יראו מספר "כאילו רשמי"
  // שלא באמת נספר. ראו app/api/gallery/[id]/route.ts.
  const myStatuses = Object.fromEntries(Object.entries(myMarks).map(([id, m]) => [id, m.status]));
  const mySelectedCount = Object.values(myStatuses).filter((s) => s === 'selected').length;
  const maybeCount = Object.values(myStatuses).filter((s) => s === 'maybe').length;
  const overIncluded = packageInfo ? Math.max(0, ownerSelectedCount - packageInfo.included) : 0;
  const remaining = packageInfo ? Math.max(0, packageInfo.included - ownerSelectedCount) : 0;
  const extraCost = packageInfo ? overIncluded * packageInfo.extraPrice : 0;
  const progressPct = packageInfo && packageInfo.included > 0
    ? Math.min(100, Math.round((ownerSelectedCount / packageInfo.included) * 100))
    : 0;
  const owner = participants.find((p) => p.isOwner);
  const isOwner = myParticipant?.isOwner ?? false;

  // "צבע מותג": אם הצלמת לא הגדירה אחד בהגדרות, נשארים עם הפלטה המקורית
  // (theme.gold/goldBright) - ראו app/api/gallery/[id]/route.ts.
  const accent = brandColor ?? theme.goldBright;
  const accentSolid = brandColor ?? theme.gold;
  const accentText = brandColor ? contrastTextColor(brandColor) : theme.goldText;
  const primaryButtonStyle = brandColor
    ? { ...goldButtonStyle, background: brandColor, color: accentText }
    : goldButtonStyle;

  if (showWelcome) {
    const avatarInitial = (photographerName || myParticipant?.displayName || '?').trim().charAt(0).toUpperCase();

    return (
      <div
        style={{
          minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center',
          justifyContent: 'center', direction: 'rtl', fontFamily: theme.fontSans, padding: '1.5rem',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `radial-gradient(circle at 50% 15%, ${accent}2e, transparent 55%)`,
          }}
        />
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center', position: 'relative' }}>
          <div
            style={{
              width: 96, height: 96, borderRadius: '50%', margin: '0 auto 1.25rem', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: photographerLogo ? theme.panel : `linear-gradient(135deg, ${accentSolid}, ${accent})`,
              border: `2px solid ${accent}`, boxShadow: `0 0 0 6px ${accent}22, 0 10px 28px ${accent}33`,
            }}
          >
            {photographerLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photographerLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 36, fontFamily: theme.fontSerif, color: accentText }}>{avatarInitial}</span>
            )}
          </div>

          {photographerName && (
            <p style={{ color: accent, fontSize: 14, marginBottom: '0.5rem', letterSpacing: 0.5 }}>✨ {photographerName}</p>
          )}
          <p style={{ fontSize: 24, fontFamily: theme.fontSerif, marginBottom: '0.75rem' }}>
            ברוכה הבאה{myParticipant ? `, ${myParticipant.displayName}` : ''}!
          </p>
          <p style={{ color: theme.textMuted, fontSize: 14, marginBottom: '1.5rem', lineHeight: 1.6 }}>
            הגלריה מוכנה לבחירה
            {packageInfo ? ` - יש לך ${packageInfo.included} תמונות במסגרת החבילה` : ''}
            {expiresAt ? `, עד ${new Date(expiresAt).toLocaleDateString('he-IL')}` : ''}.
          </p>
          <div
            style={{
              textAlign: 'right', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10,
              padding: '1rem 1.25rem', marginBottom: '1.5rem', fontSize: 13, color: theme.textMuted,
              display: 'flex', flexDirection: 'column', gap: '0.5rem',
            }}
          >
            <span>⇄ אפשר להשוות בין שתי תמונות זו לצד זו</span>
            <span>✎ אפשר להוסיף הערה אישית לכל תמונה</span>
            {!isOwner && (
              <span>👀 הבחירות שלך כאן הן קלט לדיון - רק {owner?.displayName ?? 'הלקוחה הראשית'} יכולה לסיים בפועל</span>
            )}
          </div>
          <button onClick={dismissWelcome} style={{ ...primaryButtonStyle, width: '100%' }}>
            בואי נתחיל ✨
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: theme.bg, minHeight: '100vh', color: theme.text, direction: 'rtl', fontFamily: theme.fontSans }}>
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 50, backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.5rem', borderBottom: `1px solid ${theme.border}`, flexWrap: 'wrap', gap: '1rem',
          background: 'rgba(15,22,38,0.92)',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: theme.green, display: 'inline-block' }} />
            אולי ({maybeCount})
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: accent, display: 'inline-block' }} />
            נבחר ({mySelectedCount})
          </span>
          {myParticipant && (
            <span style={{ color: theme.textFaint, fontSize: 12 }}>
              מחוברת בתור {myParticipant.displayName}{isOwner ? '' : ' (אורחת)'}
            </span>
          )}
          <button
            onClick={() => {
              setCompareMode((prev) => !prev);
              setCompareIds([]);
            }}
            style={{
              ...outlineButtonStyle, padding: '0.35rem 0.75rem', fontSize: 12,
              borderColor: compareMode ? accent : theme.border, color: compareMode ? accent : theme.textMuted,
            }}
          >
            {compareMode ? '✕ צאי ממצב השוואה' : '⇄ השוואה'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div>
              נבחרו במסגרת החבילה{' '}
              <b style={{ color: accent, fontFamily: theme.fontSerif }}>{packageInfo?.included ?? 0}</b> / {ownerSelectedCount}
            </div>
            <div style={{ fontSize: 12, color: theme.textFaint }}>
              {isOwner ? `${maybeCount} תמונות "אולי"` : `הבחירות שלך (קלט בלבד): ${mySelectedCount} נבחרו, ${maybeCount} אולי`}
            </div>
          </div>
          <div
            style={{
              width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 'bold', color: accent, fontFamily: theme.fontSerif,
              background: `conic-gradient(${accentSolid} ${progressPct}%, ${theme.panelInput} ${progressPct}%)`,
            }}
          >
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {progressPct}%
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          margin: '0.75rem 1.5rem 0', padding: '0.6rem 1rem', borderRadius: 8,
          background: theme.panel, border: `1px solid ${theme.border}`, fontSize: 13, color: theme.textMuted,
          display: 'flex', gap: '1.25rem', flexWrap: 'wrap',
        }}
      >
        {packageInfo && (
          <span>
            החבילה כוללת <b style={{ color: theme.text }}>{packageInfo.included}</b> תמונות
            {remaining > 0 && <> · נשארו לך עוד <b style={{ color: accent }}>{remaining}</b> במסגרת החבילה</>}
          </span>
        )}
        {expiresAt && (
          <span>
            ניתן לבחור עד <b style={{ color: theme.text }}>{new Date(expiresAt).toLocaleDateString('he-IL')}</b>
          </span>
        )}
      </div>

      <p style={{ textAlign: 'center', fontSize: 12, color: theme.textFaint, padding: '0.5rem 1.5rem 0' }}>
        לחיצה ראשונה על תמונה = <span style={{ color: theme.green }}>אולי</span> · לחיצה שנייה = <span style={{ color: accent }}>נבחר</span> · לחיצה שלישית מבטלת
      </p>

      {overIncluded > 0 && (
        <div style={{ padding: '0.5rem 1.5rem', background: theme.warningBg, color: theme.warningText, fontSize: 14 }}>
          עברת ב-{overIncluded} תמונות מהחבילה — עלות נוספת: {extraCost.toFixed(2)} ₪
        </div>
      )}

      {actionError && (
        <div style={{ padding: '0.5rem 1.5rem', background: theme.errorBg, color: theme.errorText, fontSize: 14 }}>
          {actionError}
        </div>
      )}

      {galleryStatus === 'completed' && (
        <div style={{ padding: '0.5rem 1.5rem', background: theme.successBg, color: theme.successText, fontSize: 14, textAlign: 'center' }}>
          ✓ הבחירה נשלחה. אפשר עדיין לצפות בתמונות, אבל לא לשנות את הבחירה.
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 13, color: theme.textFaint, padding: '0.75rem 0 0' }}>
        תמונות מוגנות בסימן מים · הורדה וגרירה חסומות בגלריה האמיתית
      </p>

      <div style={{ padding: '0 1.5rem 1rem', textAlign: 'center' }}>
        <button
          onClick={() => {
            setCompareMode((prev) => !prev);
            setCompareIds([]);
          }}
          style={{ ...outlineButtonStyle, marginTop: '0.5rem' }}
        >
          {compareMode ? 'צאי ממצב השוואה' : '⇄ השוואה בין 2 תמונות'}
        </button>
        {compareMode && <span style={{ marginRight: '0.5rem', fontSize: 13, color: theme.textMuted }}>בחרי שתי תמונות להשוואה ({compareIds.length}/2)</span>}

        {galleryStatus !== 'completed' && (mySelectedCount > 0 || maybeCount > 0) && (
          <button
            onClick={clearAllSelections}
            disabled={clearingAll}
            style={{ ...outlineButtonStyle, marginTop: '0.5rem', marginRight: '0.5rem', color: theme.errorText, opacity: clearingAll ? 0.6 : 1 }}
          >
            {clearingAll ? 'מבטלת...' : '🗑 ביטול כל הבחירה שלי'}
          </button>
        )}

        {galleryStatus !== 'completed' && isOwner && (
          <button
            onClick={handleFinish}
            disabled={finishing || ownerSelectedCount === 0}
            title={ownerSelectedCount === 0 ? 'בחרי לפחות תמונה אחת קודם' : undefined}
            style={{
              ...primaryButtonStyle,
              display: 'block', margin: '0.75rem auto 0',
              opacity: finishing || ownerSelectedCount === 0 ? 0.5 : 1,
            }}
          >
            {finishing ? 'שולחת...' : 'סיימתי לבחור ✓'}
          </button>
        )}

        {galleryStatus !== 'completed' && !isOwner && (
          <p style={{ fontSize: 13, color: theme.textFaint, marginTop: '0.75rem' }}>
            רק {owner?.displayName ?? 'הלקוחה הראשית'} יכולה לסיים את הבחירה הסופית - הבחירות שלך כאן הן קלט לדיון.
          </p>
        )}
      </div>

      {compareMode && compareIds.length === 2 && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem',
          }}
          onClick={() => setCompareIds([])}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCompareMode(false);
              setCompareIds([]);
            }}
            title="יציאה ממצב השוואה"
            style={{
              position: 'absolute', top: 16, insetInlineEnd: 16, zIndex: 51,
              width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.4)',
              background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>

          {compareIds.map((id) => {
            const photo = photos.find((p) => p.id === id);
            if (!photo || !photo.fullUrl) return null;
            return (
              <div
                key={id}
                onClick={(e) => e.stopPropagation()}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', maxWidth: '45%' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.fullUrl}
                  alt=""
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    maxHeight: '80vh', maxWidth: '100%', objectFit: 'contain', borderRadius: 6,
                    WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                  }}
                />
                {galleryStatus !== 'completed' && myParticipant && (
                  <button
                    onClick={async () => {
                      await setPhotoStatus(id, 'selected');
                      setCompareMode(false);
                      setCompareIds([]);
                    }}
                    style={{ ...primaryButtonStyle, padding: '0.5rem 1.25rem' }}
                  >
                    בחרי את זו ✓
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {enlargedId && (() => {
        const photo = photos.find((p) => p.id === enlargedId);
        if (!photo?.fullUrl) return null;
        const currentIndex = photos.findIndex((p) => p.id === enlargedId);
        const hasPrev = currentIndex > 0;
        const hasNext = currentIndex < photos.length - 1;
        return (
          <div
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 50,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
            }}
            onClick={() => setEnlargedId(null)}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEnlargedId(null);
              }}
              title="סגירה"
              style={{
                position: 'absolute', top: 16, insetInlineEnd: 16, zIndex: 51,
                width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.4)',
                background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 18, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✕
            </button>
            {hasPrev && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateEnlarged(-1);
                }}
                title="הקודמת"
                style={{
                  position: 'absolute', top: '50%', insetInlineStart: 16, transform: 'translateY(-50%)', zIndex: 51,
                  width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 20, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ‹
              </button>
            )}
            {hasNext && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateEnlarged(1);
                }}
                title="הבאה"
                style={{
                  position: 'absolute', top: '50%', insetInlineEnd: 16, transform: 'translateY(-50%)', zIndex: 51,
                  width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 20, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ›
              </button>
            )}
            {zoomScale > 1 && (
              <div
                style={{
                  position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 51,
                  background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 12,
                  padding: '4px 10px', borderRadius: 12,
                }}
              >
                {Math.round(zoomScale * 100)}%
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={enlargedImgRef}
              src={photo.fullUrl}
              alt=""
              draggable={false}
              onClick={(e) => {
                e.stopPropagation();
                setZoomScale((prev) => (prev > 1 ? 1 : 2));
              }}
              onContextMenu={(e) => e.preventDefault()}
              title="קליק או גלגלת עכבר להגדלה/הקטנה"
              style={{
                maxHeight: '90vh', maxWidth: '90vw', objectFit: 'contain', borderRadius: 6,
                transform: `scale(${zoomScale})`, transition: zoomScale === 1 ? 'transform 0.15s ease-out' : 'none',
                cursor: zoomScale > 1 ? 'zoom-out' : 'zoom-in',
                WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
              }}
            />
          </div>
        );
      })()}

      {noteEditingId && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setNoteEditingId(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: theme.panel, color: theme.text, padding: '1.25rem', borderRadius: 10, width: 320, border: `1px solid ${theme.border}` }}>
            <p style={{ fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.75rem' }}>הערה לתמונה</p>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              style={{ ...inputStyle, width: '100%' }}
              placeholder="למשל: את זו רוצה בשחור-לבן"
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button onClick={saveNote} style={{ ...goldButtonStyle, padding: '0.5rem 1rem' }}>שמירה</button>
              <button onClick={() => setNoteEditingId(null)} style={{ ...outlineButtonStyle, padding: '0.5rem 1rem' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '1rem',
          padding: '0 1.5rem 1.5rem',
        }}
      >
        {photos.map((photo) => {
          const status = myStatuses[photo.id]; // undefined | 'maybe' | 'selected'
          const isComparing = compareIds.includes(photo.id);
          const hasNote = !!myMarks[photo.id]?.note;
          const othersMarks = (allMarks[photo.id] ?? []).filter((m) => m.participantId !== myParticipant?.id);

          const borderColor = isComparing
            ? theme.compare
            : status === 'selected'
            ? accent
            : status === 'maybe'
            ? theme.green
            : 'transparent';

          const heartBg = status === 'selected' ? accent : status === 'maybe' ? theme.green : 'rgba(10,10,11,0.6)';
          const heartFilled = status !== undefined;
          const heartColor = status === 'selected' ? accentText : heartFilled ? theme.goldText : '#fff';

          return (
            <div
              key={photo.id}
              onClick={(e) => (compareMode ? toggleCompareSelect(photo.id, e) : cycleStatus(photo.id))}
              onContextMenu={(e) => e.preventDefault()} // חסימת קליק ימני - הרתעה בלבד, לא הגנה אמיתית
              style={{
                position: 'relative',
                cursor: compareMode || galleryStatus !== 'completed' ? 'pointer' : 'default',
                border: `2px solid ${borderColor}`,
                borderRadius: 6,
                overflow: 'hidden',
                background: theme.panel,
              }}
            >
              <div
                style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 1,
                  background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 10,
                  padding: '2px 7px', borderRadius: 10,
                }}
              >
                {photo.original_filename}
              </div>

              {photo.possiblyBlurry && (
                <div
                  title="הערכה אוטומטית לפי חדות - לא תמיד מדויקת, בדקי בעצמך"
                  style={{
                    position: 'absolute', bottom: compareMode ? 8 : 32, right: 8, zIndex: 1,
                    background: theme.warningBg, color: theme.warningText, fontSize: 10,
                    padding: '2px 7px', borderRadius: 10,
                  }}
                >
                  ייתכן שמטושטשת (הערכה אוטומטית)
                </div>
              )}

              {!compareMode && photo.thumbnailUrl && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoomScale(1);
                    setEnlargedId(photo.id);
                  }}
                  title="הגדלת תמונה"
                  style={{
                    position: 'absolute', bottom: 8, right: 8, zIndex: 1,
                    background: 'rgba(0,0,0,0.45)', border: 'none', color: '#fff',
                    borderRadius: '50%', width: 26, height: 26, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                  }}
                >
                  🔍
                </button>
              )}

              {othersMarks.length > 0 && (
                <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, display: 'flex', gap: 2 }}>
                  {othersMarks.map((m) => (
                    <span
                      key={m.participantId}
                      title={`${m.displayName}: ${m.status === 'selected' ? 'נבחר' : 'אולי'}`}
                      style={{
                        width: 18, height: 18, borderRadius: '50%', fontSize: 10, fontWeight: 'bold',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: m.status === 'selected' ? accent : theme.green,
                        color: m.status === 'selected' ? accentText : theme.goldText,
                        border: '1px solid rgba(255,255,255,0.5)',
                      }}
                    >
                      {initials(m.displayName)}
                    </span>
                  ))}
                </div>
              )}

              {!compareMode && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    cycleStatus(photo.id);
                  }}
                  title="לחיצה: מחזור בין אולי / נבחר / כלום"
                  style={{
                    position: 'absolute', top: othersMarks.length > 0 ? 32 : 8, left: 8, zIndex: 1,
                    background: heartBg, border: '1px solid rgba(255,255,255,0.3)', color: heartColor,
                    borderRadius: '50%', width: 30, height: 30,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}
                >
                  {heartFilled ? '♥' : '♡'}
                </div>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.thumbnailUrl ?? ''}
                alt=""
                draggable={false}
                style={{
                  width: '100%', display: 'block', pointerEvents: 'none', aspectRatio: '3/4', objectFit: 'cover',
                  WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                }}
              />

              {status && (
                <button
                  onClick={(e) => openNoteEditor(photo.id, e)}
                  title="הוסיפי הערה"
                  style={{
                    position: 'absolute', bottom: 8, left: 8,
                    background: hasNote ? theme.goldBright : 'rgba(255,255,255,0.85)',
                    border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
                  }}
                >
                  ✎
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
