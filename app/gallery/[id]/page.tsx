'use client';

import React, { useEffect, useRef, useState } from 'react';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { toHebrewDateString } from '@/lib/hebrewDate';

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

// חגיגת קונפטי קצרה כשהבחירה באמת נשלחת (סוף submitFinish) - רגע רגשי אמיתי
// אחרי תהליך בחירה ארוך, בלי שום קשר לשאלת "מה תמונה טובה". CSS טהור, בלי
// ספרייה חיצונית.
const CONFETTI_COLORS = ['#c98f89', '#e3b3ac', '#7fae86', '#8fa8c9'];
const CONFETTI_PIECE_COUNT = 60;

interface ConfettiPiece {
  id: number;
  left: number;
  size: number;
  color: string;
  duration: number;
  delay: number;
}

function generateConfetti(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_PIECE_COUNT }, (_, id) => ({
    id,
    left: Math.random() * 100,
    size: 6 + Math.random() * 8,
    color: CONFETTI_COLORS[id % CONFETTI_COLORS.length],
    duration: 2.5 + Math.random() * 1.5,
    delay: Math.random() * 0.6,
  }));
}

// כמה זמן יש לבטל אחרי "סיימתי לבחור" לפני שהמייל לצלמת באמת נשלח והגלריה
// ננעלת - כמו "ביטול שליחה" ב-Gmail, כדי שקליק בטעות/חרטה מיידית לא יהיו סופיים.
const FINISH_UNDO_SECONDS = 60;

// כמה תמונות אפשר להשוות בו-זמנית - יותר מזה נהיה צפוף מדי לראות הבדלים
// אמיתיים בין תמונות, במיוחד בנייד.
const MAX_COMPARE = 4;

// ראשי תיבות קצרים לתג "מי בחר מה" - שם מלא לא נכנס בעיגול קטן
function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// עוזר טהור למצב "בחירה מהירה" - מדלג קדימה מ-fromIndex על תמונות שכבר
// סומנו (למשל דרך הגריד הרגיל, או בסבב קודם) עד לתמונה הראשונה שעוד לא
// הוכרעה. מוחזר queue.length אם לא נשארה אף תמונה לא-מסומנת (=הסבב נגמר).
function findNextUnmarkedIndex(queue: string[], fromIndex: number, isMarked: (id: string) => boolean): number {
  for (let i = fromIndex; i < queue.length; i++) {
    if (!isMarked(queue[i])) return i;
  }
  return queue.length;
}

// תור פעולות ממתינות (localStorage) - כשהאינטרנט חלש/מנותק באירוע עצמו,
// בחירה/הערה נשמרת מקומית ומסונכרנת אוטומטית ברגע שהחיבור חוזר, כדי שהלקוחה
// תוכל להמשיך לדפדף ולבחור בלי לחכות לתשובת שרת על כל קליק.
type PendingAction =
  | { type: 'status'; photoId: string; status: 'maybe' | 'selected' | null }
  | { type: 'note'; photoId: string; note: string };

function pendingQueueKey(galleryId: string, participantId: string): string {
  return `gallery_pending_${galleryId}_${participantId}`;
}

function loadPendingQueue(galleryId: string, participantId: string): PendingAction[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(pendingQueueKey(galleryId, participantId)) ?? '[]');
  } catch {
    return [];
  }
}

function savePendingQueue(galleryId: string, participantId: string, queue: PendingAction[]) {
  localStorage.setItem(pendingQueueKey(galleryId, participantId), JSON.stringify(queue));
}

export default function GalleryPage({ params }: GalleryPageProps) {
  const galleryId = params.id;

  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [myMarks, setMyMarks] = useState<Record<string, { status: 'maybe' | 'selected'; note: string | null }>>({});
  const [allMarks, setAllMarks] = useState<Record<string, Mark[]>>({});
  const [packageInfo, setPackageInfo] = useState<{ included: number; extraPrice: number; basePrice: number } | null>(null);
  const [ownerSelectedCount, setOwnerSelectedCount] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [galleryStatus, setGalleryStatus] = useState<string>('sent');
  const [finishing, setFinishing] = useState(false);
  const [finishCountdown, setFinishCountdown] = useState<number | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const [clearingAll, setClearingAll] = useState(false);
  const [aiPicksRunning, setAiPicksRunning] = useState(false);
  const [aiPicksMessage, setAiPicksMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [photographerName, setPhotographerName] = useState<string | null>(null);
  const [photographerLogo, setPhotographerLogo] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);

  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const [viewFilter, setViewFilter] = useState<'all' | 'selected' | 'maybe'>('all');
  const [isOffline, setIsOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  // האם תצוגת ההשוואה במסך מלא פתוחה כרגע - נפרד בכוונה מ"האם נבחרו >= 2
  // תמונות": בלי ההפרדה הזו, ברגע שנבחרת תמונה שנייה התצוגה (fixed, inset:0)
  // הייתה נפתחת אוטומטית ומכסה את כל הגריד, ולא הייתה שום דרך לחזור אליו
  // ולבחור תמונה שלישית/רביעית - MAX_COMPARE=4 היה קיים בקוד אבל לא ניתן
  // להגיע אליו בפועל. עכשיו בוחרים עד 4 בגריד קודם, ופותחים את התצוגה ביוזמה
  // מפורשת (הכפתור למטה).
  const [compareViewOpen, setCompareViewOpen] = useState(false);
  const [swipeMode, setSwipeMode] = useState(false);
  const [swipeQueue, setSwipeQueue] = useState<string[]>([]);
  const [swipeCursor, setSwipeCursor] = useState(0);
  const [swipePass, setSwipePass] = useState<1 | 2>(1);
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const enlargedImgRef = useRef<HTMLImageElement | null>(null);

  // מצב סקירה ברצף (סליידשואו) - עמדה נפרדת לגמרי ממצב ההגדלה (enlargedId):
  // דפדוף לפי סדר photos, לא לפי enlargedId, כדי שאפשר יהיה להשאיר את
  // ההגדלה הרגילה בלי שינוי.
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowIndex, setSlideshowIndex] = useState(0);

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

  // ניווט וסגירה במקלדת במצב סקירה ברצף - מאזין נפרד מזה של ההגדלה הרגילה,
  // ופעיל רק כשהסליידשואו פתוח, כדי שלא יתנגשו זה בזה.
  useEffect(() => {
    if (!slideshowActive) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') navigateSlideshow(1);
      else if (e.key === 'ArrowLeft') navigateSlideshow(-1);
      else if (e.key === 'Escape') setSlideshowActive(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideshowActive]);

  // חצים ל"בחירה מהירה" - מוסכמה מוכרת מאפליקציות סוויפ (ימינה=כן, שמאלה=לא):
  // ימינה=👍 בחרי, שמאלה=👎 דילוג, למטה/רווח=🤔 אולי. הכפתורים על המסך נשארים
  // הדרך העיקרית (המצב מיועד בעיקר לנייד), זו רק נוחות נוספת למי שבמחשב.
  useEffect(() => {
    if (!swipeMode) return;

    function handleSwipeKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        exitSwipeMode();
        return;
      }
      if (swipeCursor >= swipeQueue.length) return; // מסך הסיכום - רק Escape רלוונטי
      if (e.key === 'ArrowRight') handleSwipeAction('selected');
      else if (e.key === 'ArrowLeft') handleSwipeAction(null);
      else if (e.key === 'ArrowDown' || e.key === ' ') handleSwipeAction('maybe');
    }

    window.addEventListener('keydown', handleSwipeKeyDown);
    return () => window.removeEventListener('keydown', handleSwipeKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swipeMode, swipeQueue, swipeCursor, myMarks]);

  // מצב אופליין: רושמים service worker שממטמן תמונות שכבר נטענו (public/sw.js),
  // כדי שדפדוף בתמונות שכבר נצפו ימשיך לעבוד גם באינטרנט חלש/מנותק באירוע.
  useEffect(() => {
    function updateOnlineStatus() {
      setIsOffline(!navigator.onLine);
    }
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

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

  // מנסה לשלוח שוב פעולות שהמתינו בתור (localStorage) כי נכשלו על ניתוק -
  // כשמזהים משתתפ/ת (myParticipant), כשהחיבור חוזר, וגם כל 20 שניות ליתר ביטחון
  // (אירוע 'online' לא תמיד יורה כשהאינטרנט "חלש" ולא ממש מנותק).
  useEffect(() => {
    if (!myParticipant) return;
    setPendingCount(loadPendingQueue(galleryId, myParticipant.id).length);
    flushPendingQueue();

    window.addEventListener('online', flushPendingQueue);
    const interval = setInterval(flushPendingQueue, 20000);

    return () => {
      window.removeEventListener('online', flushPendingQueue);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myParticipant?.id]);

  // ספירה לאחור ל"סיימתי לבחור" (ראו handleFinish/submitFinish/cancelFinish) -
  // כל שנייה עד 0, ואז שולחת בפועל. ביטול (cancelFinish) פשוט מאפס את
  // finishCountdown ל-null, מה שמנקה את ה-interval הזה בלי לקרוא ל-submitFinish.
  useEffect(() => {
    if (finishCountdown === null) return;
    if (finishCountdown <= 0) {
      submitFinish();
      setFinishCountdown(null);
      return;
    }
    const timer = setTimeout(() => setFinishCountdown((prev) => (prev === null ? null : prev - 1)), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishCountdown]);

  // הטעינה עצמה היא גם בדיקת האימות: העוגייה httpOnly ולא ניתנת לקריאה
  // מ-JS, אז אי אפשר "לבדוק אם קיימת" מראש - פשוט מנסים לטעון, ו-401 אומר שצריך קוד גישה.
  async function loadGallery() {
    setLoading(true);
    setCheckingAuth(true);

    let res: Response;
    try {
      res = await fetch(`/api/gallery/${galleryId}`);
    } catch {
      setAuthError('אין חיבור לאינטרנט. בדקי את החיבור ונסי שוב.');
      setCheckingAuth(false);
      setLoading(false);
      return;
    }

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
          <label htmlFor="access-code" style={{ display: 'block', marginBottom: '1.25rem', color: theme.gold, fontSize: 18 }}>
            ✨ הזיני את קוד הגישה שקיבלת
          </label>
          <input
            id="access-code"
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            style={{ ...inputStyle, width: '100%', marginBottom: '0.75rem', textAlign: 'center', fontSize: 18, letterSpacing: 1 }}
            aria-describedby={authError ? 'access-code-error' : undefined}
            autoFocus
          />
          <button type="submit" style={{ ...goldButtonStyle, width: '100%' }}>
            כניסה לגלריה
          </button>
          {authError && (
            <p id="access-code-error" role="alert" style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
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
              <label htmlFor="guest-name" style={{ display: 'block', color: theme.textMuted, marginBottom: '0.75rem', fontSize: 14 }}>
                איך קוראים לך?
              </label>
              <input
                id="guest-name"
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

  // שולח פעולה אחת לשרת ומדווח אם הצליחה, נדחתה ע"י השרת (שגיאה אמיתית), או
  // נכשלה בגלל ניתוק/רשת - כדי ש-setPhotoStatus/saveNote יידעו אם לבטל את
  // העדכון האופטימי (שגיאת שרת) או להכניס לתור לניסיון חוזר (ניתוק).
  async function postAction(action: PendingAction): Promise<'ok' | 'server-error' | 'network-error'> {
    try {
      const res = await fetch(
        action.type === 'status' ? `/api/gallery/${galleryId}/selection` : `/api/gallery/${galleryId}/note`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            action.type === 'status'
              ? { photoId: action.photoId, status: action.status }
              : { photoId: action.photoId, note: action.note }
          ),
        }
      );
      return res.ok ? 'ok' : 'server-error';
    } catch {
      return 'network-error';
    }
  }

  function enqueuePendingAction(action: PendingAction) {
    if (!myParticipant) return;
    // מחליף פעולה קודמת על אותה תמונה מאותו סוג - רק המצב האחרון חשוב,
    // לא כל קליק ביניים כשמנתקים ומחזירים חיבור כמה פעמים
    const queue = loadPendingQueue(galleryId, myParticipant.id).filter(
      (a) => !(a.type === action.type && a.photoId === action.photoId)
    );
    queue.push(action);
    savePendingQueue(galleryId, myParticipant.id, queue);
    setPendingCount(queue.length);
  }

  async function flushPendingQueue() {
    if (!myParticipant) return;
    const queue = loadPendingQueue(galleryId, myParticipant.id);
    if (queue.length === 0) return;

    let stoppedAt = queue.length;
    for (let i = 0; i < queue.length; i++) {
      const result = await postAction(queue[i]);
      if (result === 'network-error') {
        stoppedAt = i; // עדיין בלי חיבור - עוצרים כאן, מנסים שוב בפעם הבאה
        break;
      }
      // 'ok' או 'server-error' - בשני המקרים לא מנסים שוב את אותה פעולה
    }
    const remaining = queue.slice(stoppedAt);
    savePendingQueue(galleryId, myParticipant.id, remaining);
    setPendingCount(remaining.length);
  }

  function cycleStatus(photoId: string) {
    if (galleryStatus === 'completed' || !myParticipant) return; // הבחירה כבר נשלחה - נעול לעריכה
    const current = myMarks[photoId]?.status; // undefined | 'maybe' | 'selected'
    const next = current === undefined ? 'maybe' : current === 'maybe' ? 'selected' : null;
    return setPhotoStatus(photoId, next);
  }

  // מחיל שינוי סטטוס על המצב המקומי (myMarks/allMarks/ownerSelectedCount) -
  // מופרד מ-setPhotoStatus כדי שאפשר יהיה גם להחיל אותו אופטימית מיד וגם
  // לבטל אותו (קריאה הפוכה עם current/next מוחלפים) אם השרת דוחה את הבקשה.
  function applyStatusChange(photoId: string, next: 'maybe' | 'selected' | null, current: 'maybe' | 'selected' | undefined) {
    if (!myParticipant) return;
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

  // מופרד מ-cycleStatus כדי שגם מצב ההשוואה יוכל לקבוע ישירות "נבחר" על תמונה
  // ספציפית, בלי לעבור דרך הריצה של אולי->נבחר->כלום.
  //
  // מעדכן את המסך מיד (אופטימי), לפני תשובת השרת - כדי שאפשר יהיה להמשיך
  // לדפדף ולבחור גם באינטרנט חלש/מנותק. אם זו שגיאת רשת (לא שרת), הפעולה
  // נכנסת לתור ותסונכרן אוטומטית כשהחיבור יחזור (ראו flushPendingQueue).
  async function setPhotoStatus(photoId: string, next: 'maybe' | 'selected' | null) {
    if (galleryStatus === 'completed' || !myParticipant) return;
    const current = myMarks[photoId]?.status;

    applyStatusChange(photoId, next, current);

    const result = await postAction({ type: 'status', photoId, status: next });

    if (result === 'network-error') {
      enqueuePendingAction({ type: 'status', photoId, status: next });
      setActionError('');
      return;
    }
    if (result === 'server-error') {
      applyStatusChange(photoId, current ?? null, next ?? undefined); // ביטול העדכון האופטימי - שגיאה אמיתית, לא ניתוק
      setActionError('העדכון לא נשמר, נסי שוב.');
      return;
    }
    setActionError('');
  }

  function openNoteEditor(photoId: string, e: React.MouseEvent) {
    e.stopPropagation(); // לא לגעת בבחירה עצמה
    if (galleryStatus === 'completed') return;
    setNoteEditingId(photoId);
    setNoteDraft(myMarks[photoId]?.note ?? '');
  }

  // הלקוחה עדיין רואה ועורכת הכל כרגיל בזמן הספירה - רק בתום ה-60 שניות
  // (או אם לא ביטלה) קוראים בפועל ל-API, שגם נועל את הגלריה וגם שולח מייל
  // התראה לצלמת "הלקוחה סיימה" - לא רוצים לשלוח את זה מוקדם מדי ואז לבטל.
  async function submitFinish() {
    setFinishing(true);
    let res: Response;
    try {
      res = await fetch(`/api/gallery/${galleryId}/finish`, { method: 'POST' });
    } catch {
      setFinishing(false);
      setActionError('אין חיבור לאינטרנט כרגע - נסי שוב כשהחיבור יחזור.');
      return;
    }
    setFinishing(false);

    if (!res.ok) {
      setActionError('שליחת הבחירה נכשלה, נסי שוב.');
      return;
    }

    setActionError('');
    setGalleryStatus('completed');
    setConfettiPieces(generateConfetti());
    setShowCelebration(true);
    setTimeout(() => setShowCelebration(false), 3500);
  }

  function handleFinish() {
    if (!window.confirm('לשלוח את הבחירה? אחרי זה לא ניתן יהיה לשנות אותה.')) return;
    setFinishCountdown(FINISH_UNDO_SECONDS);
  }

  function cancelFinish() {
    setFinishCountdown(null);
  }

  async function clearAllSelections() {
    if (!myParticipant || galleryStatus === 'completed') return;
    if (!window.confirm('לבטל את כל הבחירות שלך בגלריה הזו? אי אפשר לשחזר את זה.')) return;

    setClearingAll(true);
    let res: Response;
    try {
      res = await fetch(`/api/gallery/${galleryId}/selection`, { method: 'DELETE' });
    } catch {
      setClearingAll(false);
      setActionError('אין חיבור לאינטרנט כרגע - נסי שוב כשהחיבור יחזור.');
      return;
    }
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

  // ה-API כבר שמר את הסימונים בשרת (app/api/gallery/[id]/ai-picks) - כאן רק
  // מעדכנים את המסך המקומי לפי מה שחזר, בלי לקרוא שוב ל-setPhotoStatus (זה
  // היה שולח בקשת רשת נוספת לכל תמונה, מיותר כשהשרת כבר עשה את זה בבת אחת).
  async function handleAiPicks() {
    if (!myParticipant || galleryStatus === 'completed' || aiPicksRunning) return;

    setAiPicksRunning(true);
    setAiPicksMessage('');
    setActionError('');

    let res: Response;
    try {
      res = await fetch(`/api/gallery/${galleryId}/ai-picks`, { method: 'POST' });
    } catch {
      setAiPicksRunning(false);
      setActionError('אין חיבור לאינטרנט כרגע - נסי שוב כשהחיבור יחזור.');
      return;
    }
    setAiPicksRunning(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error ?? 'הניתוח נכשל, נסי שוב.');
      return;
    }

    const data = await res.json();
    (data.pickedPhotoIds ?? []).forEach((photoId: string) => {
      applyStatusChange(photoId, 'maybe', myMarks[photoId]?.status);
    });

    setAiPicksMessage(
      data.pickedCount > 0
        ? `סימנתי ${data.pickedCount} תמונות כ"אולי" מתוך ${data.analyzedCount} שנותחו - עדיין אפשר לשנות הכל`
        : 'לא מצאתי תמונות מובהקות לסמן - ייתכן שכבר סימנת את כולן'
    );
  }

  // אופטימי כמו setPhotoStatus - ההערה נשמרת מקומית מיד, ומסונכרנת מהתור אם
  // הייתה שגיאת רשת (לא שגיאת שרת אמיתית).
  async function saveNote() {
    if (!noteEditingId) return;
    const photoId = noteEditingId;
    const trimmed = noteDraft.trim();

    setMyMarks((prev) => {
      const existing = prev[photoId];
      if (!existing) return prev;
      return { ...prev, [photoId]: { ...existing, note: trimmed || null } };
    });
    setNoteEditingId(null);

    const result = await postAction({ type: 'note', photoId, note: trimmed });

    if (result === 'network-error') {
      enqueuePendingAction({ type: 'note', photoId, note: trimmed });
      setActionError('');
      return;
    }
    if (result === 'server-error') {
      setActionError('ההערה לא נשמרה, נסי שוב.');
      return;
    }
    setActionError('');
  }

  function toggleCompareSelect(photoId: string, e: React.SyntheticEvent) {
    e.stopPropagation();
    setCompareIds((prev) => {
      if (prev.includes(photoId)) return prev.filter((id) => id !== photoId);
      if (prev.length >= MAX_COMPARE) return [...prev.slice(1), photoId]; // מחליף את הישנה ביותר
      return [...prev, photoId];
    });
  }

  // בונה את תור התמונות למצב "בחירה מהירה" - סבב 1 עובר על כל התמונות (בסדר
  // הגלריה), סבב 2 מסנן רק לאלה שסומנו "אולי" בסבב הראשון.
  //
  // דילוג התחלתי על תמונות שכבר הוכרעו (findNextUnmarkedIndex) רלוונטי רק
  // לסבב 1 - למשל אם הלקוחה כבר סימנה כמה תמונות דרך הגריד הרגיל לפני
  // שנכנסה למצב הזה. בסבב 2 כל התמונות בתור כבר מסומנות "אולי" בהגדרה
  // (זה בדיוק הפילטר שבנה את התור) - אם נשתמש באותה בדיקה שם, כל תמונה
  // תיחשב "כבר הוכרעה" ומסך הסיכום יופיע מיד בלי להראות אף תמונה. לכן
  // הדילוג ההתחלתי רץ פעם אחת כאן (רק בסבב 1), ו-swipeCursor הוא מקור
  // האמת היחיד לאורך שאר הסבב - לא מחשבים findNextUnmarkedIndex מחדש
  // בהמשך, ראו handleSwipeAction/handleSwipeKeyDown/מסך התצוגה למטה.
  function startSwipeMode(pass: 1 | 2) {
    const queue = pass === 1
      ? photos.map((p) => p.id)
      : photos.filter((p) => myMarks[p.id]?.status === 'maybe').map((p) => p.id);
    const startIndex = pass === 1 ? findNextUnmarkedIndex(queue, 0, (id) => !!myMarks[id]?.status) : 0;
    setSwipeQueue(queue);
    setSwipeCursor(startIndex);
    setSwipePass(pass);
    setCompareMode(false); // לא לערבב שני מצבי תצוגה מלאה בו-זמנית
    setCompareIds([]);
    setSwipeMode(true);
  }

  function exitSwipeMode() {
    setSwipeMode(false);
  }

  // מפעילה את הפעולה על התמונה המוצגת כרגע ומתקדמת - swipeCursor הוא מקור
  // האמת (ראו הערה ב-startSwipeMode למעלה), לא findNextUnmarkedIndex מחדש.
  async function handleSwipeAction(status: 'maybe' | 'selected' | null) {
    if (swipeCursor >= swipeQueue.length) return;
    await setPhotoStatus(swipeQueue[swipeCursor], status);
    setSwipeCursor((prev) => prev + 1);
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

  // פותחת סקירה ברצף מההתחלה - סוגרת מצבים אחרים (הגדלה/השוואה) כדי שלא
  // תהיה חפיפה בין כמה שכבות מסך-מלא בו-זמנית.
  function openSlideshow() {
    setEnlargedId(null);
    setCompareMode(false);
    setCompareIds([]);
    setSlideshowIndex(0);
    setSlideshowActive(true);
  }

  function navigateSlideshow(delta: 1 | -1) {
    setSlideshowIndex((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= photos.length) return prev;
      return next;
    });
  }

  // מחזירה תמונה שכבר מסומנת באותו סטטוס למצב "לא מסומן" - כדי שאפשר יהיה
  // לבטל סימון בטעות בלי לצאת מהסליידשואו. אותה setPhotoStatus בדיוק כמו בגריד.
  function slideshowMarkStatus(photoId: string, status: 'maybe' | 'selected') {
    const current = myMarks[photoId]?.status;
    setPhotoStatus(photoId, current === status ? null : status);
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
  const totalEstimate = packageInfo ? packageInfo.basePrice + extraCost : 0;
  const progressPct = packageInfo && packageInfo.included > 0
    ? Math.min(100, Math.round((ownerSelectedCount / packageInfo.included) * 100))
    : 0;
  // סינון תצוגה בלבד ("הצג רק בחירות שלי") - לא נוגע בנתונים עצמם, רק
  // באיזה תת-קבוצה מוצגת בגריד. עוזר לסקור לפני "סיימתי לבחור" בגלריות גדולות.
  const visiblePhotos = viewFilter === 'all' ? photos : photos.filter((p) => myStatuses[p.id] === viewFilter);
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
            {expiresAt ? `, עד ${toHebrewDateString(new Date(expiresAt))}` : ''}.
          </p>
          <div
            style={{
              textAlign: 'right', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10,
              padding: '1rem 1.25rem', marginBottom: '1.5rem', fontSize: 13, color: theme.textMuted,
              display: 'flex', flexDirection: 'column', gap: '0.5rem',
            }}
          >
            <span>⇄ אפשר להשוות בין כמה תמונות זו לצד זו</span>
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
          <button
            onClick={() => (swipeMode ? exitSwipeMode() : startSwipeMode(1))}
            disabled={galleryStatus === 'completed' || photos.length === 0}
            style={{
              ...outlineButtonStyle, padding: '0.35rem 0.75rem', fontSize: 12,
              borderColor: swipeMode ? accent : theme.border, color: swipeMode ? accent : theme.textMuted,
              opacity: galleryStatus === 'completed' || photos.length === 0 ? 0.5 : 1,
            }}
          >
            {swipeMode ? '✕ צאי מבחירה מהירה' : '⚡ בחירה מהירה'}
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

      {(isOffline || pendingCount > 0) && (
        <div role="status" aria-live="polite" style={{ padding: '0.5rem 1.5rem', background: theme.warningBg, color: theme.warningText, fontSize: 13, textAlign: 'center' }}>
          {isOffline && '📴 אין חיבור לאינטרנט - '}
          {pendingCount > 0
            ? `${pendingCount} שינויים ממתינים ויישלחו אוטומטית כשהחיבור יחזור.`
            : 'אפשר להמשיך לדפדף ולבחור - הבחירות יישלחו כשהחיבור יחזור.'}
        </div>
      )}

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
        {packageInfo && packageInfo.basePrice > 0 && (
          <span>
            סה״כ משוער לחבילה: <b style={{ color: accent }}>{Math.round(totalEstimate)} ₪</b>
            {overIncluded > 0 && (
              <span style={{ color: theme.textFaint }}> ({Math.round(packageInfo.basePrice)} ₪ חבילה + {Math.round(extraCost)} ₪ תוספת)</span>
            )}
          </span>
        )}
        {expiresAt && (
          <span>
            ניתן לבחור עד <b style={{ color: theme.text }}>{toHebrewDateString(new Date(expiresAt))}</b>
          </span>
        )}
      </div>

      {/* מסגור חיובי/upsell ("קיבלת עוד") ולא אזהרה ("חרגת") - נשען על אותה
          אנרגיה כמו "סה״כ משוער לחבילה" בקופסה שמעל, כדי שהשתיים יקראו
          כסיפור מחיר אחד ועקבי ולא כשתי אזהרות נפרדות. */}
      {overIncluded > 0 && packageInfo && (
        <div
          style={{
            margin: '0.6rem 1.5rem 0', padding: '0.6rem 1rem', borderRadius: 8,
            background: `${accent}1f`, border: `1px solid ${accent}44`, color: accent, fontSize: 14,
          }}
        >
          ✨ בחרת {ownerSelectedCount} תמונות ({packageInfo.included} כלולות + {overIncluded} נוספות) · תוספת: {Math.round(extraCost)} ₪
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 12, color: theme.textFaint, padding: '0.5rem 1.5rem 0' }}>
        לחיצה ראשונה על תמונה = <span style={{ color: theme.green }}>אולי</span> · לחיצה שנייה = <span style={{ color: accent }}>נבחר</span> · לחיצה שלישית מבטלת
      </p>

      {actionError && (
        <div role="alert" style={{ padding: '0.5rem 1.5rem', background: theme.errorBg, color: theme.errorText, fontSize: 14 }}>
          {actionError}
        </div>
      )}

      {aiPicksMessage && (
        <div role="status" style={{ padding: '0.5rem 1.5rem', background: theme.successBg, color: theme.successText, fontSize: 14, textAlign: 'center' }}>
          {aiPicksMessage}
        </div>
      )}

      {/* מסך תודה - מוצג ברגע שהקונפטי דועך (showCelebration חוזר ל-false), כדי
          שלא יתחרה איתו על תשומת הלב. לא חוסם את הגלריה שמתחתיו - "אפשר עדיין
          לצפות בתמונות" נשאר תקף כרגיל, זה רק פאנל בזרימת העמוד. */}
      {galleryStatus === 'completed' && !showCelebration && (
        <div
          style={{
            margin: '1rem 1.5rem 0', padding: '1.75rem 1.5rem', borderRadius: 14,
            background: theme.panel, border: `1px solid ${theme.border}`, textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 1rem', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: photographerLogo ? theme.panelInput : `linear-gradient(135deg, ${accentSolid}, ${accent})`,
              border: `2px solid ${accent}`,
            }}
          >
            {photographerLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photographerLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 28 }}>💛</span>
            )}
          </div>
          <p style={{ fontSize: 22, fontFamily: theme.fontSerif, color: theme.text, marginBottom: '0.5rem' }}>
            תודה רבה{myParticipant?.displayName ? `, ${myParticipant.displayName}` : ''}!
          </p>
          <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.7, maxWidth: 420, margin: '0 auto' }}>
            הבחירה שלך התקבלה{photographerName ? ` אצל ${photographerName}` : ''} ✨ אין צורך לעשות עוד כלום -
            {' '}{photographerName ?? 'הצלמת'} כבר רואה את מה שבחרת, ותיצור איתך קשר להמשך.
          </p>
          <p style={{ color: theme.textFaint, fontSize: 12, marginTop: '1rem' }}>
            ✓ אפשר עדיין לצפות בתמונות למטה, אבל לא לשנות את הבחירה.
          </p>
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
            setCompareViewOpen(false);
          }}
          style={{ ...outlineButtonStyle, marginTop: '0.5rem' }}
        >
          {compareMode ? 'צאי ממצב השוואה' : `⇄ השוואה בין כמה תמונות`}
        </button>
        {compareMode && (
          <span style={{ marginRight: '0.5rem', fontSize: 13, color: theme.textMuted }}>
            בחרי עד {MAX_COMPARE} תמונות להשוואה ({compareIds.length}/{MAX_COMPARE})
          </span>
        )}
        {compareMode && compareIds.length >= 2 && (
          <button
            onClick={() => setCompareViewOpen(true)}
            style={{ ...primaryButtonStyle, marginTop: '0.5rem', marginRight: '0.5rem', padding: '0.5rem 1.1rem' }}
          >
            השוואה כעת ({compareIds.length})
          </button>
        )}

        {photos.length > 0 && (
          <button onClick={openSlideshow} style={{ ...outlineButtonStyle, marginTop: '0.5rem', marginRight: '0.5rem' }}>
            ▶ סקירה ברצף
          </button>
        )}

        {galleryStatus !== 'completed' && (mySelectedCount > 0 || maybeCount > 0) && (
          <button
            onClick={clearAllSelections}
            disabled={clearingAll}
            style={{ ...outlineButtonStyle, marginTop: '0.5rem', marginRight: '0.5rem', color: theme.errorText, opacity: clearingAll ? 0.6 : 1 }}
          >
            {clearingAll ? 'מבטלת...' : '🗑 ביטול כל הבחירה שלי'}
          </button>
        )}

        {galleryStatus !== 'completed' && photos.length > 0 && (
          <button
            onClick={handleAiPicks}
            disabled={aiPicksRunning}
            title="Claude מנתחת עד 60 תמונות ומסמנת 'אולי' על הטובות ביותר - נקודת פתיחה, לא בחירה סופית"
            style={{ ...outlineButtonStyle, marginTop: '0.5rem', marginRight: '0.5rem', borderColor: theme.gold, color: theme.gold, opacity: aiPicksRunning ? 0.6 : 1 }}
          >
            {aiPicksRunning ? 'מנתחת תמונות...' : '🪄 עזרי לי לבחור'}
          </button>
        )}

        {galleryStatus !== 'completed' && isOwner && finishCountdown !== null && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
              margin: '0.75rem auto 0', padding: '0.75rem 1rem', maxWidth: 340,
              background: theme.successBg, color: theme.successText, borderRadius: 8,
            }}
          >
            <span>הבחירה תישלח בעוד {finishCountdown} שניות...</span>
            <button onClick={cancelFinish} style={{ ...outlineButtonStyle, padding: '0.4rem 1rem' }}>
              ביטול שליחה
            </button>
          </div>
        )}

        {galleryStatus !== 'completed' && isOwner && finishCountdown === null && (
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

      {compareMode && compareViewOpen && compareIds.length >= 2 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="השוואת תמונות"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 50,
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem',
          }}
          onClick={() => setCompareViewOpen(false)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCompareMode(false);
              setCompareIds([]);
              setCompareViewOpen(false);
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
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
                  maxWidth: `${Math.min(45, Math.floor(88 / compareIds.length))}%`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.fullUrl}
                  alt=""
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    maxHeight: compareIds.length > 2 ? '45vh' : '80vh', maxWidth: '100%', objectFit: 'contain', borderRadius: 6,
                    WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                  }}
                />
                {galleryStatus !== 'completed' && myParticipant && (
                  <button
                    onClick={async () => {
                      await setPhotoStatus(id, 'selected');
                      setCompareMode(false);
                      setCompareIds([]);
                      setCompareViewOpen(false);
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

      {swipeMode && (() => {
        const idx = swipeCursor;
        const total = swipeQueue.length;
        const done = idx >= total;

        if (done) {
          const isSecondPass = swipePass === 2;
          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="סיכום בחירה מהירה"
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 60,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '2rem', textAlign: 'center', gap: '1.1rem',
              }}
            >
              <p style={{ fontSize: 40, margin: 0 }}>🎉</p>
              <p style={{ fontSize: 22, fontFamily: theme.fontSerif, color: '#fff', margin: 0 }}>
                {isSecondPass ? 'סיימת גם את הסבב השני!' : 'עברת על כל התמונות!'}
              </p>
              {!isSecondPass && maybeCount > 0 && (
                <>
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, maxWidth: 320, margin: 0 }}>
                    סימנת {maybeCount} תמונות כ"אולי" - רוצה לעבור עליהן שוב ולהחליט סופית?
                  </p>
                  <button onClick={() => startSwipeMode(2)} style={{ ...primaryButtonStyle, minWidth: 240 }}>
                    כן, סבב שני על "אולי" ({maybeCount})
                  </button>
                </>
              )}
              <button
                onClick={exitSwipeMode}
                style={{ ...outlineButtonStyle, minWidth: 240, color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
              >
                {!isSecondPass && maybeCount > 0 ? 'לא תודה, סיימתי' : 'סגירה'}
              </button>
            </div>
          );
        }

        const photo = photos.find((p) => p.id === swipeQueue[idx]);
        if (!photo) return null;

        const swipeActionBtn = (bg: string, border: string) => ({
          width: 68, height: 68, borderRadius: '50%', fontSize: 30, cursor: 'pointer',
          background: bg, border: `1px solid ${border}`,
        });

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`בחירה מהירה: תמונה ${idx + 1} מתוך ${total}`}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 60,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
              padding: '1.1rem 1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 480 }}>
              <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>
                {swipePass === 2 ? 'סבב שני · "אולי" · ' : 'בחירה מהירה · '}{idx + 1}/{total}
              </span>
              <button
                onClick={exitSwipeMode}
                title="סגירה"
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 16, cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.fullUrl ?? photo.thumbnailUrl ?? ''}
                alt=""
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', borderRadius: 8,
                  WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => handleSwipeAction(null)} aria-label="דילוג, בלי סימון" style={swipeActionBtn('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.3)')}>
                  👎
                </button>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>דילוג</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => handleSwipeAction('maybe')} aria-label="סמני כאולי" style={swipeActionBtn(`${theme.green}33`, theme.green)}>
                  🤔
                </button>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>אולי</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => handleSwipeAction('selected')} aria-label="בחרי תמונה זו" style={swipeActionBtn(`${accent}33`, accent)}>
                  👍
                </button>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>בחרתי</span>
              </div>
            </div>
          </div>
        );
      })()}

      {enlargedId && (() => {
        const photo = photos.find((p) => p.id === enlargedId);
        if (!photo?.fullUrl) return null;
        const currentIndex = photos.findIndex((p) => p.id === enlargedId);
        const hasPrev = currentIndex > 0;
        const hasNext = currentIndex < photos.length - 1;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`תצוגה מוגדלת: ${photo.original_filename}`}
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
              alt={photo.original_filename}
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

      {slideshowActive && photos.length > 0 && (() => {
        const total = photos.length;
        const currentIndex = Math.min(slideshowIndex, total - 1);
        const photo = photos[currentIndex];
        const status = myStatuses[photo.id];
        const hasPrev = currentIndex > 0;
        const hasNext = currentIndex < total - 1;

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`סקירה ברצף: תמונה ${currentIndex + 1} מתוך ${total}`}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 55,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem',
            }}
            onClick={() => setSlideshowActive(false)}
          >
            {/* יציאה זמינה תמיד מכל תמונה בסליידשואו - זו לא אמורה להיות
                חוויה כפויה, הלקוחה יכולה לצאת באמצע בלי לעבור על הכל. */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSlideshowActive(false);
              }}
              title="יציאה ממצב סקירה"
              style={{
                position: 'absolute', top: 16, insetInlineEnd: 16, zIndex: 57,
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.5rem 1rem', borderRadius: 20, border: '1px solid rgba(255,255,255,0.4)',
                background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 14, cursor: 'pointer',
              }}
            >
              ✕ יציאה
            </button>

            <div
              style={{
                position: 'absolute', top: 16, insetInlineStart: 16, zIndex: 57,
                background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 13,
                padding: '4px 12px', borderRadius: 12,
              }}
            >
              {currentIndex + 1} / {total}
            </div>

            {hasPrev && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateSlideshow(-1);
                }}
                title="הקודמת"
                style={{
                  position: 'absolute', top: '50%', insetInlineStart: 16, transform: 'translateY(-50%)', zIndex: 56,
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
                  navigateSlideshow(1);
                }}
                title="הבאה"
                style={{
                  position: 'absolute', top: '50%', insetInlineEnd: 16, transform: 'translateY(-50%)', zIndex: 56,
                  width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 20, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ›
              </button>
            )}

            {photo.fullUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.fullUrl}
                alt={photo.original_filename}
                draggable={false}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  maxHeight: '75vh', maxWidth: '90vw', objectFit: 'contain', borderRadius: 6,
                  WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                }}
              />
            ) : (
              <p style={{ color: theme.textMuted }} onClick={(e) => e.stopPropagation()}>
                אין תצוגה זמינה לתמונה הזו
              </p>
            )}

            {galleryStatus !== 'completed' && myParticipant ? (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}
              >
                <button
                  onClick={() => slideshowMarkStatus(photo.id, 'maybe')}
                  style={{
                    ...outlineButtonStyle, padding: '0.5rem 1.25rem',
                    borderColor: status === 'maybe' ? theme.green : theme.border,
                    color: status === 'maybe' ? theme.green : theme.textMuted,
                  }}
                >
                  {status === 'maybe' ? '✓ אולי' : '? אולי'}
                </button>
                <button
                  onClick={() => slideshowMarkStatus(photo.id, 'selected')}
                  style={{
                    ...primaryButtonStyle, padding: '0.5rem 1.25rem',
                    opacity: status === 'selected' ? 1 : 0.85,
                  }}
                >
                  {status === 'selected' ? '✓ נבחרה' : '✓ בחירה'}
                </button>
              </div>
            ) : (
              <p style={{ color: theme.textFaint, fontSize: 13, marginTop: '1.5rem' }} onClick={(e) => e.stopPropagation()}>
                הבחירה כבר נשלחה - אפשר לצפות בלבד.
              </p>
            )}
          </div>
        );
      })()}

      {showCelebration && (
        <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none', overflow: 'hidden' }}>
          <style>{`
            @keyframes confetti-fall {
              0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
              100% { transform: translateY(110vh) rotate(720deg); opacity: 0.9; }
            }
          `}</style>
          {confettiPieces.map((p) => (
            <div
              key={p.id}
              style={{
                position: 'absolute', top: 0, left: `${p.left}%`,
                width: p.size, height: p.size * 0.4, background: p.color, borderRadius: 2,
                animation: `confetti-fall ${p.duration}s linear ${p.delay}s forwards`,
              }}
            />
          ))}
          <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', width: '90%', maxWidth: 340 }}>
            <p
              style={{
                fontSize: 20, fontFamily: theme.fontSerif, color: theme.text, background: 'rgba(15,22,38,0.9)',
                padding: '1rem 1.5rem', borderRadius: 12, border: `1px solid ${theme.border}`, margin: 0,
              }}
            >
              🎉 סיימת! הצלמת שלך כבר מקבלת עדכון
            </p>
          </div>
        </div>
      )}

      {noteEditingId && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setNoteEditingId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-dialog-title"
            onClick={(e) => e.stopPropagation()}
            style={{ background: theme.panel, color: theme.text, padding: '1.25rem', borderRadius: 10, width: 320, border: `1px solid ${theme.border}` }}
          >
            <label htmlFor="note-text" id="note-dialog-title" style={{ display: 'block', fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.75rem' }}>
              הערה לתמונה
            </label>
            <textarea
              id="note-text"
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

      <div style={{ display: 'flex', gap: '0.5rem', padding: '0 1.5rem 0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        {([
          { key: 'all' as const, label: `הכל (${photos.length})` },
          { key: 'selected' as const, label: `נבחרו (${mySelectedCount})` },
          { key: 'maybe' as const, label: `אולי (${maybeCount})` },
        ]).map((f) => (
          <button
            key={f.key}
            onClick={() => setViewFilter(f.key)}
            style={{
              ...outlineButtonStyle, padding: '0.3rem 0.9rem', fontSize: 12,
              borderColor: viewFilter === f.key ? accent : theme.border,
              color: viewFilter === f.key ? accent : theme.textMuted,
              background: viewFilter === f.key ? `${accent}22` : 'transparent',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visiblePhotos.length === 0 && (
        <p style={{ textAlign: 'center', color: theme.textFaint, fontSize: 13, padding: '1rem' }}>
          אין תמונות להצגה בסינון הזה.
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          alignItems: 'start',
          gap: '1rem',
          padding: '0 1.5rem 1.5rem',
        }}
      >
        {visiblePhotos.map((photo) => {
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

          // תיאור נגיש למקלדת/קורא מסך - אותה פעולה שקורה בקליק עכבר, כדי
          // שבחירת תמונות תהיה אפשרית גם בלי עכבר (לא רק אלמנטים עם onClick).
          const statusLabel = status === 'selected' ? 'נבחרה' : status === 'maybe' ? 'מסומנת כאולי' : 'לא מסומנת';
          const cardActionLabel = compareMode
            ? `${photo.original_filename}, ${isComparing ? 'נבחרה להשוואה' : 'לא נבחרה להשוואה'}`
            : `${photo.original_filename}, ${statusLabel}`;

          function handleCardKeyDown(e: React.KeyboardEvent) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (compareMode) toggleCompareSelect(photo.id, e);
            else cycleStatus(photo.id);
          }

          return (
            <div
              key={photo.id}
              role="button"
              tabIndex={0}
              aria-pressed={compareMode ? isComparing : status === 'selected'}
              aria-label={cardActionLabel}
              onClick={(e) => (compareMode ? toggleCompareSelect(photo.id, e) : cycleStatus(photo.id))}
              onKeyDown={handleCardKeyDown}
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
                  role="button"
                  tabIndex={0}
                  aria-label={`${statusLabel} - לחיצה תעבור לסטטוס הבא`}
                  onClick={(e) => {
                    e.stopPropagation();
                    cycleStatus(photo.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
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
                alt={`${photo.original_filename} - ${statusLabel}`}
                draggable={false}
                style={{
                  width: '100%', height: 'auto', display: 'block', pointerEvents: 'none',
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
