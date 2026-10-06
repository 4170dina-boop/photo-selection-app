'use client';

import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { theme, inputStyle, goldButtonStyle, outlineButtonStyle } from '@/lib/theme';
import { computePackageUsage } from '@/lib/gifts';
import ExtensionCountdownBanner from '@/components/ExtensionCountdownBanner';
import GiftCollage from '@/components/GiftCollage';
import ClientProgressTracker, { DELIVERED_SECTION_ID } from '@/components/ClientProgressTracker';
import ClientPayButton from '@/components/ClientPayButton';
import { resolveClientPriceDisplay, type ClientPackageInfo } from '@/lib/clientPricing';
import GalleryNavBar, { BurstBadge, BurstChooser } from '@/components/GalleryNavBar';
import { applyNavFilters, burstMembers } from '@/lib/galleryNav';
import type { Chapter } from '@/lib/chapters';
import LanguagePicker from '@/components/LanguagePicker';
import GalleryMoreMenu, { type MoreMenuItem } from '@/components/GalleryMoreMenu';
import { useNotify, NotifyHost } from '@/components/useNotify';
import GallerySkeleton from '@/components/GallerySkeleton';
import {
  type Lang,
  type MessageKey,
  type MessageParams,
  t as translate,
  resolveMessage,
  interpolateParts,
  langDir,
  arrowNavDelta,
  swipeNavDeltaForLang,
  formatGalleryDate,
  formatCurrency,
  localizeServerError,
  localizedErrorFromBody,
  resolveInitialLang,
  loadStoredLang,
  saveStoredLang,
  browserLanguages,
} from '@/lib/i18n';
import {
  type PendingAction,
  NOTE_MAX_LENGTH,
  enqueueAction,
  dropActionsAfterDirectSuccess,
  reconcileQueueAfterFlush,
  applyPendingToMarks,
  queueHasPhoto,
  planSwipeTap,
  uniqueFileName,
  normalizeAccessCode,
  isGalleryDataStale,
  toggleStatusTo,
  shouldAutoAdvance,
  enlargedShortcutStatus,
  neighborPrefetchUrls,
  type GridCols,
  DEFAULT_GRID_COLS,
  GRID_COLS_KEY,
  parseGridCols,
  nextGridCols,
} from '@/lib/galleryClient';
import { extractAccessCode } from '@/lib/accessCodePaste';
import {
  computeTogetherFilters,
  photoIdsForTogetherFilter,
  onlyParticipantKey,
  mergeOthersMarks,
  newMarksByOthers,
  marksPollDelay,
  MARKS_POLL_MS,
  othersWhoSelected,
} from '@/lib/choosingTogether';
import {
  type ResumeState,
  crossedIncludedQuota,
  extraPriceToastKey,
  computeFinishSummary,
  focusTrapIndex,
  emptyResumeState,
  parseResumeState,
  recordPhotoView,
  resumeOffer as computeResumeOffer,
  resumeStateKey,
  viewedProgress,
} from '@/lib/galleryReview';
import { normalizeGender, type Gender, type ViewerGender } from '@/lib/gender';

interface GalleryPageProps {
  params: { id: string };
}

interface GalleryPhoto {
  id: string;
  thumbnailUrl: string | null;
  fullUrl: string | null;
  original_filename: string;
  possiblyBlurry: boolean;
  // תמונת מתנה מהצלמת (lib/gifts.ts) - כלולה אוטומטית, לא נבחרת ולא נספרת במכסה
  isGift?: boolean;
  giftMessage?: string | null;
  // פרק (gallery_chapters) ורצף תמונות דומות (lib/bursts.ts) - ראו components/GalleryNavBar.tsx
  chapterId?: string | null;
  burstId?: string | null;
}

interface DeliveredPhoto {
  id: string;
  url: string | null;
  filename: string;
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

// "אני רוצה את זו" בתצוגה המוגדלת -> רגע קצר לראות שהסימון נקלט, ואז
// מעבר אוטומטי לתמונה הבאה.
const AUTO_ADVANCE_MS = 300;

// טקסט לקוראי מסך בלבד (למשל תיאור קיצורי המקלדת בתצוגה המוגדלת)
const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

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
// תוכל להמשיך לדפדף ולבחור בלי לחכות לתשובת שרת על כל קליק. הלוגיקה הטהורה
// (מיזוג/סדר/ניקוי) ב-lib/galleryClient.ts.
function pendingQueueKey(galleryId: string, participantId: string): string {
  return `gallery_pending_${galleryId}_${participantId}`;
}

function loadPendingQueue(galleryId: string, participantId: string): PendingAction[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingQueueKey(galleryId, participantId)) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingQueue(galleryId: string, participantId: string, queue: PendingAction[]) {
  try {
    if (queue.length === 0) localStorage.removeItem(pendingQueueKey(galleryId, participantId));
    else localStorage.setItem(pendingQueueKey(galleryId, participantId), JSON.stringify(queue));
  } catch {
    // אחסון חסום/מלא - אין מה לעשות מעבר לזה
  }
}

// מעביר את הפוקוס לתוך חלון מודאלי כשהוא נפתח, ומחזיר אותו לאלמנט שהיה
// בפוקוס לפני כן כשהוא נסגר (נגישות מקלדת/קורא מסך).
function useModalFocus(open: boolean, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
    return () => {
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open, ref]);
}

// תמונה שעוד לא עובדה (אין גרסה מוקטנת/עם סימן מים) - placeholder ניטרלי,
// אף פעם לא המקור.
function ProcessingPlaceholder({ height, lang }: { height?: number | string; lang: Lang }) {
  return (
    <div
      role="img"
      aria-label={translate(lang, 'common.processingAria')}
      style={{
        width: '100%', height: height ?? undefined, aspectRatio: height ? undefined : '4 / 3',
        background: theme.panelInput, color: theme.textFaint, fontSize: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {translate(lang, 'common.processing')}
    </div>
  );
}

// יעד הספירה לאחור של "סיימתי לבחור" (ראו FINISH_UNDO_SECONDS למעלה), נשמר
// כ-timestamp מוחלט (Date.now() + 60s) ולא כמונה טיקים - דפדפני מובייל מקפיאים
// setTimeout/setInterval בטאב שברקע, אז אם מסתמכים על ספירת טיקים הספירה פשוט
// נתקעת והבחירה אף פעם לא נשלחת בפועל (ראו הערה מפורטת יותר ליד useEffect
// שמשתמש בזה). ה-timestamp המוחלט מאפשר לחשב את הזמן הנותר מול השעון האמיתי
// בכל רגע - גם אחרי שהטאב חזר מהשהיה, וגם בטעינה חדשה לגמרי (טאב שנסגר
// לגמרי וטעינה מחדש ימים אחר כך).
function finishDeadlineKey(galleryId: string, participantId: string): string {
  return `gallery_finish_deadline_${galleryId}_${participantId}`;
}

function loadFinishDeadline(galleryId: string, participantId: string): number | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(finishDeadlineKey(galleryId, participantId));
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function saveFinishDeadline(galleryId: string, participantId: string, deadline: number) {
  localStorage.setItem(finishDeadlineKey(galleryId, participantId), String(deadline));
}

function clearFinishDeadline(galleryId: string, participantId: string) {
  localStorage.removeItem(finishDeadlineKey(galleryId, participantId));
}

// "להמשיך מאיפה שעצרתי" (lib/galleryReview.ts) - נוחות תצוגה בלבד, לכן
// אחסון חסום/מלא פשוט מתעלמים ממנו.
function loadResumeState(galleryId: string, participantId: string): ResumeState {
  try {
    return parseResumeState(localStorage.getItem(resumeStateKey(galleryId, participantId)));
  } catch {
    return emptyResumeState();
  }
}

function saveResumeState(galleryId: string, participantId: string, state: ResumeState) {
  try {
    localStorage.setItem(resumeStateKey(galleryId, participantId), JSON.stringify(state));
  } catch {}
}

// לשון הפנייה האחרונה שידועה לדפדפן הזה בגלריה הזו (lib/gender.ts) - כדי
// שגם מסך קוד הגישה (לפני שהשרת יודע מי נכנס/ה) יפנה נכון בכניסה חוזרת.
// נוחות תצוגה בלבד; מקור האמת הוא viewerGender מה-API.
function viewerGenderKey(galleryId: string): string {
  return `gallery_viewer_gender_${galleryId}`;
}

function loadViewerGender(galleryId: string): ViewerGender {
  try {
    return normalizeGender(localStorage.getItem(viewerGenderKey(galleryId)));
  } catch {
    return null;
  }
}

function saveViewerGender(galleryId: string, gender: ViewerGender) {
  try {
    if (gender) localStorage.setItem(viewerGenderKey(galleryId), gender);
    else localStorage.removeItem(viewerGenderKey(galleryId));
  } catch {}
}

// הודעת ברירת מחדל לכשל באימות קוד, לפי סטטוס (כמו accessCodeFallbackError
// ב-lib/galleryClient.ts, אבל כמפתח מילון)
function accessCodeFallbackKey(status: number): MessageKey {
  if (status === 429) return 'code.tooMany';
  if (status === 503) return 'code.unavailable';
  if (status === 401) return 'code.wrong';
  if (status === 410) return 'err.galleryExpired';
  return 'code.authFailed';
}

// גלילה עדינה - בלי אנימציה למי שביקשה להפחית תנועה
function scrollBehavior(): ScrollBehavior {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'auto';
  }
}

// כפתורים/שדות שאפשר להגיע אליהם ב-Tab בתוך חלון (למלכודת הפוקוס בחלון הסיכום)
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// כמה זמן ההודעה הקופצת על מחיר תמונה נוספת נשארת על המסך
const EXTRA_PRICE_TOAST_MS = 6000;

export default function GalleryPage({ params }: GalleryPageProps) {
  const galleryId = params.id;

  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [deliveredPhotos, setDeliveredPhotos] = useState<DeliveredPhoto[]>([]);
  const [showReveal, setShowReveal] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [myMarks, setMyMarks] = useState<Record<string, { status: 'maybe' | 'selected'; note: string | null; photographerReply: string | null }>>({});
  const [allMarks, setAllMarks] = useState<Record<string, Mark[]>>({});
  const [packageInfo, setPackageInfo] = useState<ClientPackageInfo | null>(null);
  const [ownerSelectedCount, setOwnerSelectedCount] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [galleryStatus, setGalleryStatus] = useState<string>('sent');
  // null = נעולה כרגיל אחרי "סיימתי לבחור". לא-null = הצלמת פתחה מחדש
  // (app/api/galleries/[id]/reopen-selection) בלי לשנות את galleryStatus
  // עצמו - ראו isLocked למטה, שהוא מה שבפועל קובע אם הבחירה פתוחה לעריכה.
  const [reopenedForSelectionAt, setReopenedForSelectionAt] = useState<string | null>(null);
  // המצב שבאמת קובע אם הבחירה פתוחה לעריכה - לא galleryStatus === 'completed'
  // לבדו, כי הצלמת יכולה לפתוח מחדש (reopenedForSelectionAt) בלי שהסטטוס
  // עצמו משתנה. כל המקומות למטה שבעבר בדקו galleryStatus === 'completed' כדי
  // לנעול עריכה עברו ל-isLocked/!isLocked.
  // readOnly (מה-API): תקופת הבחירה הסתיימה, אבל יש תמונות שנמסרו / הגלריה
  // הושלמה - מציגים צפייה והורדות בלבד, בלי שום פקד בחירה.
  const [readOnly, setReadOnly] = useState(false);
  const isLocked = readOnly || (galleryStatus === 'completed' && !reopenedForSelectionAt);
  const [finishing, setFinishing] = useState(false);
  // שליחת "סיימתי" נכשלה (שרת/רשת/שינויים שלא סונכרנו) - מציגים כפתור "נסי שוב"
  const [finishFailed, setFinishFailed] = useState(false);
  const [finishCountdown, setFinishCountdown] = useState<number | null>(null);
  // ה-timestamp המוחלט שממנו finishCountdown מחושב בכל טיק (ראו finishDeadlineKey
  // למעלה, וה-useEffect שמאזין לזה למטה) - null כשאין ספירה פעילה.
  const [finishDeadline, setFinishDeadline] = useState<number | null>(null);
  // מונע שליחת finish כפולה במקביל (למשל אם הטיימר הגיע בדיוק ל-0 באותו רגע
  // שהטאב חוזר לפוקוס ו-visibilitychange גם מנסה לתפוס פספוס) - ref ולא state
  // כי הבדיקה חייבת להיות מיידית וסינכרונית, בלי לחכות לרינדור מחדש.
  const finishInFlightRef = useRef(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const [clearingAll, setClearingAll] = useState(false);
  const [aiPicksRunning, setAiPicksRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [photographerName, setPhotographerName] = useState<string | null>(null);
  const [photographerLogo, setPhotographerLogo] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);

  // לשון הפנייה לצופה (lib/gender.ts): בעלים -> galleries.client_gender,
  // אורח/ת -> מה שבחר/ה בהצטרפות, null = לא ידוע -> צורה ניטרלית ("בחר/י").
  const [viewerGender, setViewerGender] = useState<ViewerGender>(null);
  // הבעלים בגוף שלישי ("רק X יכולה לסיים") - גם כשהצופה הוא/היא אורח/ת
  const [ownerGender, setOwnerGender] = useState<Gender>('f');
  useEffect(() => {
    setViewerGender(loadViewerGender(galleryId));
  }, [galleryId]);

  // שפת התצוגה (lib/i18n): בחירה שמורה בבורר > שפת הגלריה (galleries.language,
  // מגיעה מה-API גם במסך הקוד) > שפת הדפדפן > עברית. dir מוחל רק על שורש הגלריה.
  const [lang, setLang] = useState<Lang>('he');
  // הלקוח/ה בחר/ה שפה בבורר (או שיש בחירה שמורה) - שפת הגלריה מהשרת לא דורסת
  const userChoseLangRef = useRef(false);
  useEffect(() => {
    const stored = loadStoredLang(galleryId);
    userChoseLangRef.current = stored !== null;
    setLang(resolveInitialLang({ stored, browserLangs: browserLanguages() }));
  }, [galleryId]);
  function applyGalleryLanguage(serverLang: unknown) {
    if (userChoseLangRef.current) return;
    setLang(resolveInitialLang({ galleryLang: serverLang, browserLangs: browserLanguages() }));
  }
  function changeLang(next: Lang) {
    userChoseLangRef.current = true;
    setLang(next);
    saveStoredLang(galleryId, next);
  }
  const dir = langDir(lang);
  // tr('err.loadFailed') - לפי הצופה הנוכחי/ת; trOwner - לפי מגדר הבעלים
  // (טקסטים בגוף שלישי, "רק X יכולה לסיים"); trG - מגדר מפורש.
  const tr = (key: MessageKey, params?: MessageParams) => translate(lang, key, params, viewerGender);

  // "רגע החשיפה" - בפעם הראשונה שהלקוחה נכנסת אחרי שהתמונות הסופיות נמסרו.
  // נשמר לפי גלריה בדפדפן; אם האחסון חסום פשוט לא מציגים (עדיף מלהציג בכל כניסה).
  useEffect(() => {
    if (deliveredPhotos.length === 0) return;
    try {
      const key = `gallery_reveal_seen_${galleryId}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
      setShowReveal(true);
    } catch {
      // אחסון חסום - מדלגים
    }
  }, [deliveredPhotos.length, galleryId]);

  function closeReveal() {
    setShowReveal(false);
    document.getElementById(DELIVERED_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const trOwner = (key: MessageKey, params?: MessageParams) => translate(lang, key, params, ownerGender);
  const trG = (gender: ViewerGender, key: MessageKey, params?: MessageParams) => translate(lang, key, params, gender);
  // כמו tr, אבל פרמטרים יכולים להיות אלמנטים (מספר מודגש, <bdi> וכו')
  const rich = (key: MessageKey, params: Record<string, React.ReactNode>, count?: number) =>
    interpolateParts<React.ReactNode>(resolveMessage(lang, key, viewerGender, count), params as Record<string, React.ReactNode | string | number>).map(
      (part, i) => <React.Fragment key={i}>{part}</React.Fragment>
    );
  const money = (amount: number) => formatCurrency(lang, amount);
  const dateText = (iso: string) => formatGalleryDate(lang, iso);
  // "בעלים" ברירת מחדל ("הלקוחה הראשית") כשאין שם
  const ownerLabel = (name: string | undefined) => name ?? trOwner('common.ownerFallback');

  // הודעות חולפות מאוחדות (components/useNotify.tsx) - שגיאות פעולה, הורדות,
  // סימונים של בני משפחה, מחיר תמונה נוספת, "בטל" אחרי הסרת סימון.
  const notifier = useNotify();
  const { notify, dismissKey } = notifier;
  // גרסה עדכנית של פונקציות שנקראות מכפתור בהודעה ("בטל"/"נסי שוב") או מסקר
  // ברקע - ההודעה נשארת על המסך כמה שניות, וסגירה (closure) מהרינדור שבו
  // נוצרה הייתה רואה myMarks/שפה ישנים. מתעדכן בכל רינדור (למטה, לפני ה-return).
  const liveRef = useRef<{
    tr: typeof tr;
    setPhotoStatus: (photoId: string, next: 'maybe' | 'selected' | null, options?: { silentUndo?: boolean }) => Promise<void>;
    loadGallery: () => Promise<any | null>;
    downloadDelivered: (photo: DeliveredPhoto) => Promise<void>;
    downloadAllDelivered: () => Promise<void>;
    clearAllSelections: (skipConfirm?: boolean) => Promise<void>;
    aiPicks: () => Promise<void>;
  } | null>(null);
  // שגיאת פעולה אחת בכל רגע (key משותף - חדשה מחליפה ישנה), עם "נסי שוב"
  // כשהפעולה ניתנת לניסיון חוזר
  const ACTION_ERROR_KEY = 'action-error';
  function notifyError(message: string, retry?: () => void) {
    notify({
      type: 'error',
      message,
      key: ACTION_ERROR_KEY,
      action: retry ? { label: tr('notify.retry'), run: retry } : undefined,
    });
  }
  function clearActionError() {
    dismissKey(ACTION_ERROR_KEY);
  }

  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // 'all' | 'selected' | 'maybe', או סינון "בוחרים ביחד" (lib/choosingTogether.ts):
  // 'together' | 'onlyMe' | 'only:<participantId>'
  const [viewFilter, setViewFilter] = useState<string>('all');
  // ניווט בגלריות גדולות (components/GalleryNavBar.tsx): פרק נבחר, "הסתרת הדומות",
  // וחלון בחירה מתוך רצף תמונות דומות (burstId פתוח)
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [hideSimilar, setHideSimilar] = useState(false);
  const [burstChooserId, setBurstChooserId] = useState<string | null>(null);
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
  // ref מקביל ל-swipeCursor - הקשות מהירות רצופות קוראות אותו לפני רינדור מחדש
  const swipeCursorRef = useRef(0);
  // תמונות שבקשת סימון עליהן מ"בחירה מהירה" עדיין בדרך
  const swipeInFlightRef = useRef<Set<string>>(new Set());
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const enlargedImgRef = useRef<HTMLImageElement | null>(null);
  // מעבר אוטומטי ממתין אחרי "אני רוצה את זו" - מתבטל בכל ניווט/סגירה
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // תחילת מגע באצבע אחת בתצוגה המוגדלת (להחלקה ימינה/שמאלה); null = לא
  // החלקה (למשל צביטה בשתי אצבעות)
  const enlargedSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  // מתי בוצעה החלקה לאחרונה - כדי שקליק "רפאים" אחריה לא יסגור את התצוגה
  const enlargedLastSwipeAtRef = useRef(0);

  // מניעת flush כפול במקביל (interval + online + קריאה ידנית)
  const flushInFlightRef = useRef(false);
  // פעולה נכנסה לתור בזמן flush - להריץ עוד סבב בסופו
  const flushAgainRef = useRef(false);
  // מתי נתוני הגלריה (וה-URLs החתומים, תוקף שעה) נטענו לאחרונה
  const lastFetchedAtRef = useRef<number | null>(null);
  // הסימונים (של כולם) כפי שהשרת החזיר בפעם האחרונה - בסיס להשוואה "מה חדש"
  // אצל האחרים בסקר החי (newMarksByOthers)
  const othersMarksBaselineRef = useRef<Record<string, Mark[]> | null>(null);
  // רענון ברקע אחד בכל רגע + ניסיון אחד בלבד לכל תמונה שנכשלה בטעינה
  const silentRefreshRef = useRef<Promise<any> | null>(null);
  const imgErrorRetriedRef = useRef<Set<string>>(new Set());

  const enlargedDialogRef = useRef<HTMLDivElement>(null);
  const slideshowDialogRef = useRef<HTMLDivElement>(null);
  const swipeDialogRef = useRef<HTMLDivElement>(null);
  const compareDialogRef = useRef<HTMLDivElement>(null);
  const noteDialogRef = useRef<HTMLDivElement>(null);

  // מצב סקירה ברצף (סליידשואו) - עמדה נפרדת לגמרי ממצב ההגדלה (enlargedId):
  // דפדוף לפי סדר photos, לא לפי enlargedId, כדי שאפשר יהיה להשאיר את
  // ההגדלה הרגילה בלי שינוי.
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowIndex, setSlideshowIndex] = useState(0);

  // טעינה מוקדמת של התצוגה הגדולה של התמונה הבאה/הקודמת בתצוגה המוגדלת
  // ובסליידשואו - הגריד טוען רק את תמונות הגריד הקטנות, אז בלי זה כל מעבר
  // מחכה להורדה מלאה (במיוחד ברשת סלולרית חלשה). new Image() נכנס ל-cache
  // של הדפדפן, וה-<img> המוגדל משתמש באותו URL חתום בדיוק.
  const prefetchCurrentId = slideshowActive ? photos[slideshowIndex]?.id ?? null : enlargedId;
  useEffect(() => {
    neighborPrefetchUrls(photos, prefetchCurrentId).forEach((url) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    });
  }, [photos, prefetchCurrentId]);

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
  // RTL: כפתור "הבאה" משמאל, אז חץ שמאלה = הבאה (rtlArrowDelta).
  // S = "אני רוצה את זו", M = "אולי" (enlargedShortcutStatus) - אותם כפתורים
  // כמו בפס התחתון. myMarks/isLocked בתלויות כדי שהמתג יקרא את הסטטוס העדכני.
  useEffect(() => {
    if (!enlargedId) return;

    function handleKeyDown(e: KeyboardEvent) {
      // חלון ההערה פתוח מעל התצוגה המוגדלת - הקלדה בתיבה (S/M/חצים) לא
      // אמורה לסמן או לדפדף, ו-Escape סוגר רק את חלון ההערה.
      if (noteEditingId) return;
      const delta = arrowNavDelta(e.key, lang);
      if (delta !== 0) {
        navigateEnlarged(delta);
        return;
      }
      if (e.key === 'Escape') {
        setEnlargedId(null);
        return;
      }
      const target = enlargedShortcutStatus(e);
      if (target && enlargedId) {
        e.preventDefault();
        markEnlarged(enlargedId, target);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enlargedId, myMarks, isLocked, photos, noteEditingId, lang]);

  // כל ניווט/סגירה של התצוגה המוגדלת מבטל מעבר אוטומטי שעוד ממתין
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [enlargedId]);

  // ניווט וסגירה במקלדת במצב סקירה ברצף - מאזין נפרד מזה של ההגדלה הרגילה,
  // ופעיל רק כשהסליידשואו פתוח, כדי שלא יתנגשו זה בזה.
  useEffect(() => {
    if (!slideshowActive) return;

    function handleKeyDown(e: KeyboardEvent) {
      const delta = arrowNavDelta(e.key, lang);
      if (delta !== 0) navigateSlideshow(delta);
      else if (e.key === 'Escape') setSlideshowActive(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideshowActive, lang]);

  // Escape סוגר את חלון ההערה / תצוגת ההשוואה
  useEffect(() => {
    if (!noteEditingId && !compareViewOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (noteEditingId) setNoteEditingId(null);
      else setCompareViewOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [noteEditingId, compareViewOpen]);

  useModalFocus(!!enlargedId, enlargedDialogRef);
  useModalFocus(slideshowActive, slideshowDialogRef);
  useModalFocus(swipeMode, swipeDialogRef);
  useModalFocus(compareViewOpen, compareDialogRef);
  useModalFocus(!!noteEditingId, noteDialogRef);

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
      let choice: 'skip' | 'maybe' | 'selected' | null = null;
      if (e.key === 'ArrowRight') choice = 'selected';
      else if (e.key === 'ArrowLeft') choice = 'skip';
      else if (e.key === 'ArrowDown' || e.key === ' ') choice = 'maybe';
      if (!choice) return;
      e.preventDefault(); // רווח על כפתור בפוקוס היה מפעיל גם את הכפתור עצמו
      handleSwipeAction(choice);
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

  // הכותרת הדביקה בנייד מתכווצת עוד יותר בגלילה למטה ונפתחת חזרה בגלילה
  // למעלה (ה-CSS עצמו רק במסכים צרים - ראו .gh בכותרת). סף קטן כדי שרעידות
  // גלילה לא יגרמו להבהוב, ו-rAF כדי לא לרנדר בכל אירוע scroll.
  const [headerCompact, setHeaderCompact] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 48) {
          setHeaderCompact(false);
          lastY = y;
        } else if (Math.abs(delta) > 8) {
          setHeaderCompact(delta > 0);
          lastY = y;
        }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // מספר עמודות בגריד בנייד (▦) - העדפת תצוגה למכשיר הזה בלבד, אחסון חסום
  // פשוט נשאר עם ברירת המחדל (2)
  const [mobileCols, setMobileCols] = useState<GridCols>(DEFAULT_GRID_COLS);
  useEffect(() => {
    try {
      setMobileCols(parseGridCols(localStorage.getItem(GRID_COLS_KEY)));
    } catch {}
  }, []);
  function cycleMobileCols() {
    const next = nextGridCols(mobileCols);
    setMobileCols(next);
    try {
      localStorage.setItem(GRID_COLS_KEY, String(next));
    } catch {}
  }

  const [authorized, setAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [submittingCode, setSubmittingCode] = useState(false);
  const [authError, setAuthError] = useState('');
  // כפתור "הדבקה" במסך הקוד - מוצג רק אם הדפדפן תומך ב-clipboard.readText
  // (נבדק אחרי mount כדי לא לשבור hydration).
  const [canPasteCode, setCanPasteCode] = useState(false);
  useEffect(() => {
    setCanPasteCode(typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function');
  }, []);

  // שיתוף גלריה משפחתי: אחרי קוד גישה תקין, עוד לא ידוע מי בפועל נכנס/ת
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const [myParticipant, setMyParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [joiningAsGuest, setJoiningAsGuest] = useState(false);
  const [guestNameInput, setGuestNameInput] = useState('');
  // "איך לפנות אלייך?" במסך ההצטרפות - חובה, בלי ברירת מחדל
  const [guestGender, setGuestGender] = useState<Gender | null>(null);
  // מין הלקוח/ה הרשום/ה - ל"כן, זאת אני" / "כן, זה אני" לפני הזיהוי
  const [registeredGender, setRegisteredGender] = useState<Gender>('f');
  // "כן, זאת אני" דורש גם את המייל שהצלמת רשמה (נבדק בשרת, identify/route.ts)
  const [confirmingOwner, setConfirmingOwner] = useState(false);
  const [ownerEmailInput, setOwnerEmailInput] = useState('');
  const [identifying, setIdentifying] = useState(false);
  const [identityError, setIdentityError] = useState('');

  // חלון הסיכום לפני "שליחה לצלמת" (במקום window.confirm) - ראו handleFinish
  const [finishModalOpen, setFinishModalOpen] = useState(false);
  const finishModalRef = useRef<HTMLDivElement>(null);
  useModalFocus(finishModalOpen, finishModalRef);
  // הגלריה ננעלה בינתיים (רענון ברקע) - החלון כבר לא רלוונטי
  useEffect(() => {
    if (isLocked) setFinishModalOpen(false);
  }, [isLocked]);

  // הודעה קופצת חד-פעמית כשהבעלים עוברת לראשונה את מכסת החבילה
  const prevOwnerSelectedRef = useRef<number | null>(null);

  // "להמשיך מאיפה שעצרתי": התמונה האחרונה שנצפתה + אילו כבר נצפו (localStorage,
  // מפתח לכל גלריה+משתתפת). ה-ref הוא מקור האמת לכתיבה, ה-state לתצוגה.
  const resumeStateRef = useRef<ResumeState | null>(null);
  const [viewedIds, setViewedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [resumeOffer, setResumeOffer] = useState<{ photoId: string; index: number } | null>(null);

  // התמונה שמוצגת כרגע במסך מלא - תצוגה מוגדלת / סקירה ברצף / בחירה מהירה
  const currentViewedPhotoId: string | null = enlargedId
    ? enlargedId
    : slideshowActive && photos.length > 0
    ? photos[Math.min(slideshowIndex, photos.length - 1)].id
    : swipeMode && swipeCursor < swipeQueue.length
    ? swipeQueue[swipeCursor]
    : null;

  // טעינת מצב "להמשיך" פעם אחת לכל משתתפת, אחרי שהתמונות נטענו
  useEffect(() => {
    if (!myParticipant || photos.length === 0 || resumeStateRef.current) return;
    const state = loadResumeState(galleryId, myParticipant.id);
    resumeStateRef.current = state;
    setViewedIds(new Set(state.viewed));
    setResumeOffer(computeResumeOffer(state, photos.map((p) => p.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myParticipant?.id, photos.length]);

  // רישום כל תמונה שנפתחה במסך מלא. ברגע שהלקוחה כבר פתחה תמונה, ההצעה
  // "להמשיך מתמונה N" כבר לא רלוונטית.
  useEffect(() => {
    if (!currentViewedPhotoId || !myParticipant || !resumeStateRef.current) return;
    setResumeOffer(null);
    const next = recordPhotoView(resumeStateRef.current, currentViewedPhotoId);
    if (next === resumeStateRef.current) return;
    resumeStateRef.current = next;
    saveResumeState(galleryId, myParticipant.id, next);
    setViewedIds((prev) => (prev.has(currentViewedPhotoId) ? prev : new Set(prev).add(currentViewedPhotoId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentViewedPhotoId, myParticipant?.id]);

  // חציית מכסת החבילה בפעם הראשונה (רק בעלים, רק כשיש מחיר לתמונה נוספת,
  // ופעם אחת בלבד - נשמר ב-localStorage). הערך הראשון אחרי טעינה לא נחשב חציה.
  useEffect(() => {
    if (!packageInfo || !myParticipant?.isOwner) {
      prevOwnerSelectedRef.current = null;
      return;
    }
    const prev = prevOwnerSelectedRef.current;
    prevOwnerSelectedRef.current = ownerSelectedCount;
    // סכום ידני של הצלמת (lib/clientPricing.ts) - מחיר לתמונה נוספת כבר לא רלוונטי
    if (packageInfo.priceOverridden || packageInfo.extraPrice <= 0 || !crossedIncludedQuota(prev, ownerSelectedCount, packageInfo.included)) return;
    const key = extraPriceToastKey(galleryId, myParticipant.id);
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {}
    notify({
      type: 'info',
      key: 'extra-price',
      message: tr('toast.extraPrice', { included: packageInfo.included, price: money(packageInfo.extraPrice) }),
      durationMs: EXTRA_PRICE_TOAST_MS,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerSelectedCount, packageInfo, myParticipant?.id, myParticipant?.isOwner]);

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
    const flush = () => {
      flushPendingQueue();
    };
    flush();

    window.addEventListener('online', flush);
    const interval = setInterval(flush, 20000);

    return () => {
      window.removeEventListener('online', flush);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myParticipant?.id]);

  // "בוחרים ביחד": סקר חי של הסימונים של בני המשפחה האחרים (GET .../marks,
  // בלי URLs של תמונות) כל ~20 שניות - רק כשהטאב גלוי, בהשהיה כשהוא מוסתר,
  // ובהתרחקות (backoff) אחרי כשלים רצופים. הסימונים שלי לא נדרסים - נשארים
  // מהמצב המקומי (אופטימי/תור אופליין), ראו mergeOthersMarks.
  useEffect(() => {
    if (!myParticipant || readOnly) return;
    const myId = myParticipant.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let lastPollAt = Date.now(); // loadGallery בדיוק טען את הסימונים

    function schedule(delay: number) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, delay);
    }

    async function poll() {
      timer = null;
      if (cancelled || document.visibilityState !== 'visible') return; // יתחדש ב-visibilitychange
      lastPollAt = Date.now();
      try {
        const res = await fetch(`/api/gallery/${galleryId}/marks`, { cache: 'no-store' });
        if (res.status === 401 || res.status === 410 || res.status === 428) return; // אין טעם להמשיך לסקור
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        failures = 0;
        const serverMarks = data.allMarks ?? {};
        const fresh = newMarksByOthers(othersMarksBaselineRef.current ?? {}, serverMarks, myId);
        othersMarksBaselineRef.current = serverMarks;
        setAllMarks((prev) => mergeOthersMarks(prev, serverMarks, myId));
        if (Array.isArray(data.participants)) setParticipants(data.participants);
        if (fresh.length > 0) {
          const t = liveRef.current?.tr ?? tr;
          notify({
            type: 'info',
            key: 'others-marks',
            message: `🔔 ${fresh.map((o) => t('toast.othersItem', { name: o.displayName, count: o.count })).join(' · ')}`,
          });
        }
      } catch {
        failures += 1;
      }
      if (!cancelled) schedule(marksPollDelay(failures));
    }

    function handleVisibility() {
      if (document.visibilityState !== 'visible') {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      // חזרה לטאב: אם עבר מרווח מלא מאז הסקר האחרון - סוקרים מיד
      const since = Date.now() - lastPollAt;
      schedule(Math.max(0, marksPollDelay(failures) - since));
    }

    schedule(MARKS_POLL_MS);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myParticipant?.id, readOnly, galleryId]);

  // ספירה לאחור ל"סיימתי לבחור" (ראו handleFinish/submitFinish/cancelFinish) -
  // מחושבת בכל טיק מול finishDeadline (timestamp מוחלט, ראו finishDeadlineKey
  // למעלה) ולא ע"י החסרת 1 כל שנייה, כי setInterval/setTimeout מוקפאים בדפדפני
  // מובייל כשהטאב ברקע. אם היינו סופרים טיקים, טאב שהוקפא באמצע הספירה פשוט
  // "עוצר" ו-submitFinish אף פעם לא נקראת - הבחירה אובדת בשקט. עם timestamp
  // מוחלט, גם טיק שמאחר (כי הטיימר קפא זמן-מה) מחשב נכון כמה זמן *באמת* נשאר
  // מול השעון, ואם כבר עבר - שולחת מיד באיחור במקום לא לשלוח בכלל. ה-tick
  // הראשון רץ סינכרונית (לא מחכה ל-interval הראשון) כדי שגם חידוש ספירה קיימת
  // (checkPendingFinish, כתגובה לטעינת עמוד/חזרה לפוקוס) יציג מספר נכון מיד.
  useEffect(() => {
    if (finishDeadline === null) return;

    function tick() {
      const remaining = Math.ceil(((finishDeadline as number) - Date.now()) / 1000);
      if (remaining <= 0) {
        setFinishCountdown(0);
        setFinishDeadline(null); // מנקה את ה-effect הזה (לא קוראים שוב ל-submitFinish מהטיימר הבא)
        submitFinish();
        return;
      }
      setFinishCountdown(remaining);
    }

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishDeadline]);

  // ממשיכה/משלימה ספירת "סיימתי לבחור" שהתחילה לפני שהטאב הוקפא/נסגר - ראו
  // checkPendingFinish. שני טריגרים: טעינת עמוד מחדש (loadGallery, מכסה גם
  // טאב שנסגר לגמרי ונפתח מחדש ימים אחר כך) ו-visibilitychange (מכסה טאב
  // שנשאר פתוח אך הוקפא ברקע - ברגע שחוזרים לפוקוס מחשבים מול השעון האמיתי
  // במקום לסמוך על כך שה-setInterval שלמעלה יתעורר תוך זמן סביר).
  useEffect(() => {
    if (!myParticipant) return;
    function handleVisibility() {
      if (document.visibilityState === 'visible' && myParticipant) {
        checkPendingFinish(myParticipant.id);
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myParticipant?.id]);

  // ה-URLs החתומים של התמונות תקפים שעה - טאב שחוזר לפוקוס אחרי זמן רב
  // מרענן את נתוני הגלריה ברקע (בלי מסך טעינה) כדי לקבל חתימות חדשות.
  useEffect(() => {
    if (!authorized) return;
    function handleVisibility() {
      if (document.visibilityState !== 'visible') return;
      if (isGalleryDataStale(lastFetchedAtRef.current, Date.now())) {
        refreshGallerySilently();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  // הטעינה עצמה היא גם בדיקת האימות: העוגייה httpOnly ולא ניתנת לקריאה
  // מ-JS, אז אי אפשר "לבדוק אם קיימת" מראש - פשוט מנסים לטעון, ו-401 אומר שצריך קוד גישה.
  //
  // silent: רענון ברקע (חתימות שפגו, אחרי סנכרון תור/AI) - בלי מסך טעינה,
  // בלי לשנות מצב אימות על כשל, בלי שער פתיחה ובלי checkPendingFinish.
  // מחזירה את הנתונים שנטענו (או null), כדי שהורדה תוכל לנסות שוב עם URL טרי.
  async function loadGallery(options: { silent?: boolean } = {}): Promise<any | null> {
    const silent = !!options.silent;
    if (!silent) {
      setLoading(true);
      setCheckingAuth(true);
    }

    let res: Response;
    try {
      res = await fetch(`/api/gallery/${galleryId}`, { cache: 'no-store' });
    } catch {
      if (!silent) {
        setAuthError(tr('err.noInternet'));
        setCheckingAuth(false);
        setLoading(false);
      }
      return null;
    }

    if (res.status === 401) {
      // שפת הגלריה מגיעה גם בלי אימות - מסך הקוד כבר בשפה הנכונה
      const body401 = await res.json().catch(() => null);
      applyGalleryLanguage(body401?.language);
      setAuthorized(false);
      setCheckingAuth(false);
      setLoading(false);
      return null;
    }

    if (!res.ok) {
      if (!silent) {
        const body = await res.json().catch(() => null);
        if (res.status === 410) notifyError(localizedErrorFromBody(lang, body, tr('err.galleryExpired'), viewerGender));
        else notifyError(tr('err.loadFailed'), () => liveRef.current?.loadGallery());
        setCheckingAuth(false);
        setLoading(false);
      }
      return null;
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      if (!silent) {
        notifyError(tr('err.loadFailed'), () => liveRef.current?.loadGallery());
        setCheckingAuth(false);
        setLoading(false);
      }
      return null;
    }
    setAuthorized(true);
    lastFetchedAtRef.current = Date.now();
    applyGalleryLanguage(data.language);

    if (data.needsIdentity) {
      setNeedsIdentity(true);
      setRegisteredName(data.registeredName ?? null);
      setRegisteredGender(normalizeGender(data.registeredGender) ?? 'f');
      setDeliveredPhotos(data.deliveredPhotos ?? []);
      setCheckingAuth(false);
      setLoading(false);
      return data;
    }

    // מעל תשובת השרת מחילים את מה שעוד ממתין בתור האופליין - אחרת רענון
    // "מעלים" בחירות שעוד לא נשלחו (ראו applyPendingToMarks).
    const participantId: string | undefined = data.myParticipant?.id;
    const pending = participantId ? loadPendingQueue(galleryId, participantId) : [];
    const giftIds = new Set<string>((data.photos ?? []).filter((p: GalleryPhoto) => p.isGift).map((p: GalleryPhoto) => p.id));
    const { marks: mergedMarks, selectedDelta } = applyPendingToMarks(data.myMarks ?? {}, pending, (id) => giftIds.has(id));
    const serverReadOnly = !!data.readOnly;

    setNeedsIdentity(false);
    setPhotos(data.photos ?? []);
    setChapters(data.chapters ?? []);
    setDeliveredPhotos(data.deliveredPhotos ?? []);
    setMyMarks(mergedMarks);
    setAllMarks(data.allMarks ?? {});
    othersMarksBaselineRef.current = data.allMarks ?? {};
    setPackageInfo(data.package ?? null);
    setOwnerSelectedCount(Math.max(0, (data.ownerSelectedCount ?? 0) + (data.myParticipant?.isOwner ? selectedDelta : 0)));
    setExpiresAt(data.expiresAt ?? null);
    setGalleryStatus(data.status ?? 'sent');
    setReopenedForSelectionAt(data.reopenedForSelectionAt ?? null);
    setReadOnly(serverReadOnly);
    setBrandColor(data.brandColor ?? null);
    setPhotographerName(data.photographerName ?? null);
    setPhotographerLogo(data.photographerLogo ?? null);
    setMyParticipant(data.myParticipant ?? null);
    setParticipants(data.participants ?? []);
    if (data.myParticipant) {
      // בעלים בלי ערך (API ישן) = נקבה, כמו ברירת המחדל של client_gender
      const resolved = normalizeGender(data.viewerGender) ?? (data.myParticipant.isOwner ? 'f' : null);
      setViewerGender(resolved);
      saveViewerGender(galleryId, resolved);
    }
    setOwnerGender(normalizeGender(data.ownerGender) ?? 'f');
    if (participantId) setPendingCount(pending.length);

    if (!silent) {
      // ממשיכה/משלימה ספירת "סיימתי לבחור" שאולי נשארה תלויה מהפעלה קודמת של
      // העמוד (טאב שנסגר/הוקפא לפני שהספירה הספיקה להסתיים) - ראו checkPendingFinish.
      if (data.myParticipant) {
        // נעילה בפועל (לא status לבד) - גלריה שנפתחה מחדש היא completed אבל לא
        // נעולה, וספירה ממתינה בה צריכה להמשיך ולא להימחק. readOnly = נעולה.
        checkPendingFinish(
          data.myParticipant.id,
          serverReadOnly || (data.status === 'completed' && !data.reopenedForSelectionAt)
        );
      }

      // שער פתיחה: מוצג פעם אחת לכל משתתף/ת בכל גלריה (נשמר ב-localStorage,
      // לא ב-DB - זו רק נוחות תצוגה, לא מידע קריטי ששווה טבלה/עמודה בשבילו).
      // לא במצב צפייה בלבד - "הגלריה מוכנה לבחירה" כבר לא נכון.
      if (typeof window !== 'undefined' && data.myParticipant && !serverReadOnly) {
        const seenKey = `gallery_welcome_seen_${galleryId}_${data.myParticipant.id}`;
        try {
          setShowWelcome(!localStorage.getItem(seenKey));
        } catch {
          setShowWelcome(false);
        }
      } else {
        setShowWelcome(false);
      }

      setCheckingAuth(false);
      setLoading(false);
    }
    return data;
  }

  // רענון ברקע אחד בכל פעם - קריאות מקבילות (כמה תמונות שנכשלו יחד) מקבלות את אותה הבטחה.
  function refreshGallerySilently(): Promise<any | null> {
    if (silentRefreshRef.current) return silentRefreshRef.current;
    const p = loadGallery({ silent: true }).finally(() => {
      silentRefreshRef.current = null;
    });
    silentRefreshRef.current = p;
    return p;
  }

  // כניסה הדרגתית של תמונת גריד (.gimg) - ישירות על האלמנט, בלי state לכל תמונה.
  // גם בכשל: שלא תישאר שקופה (הרקע/הרענון מטפלים בהמשך).
  function markImageLoaded(e: React.SyntheticEvent<HTMLImageElement>) {
    e.currentTarget.dataset.loaded = 'true';
  }

  // תמונה שנכשלה בטעינה (כנראה חתימה שפגה) - רענון אחד לכל תמונה, לא לולאה.
  function handleImageError(photoId: string) {
    if (imgErrorRetriedRef.current.has(photoId)) return;
    imgErrorRetriedRef.current.add(photoId);
    refreshGallerySilently();
  }

  function triggerBlobDownload(blob: Blob, filename: string) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // שחרור מיידי עלול לבטל את ההורדה בחלק מהדפדפנים (בעיקר Safari/Firefox)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  async function fetchBlobOk(url: string | null): Promise<Blob | null> {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  // signed URL הוא cross-origin ל-Supabase (בניגוד לתמונות הבחירה, שרק נצפות
  // ולא מורדות) - הדפדפן מתעלם מ-<a download> בין origins, אז אי אפשר פשוט
  // לקשר אליו. fetch ל-blob + createObjectURL + קליק תכנותי, בדיוק כמו
  // handleZipDownload ב-components/MagicButton.tsx.
  async function handleDownloadDeliveredPhoto(photo: DeliveredPhoto) {
    setDownloadingId(photo.id);
    try {
      let blob = await fetchBlobOk(photo.url);
      if (!blob) {
        // כנראה חתימה שפגה (תוקף שעה) - מרעננים את ה-URLs ומנסים פעם אחת נוספת
        const fresh = await refreshGallerySilently();
        const freshUrl = (fresh?.deliveredPhotos as DeliveredPhoto[] | undefined)?.find((p) => p.id === photo.id)?.url ?? null;
        blob = await fetchBlobOk(freshUrl);
      }
      if (!blob) {
        notifyError(tr('err.downloadFailed'), () => liveRef.current?.downloadDelivered(photo));
        return;
      }
      clearActionError();
      triggerBlobDownload(blob, photo.filename);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDownloadAllDelivered() {
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      const total = deliveredPhotos.length;
      let done = 0;
      const failed: DeliveredPhoto[] = [];

      for (const photo of deliveredPhotos) {
        const blob = await fetchBlobOk(photo.url);
        if (!blob) {
          failed.push(photo);
          continue;
        }
        zip.file(uniqueFileName(photo.filename, usedNames), blob);
        done++;
      }

      // ניסיון חוזר אחד לכושלות, עם URLs טריים (חתימה שפגה באמצע הורדה ארוכה)
      if (failed.length > 0) {
        const fresh = await refreshGallerySilently();
        const freshById = new Map(((fresh?.deliveredPhotos as DeliveredPhoto[] | undefined) ?? []).map((p) => [p.id, p.url]));
        for (const photo of failed) {
          const blob = await fetchBlobOk(freshById.get(photo.id) ?? null);
          if (!blob) continue;
          zip.file(uniqueFileName(photo.filename, usedNames), blob);
          done++;
        }
      }

      if (done === 0) {
        notifyError(tr('err.zipFailed'), () => liveRef.current?.downloadAllDelivered());
        return;
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      triggerBlobDownload(blob, tr('dl.zipFileName'));
      clearActionError();
      if (done < total) {
        notify({
          type: 'warning',
          key: 'zip',
          message: tr('dl.zipPartial', { done, total }),
          action: { label: tr('notify.retry'), run: () => liveRef.current?.downloadAllDelivered() },
        });
      } else {
        notify({ type: 'success', key: 'zip', message: tr('dl.zipSummary', { done, total }) });
      }
    } catch {
      notifyError(tr('err.zipFailed'), () => liveRef.current?.downloadAllDelivered());
    } finally {
      setDownloadingZip(false);
    }
  }

  function dismissWelcome() {
    if (typeof window !== 'undefined' && myParticipant) {
      try {
        localStorage.setItem(`gallery_welcome_seen_${galleryId}_${myParticipant.id}`, '1');
      } catch {}
    }
    setShowWelcome(false);
  }

  // הדבקה לתיבת הקוד (גם Ctrl+V/לחיצה ארוכה) - אם הודבקה ההודעה כולה
  // ("קוד גישה: XXXX") מחלצים רק את הקוד, ובכל מקרה בלי רווחים/מקפים.
  function handleCodeInputPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    setCodeInput(extractAccessCode(text));
    setAuthError('');
  }

  async function handlePasteCodeButton() {
    try {
      const text = await navigator.clipboard.readText();
      const code = extractAccessCode(text || '');
      if (!code) {
        setAuthError(tr('code.pasteNoCode'));
        return;
      }
      setCodeInput(code);
      setAuthError('');
    } catch {
      // הרשאה נדחתה / דפדפן שחוסם קריאה מהלוח
      setAuthError(tr('code.pasteFailed'));
    }
  }

  async function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (submittingCode) return;
    const code = normalizeAccessCode(codeInput);
    if (!code) {
      setAuthError(tr('code.enterCode'));
      return;
    }
    setAuthError('');
    setSubmittingCode(true);

    try {
      let res: Response;
      try {
        res = await fetch('/api/verify-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ galleryId, accessCode: code }),
        });
      } catch {
        setAuthError(tr('err.noInternet'));
        return;
      }

      if (res.ok) {
        await loadGallery();
        return;
      }
      // 429/503 וכו' - השרת מחזיר JSON עם error, אבל דף שגיאה של פרוקסי לא יהיה JSON
      const body = await res.json().catch(() => null);
      setAuthError(localizedErrorFromBody(lang, body, tr(accessCodeFallbackKey(res.status)), viewerGender));
    } catch {
      setAuthError(tr('code.authFailed'));
    } finally {
      setSubmittingCode(false);
    }
  }

  async function confirmIdentity(body: { asOwner: true; ownerEmail: string } | { displayName: string; gender: Gender }) {
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
      setIdentityError(typeof data.error === 'string' ? localizeServerError(lang, data.error, viewerGender) : tr('err.identifyFailed'));
      return;
    }

    // זוכרים את לשון הפנייה גם בדפדפן (מסך הקוד בכניסה הבאה); loadGallery
    // מיד אחר כך מעדכן ממה שנשמר בשרת.
    const chosen: Gender = 'gender' in body ? body.gender : registeredGender;
    setViewerGender(chosen);
    saveViewerGender(galleryId, chosen);

    await loadGallery();
  }

  liveRef.current = {
    tr,
    setPhotoStatus,
    loadGallery: () => loadGallery(),
    downloadDelivered: handleDownloadDeliveredPhoto,
    downloadAllDelivered: handleDownloadAllDelivered,
    clearAllSelections,
    aiPicks: handleAiPicks,
  };

  // מסכי הכניסה (קוד/זיהוי) מציגים גם הם הודעות - למשל "הגלריה פגה" בטעינה
  const notifyHostStandalone = (
    <NotifyHost notifier={notifier} bottom="calc(1rem + env(safe-area-inset-bottom))" closeLabel={tr('common.closeNotice')} accent={theme.gold} dir={dir} />
  );

  // שלד גריד במקום טקסט "טוען..." - גם בבדיקת הגישה הראשונית (שהיא עצמה
  // טעינת הגלריה, ראו loadGallery) וגם בטעינה חוזרת אחרי קוד/זיהוי
  if (checkingAuth) {
    return <GallerySkeleton label={tr('common.loadingGallery')} dir={dir} lang={lang} />;
  }

  if (!authorized) {
    return (
      <div dir={dir} lang={lang} style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <LanguagePicker lang={lang} onChange={changeLang} />
        {notifyHostStandalone}
        <form onSubmit={handleSubmitCode} style={{ maxWidth: 320, width: '100%', textAlign: 'center', padding: '1.25rem 2rem 2rem' }}>
          <label htmlFor="access-code" style={{ display: 'block', marginBottom: '1.25rem', color: theme.gold, fontSize: 18 }}>
            {tr('code.title')}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch', marginBottom: '0.75rem' }}>
          <input
            id="access-code"
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onPaste={handleCodeInputPaste}
            style={{ ...inputStyle, flex: 1, minWidth: 0, width: '100%', textAlign: 'center', fontSize: 18, letterSpacing: 1 }}
            aria-describedby={authError ? 'access-code-error' : undefined}
            aria-invalid={authError ? true : undefined}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="one-time-code"
            spellCheck={false}
            dir="ltr"
            disabled={submittingCode}
            autoFocus
          />
          {canPasteCode && (
            <button
              type="button"
              onClick={handlePasteCodeButton}
              disabled={submittingCode}
              aria-label={tr('code.pasteAria')}
              style={{ ...outlineButtonStyle, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {tr('code.paste')}
            </button>
          )}
          </div>
          <button
            type="submit"
            disabled={submittingCode}
            aria-busy={submittingCode}
            style={{ ...goldButtonStyle, width: '100%', opacity: submittingCode ? 0.6 : 1 }}
          >
            {submittingCode ? tr('code.checking') : tr('code.enter')}
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
      <div dir={dir} lang={lang} style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <LanguagePicker lang={lang} onChange={changeLang} />
        {notifyHostStandalone}
        <div style={{ maxWidth: 340, width: '100%', textAlign: 'center', padding: '1.25rem 2rem 2rem' }}>
          <p style={{ marginBottom: '1.5rem', color: theme.gold, fontSize: 18, fontFamily: theme.fontSerif }}>
            {registeredName ? tr('id.hiName', { name: registeredName }) : tr('id.hi')}
          </p>

          {confirmingOwner ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (ownerEmailInput.trim()) confirmIdentity({ asOwner: true, ownerEmail: ownerEmailInput });
              }}
            >
              <label htmlFor="owner-email" style={{ display: 'block', color: theme.textMuted, marginBottom: '0.75rem', fontSize: 14 }}>
                {tr('id.ownerEmailLabel')}
              </label>
              <input
                id="owner-email"
                type="email"
                inputMode="email"
                value={ownerEmailInput}
                onChange={(e) => setOwnerEmailInput(e.target.value)}
                placeholder="name@example.com"
                style={{ ...inputStyle, width: '100%', marginBottom: '0.75rem', textAlign: 'center' }}
                aria-describedby={identityError ? 'identity-error' : undefined}
                aria-invalid={identityError ? true : undefined}
                autoComplete="email"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                dir="ltr"
                maxLength={254}
                disabled={identifying}
                autoFocus
              />
              <button
                type="submit"
                disabled={identifying || !ownerEmailInput.trim()}
                aria-busy={identifying}
                style={{ ...goldButtonStyle, width: '100%', opacity: identifying || !ownerEmailInput.trim() ? 0.6 : 1, marginBottom: '0.6rem' }}
              >
                {identifying ? trG(registeredGender, 'code.checking') : tr('id.confirmEnter')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingOwner(false);
                  setIdentityError('');
                }}
                style={{ ...outlineButtonStyle, width: '100%' }}
              >
                {tr('common.back')}
              </button>
            </form>
          ) : !joiningAsGuest ? (
            <>
              <p style={{ color: theme.textMuted, marginBottom: '1.25rem', fontSize: 14 }}>{tr('id.whoIsIn')}</p>
              <button
                onClick={() => {
                  setIdentityError('');
                  setConfirmingOwner(true);
                }}
                disabled={identifying}
                style={{ ...goldButtonStyle, width: '100%', opacity: identifying ? 0.6 : 1, marginBottom: '0.6rem' }}
              >
                {`${trG(registeredGender, 'id.itsMe')}${registeredName ? ` (${registeredName})` : ''}`}
              </button>
              <button
                onClick={() => {
                  setIdentityError('');
                  setJoiningAsGuest(true);
                }}
                style={{ ...outlineButtonStyle, width: '100%' }}
              >
                {tr('id.notMe')}
              </button>
            </>
          ) : (
            <>
              <label htmlFor="guest-name" style={{ display: 'block', color: theme.textMuted, marginBottom: '0.75rem', fontSize: 14 }}>
                {tr('id.nameLabel')}
              </label>
              <input
                id="guest-name"
                type="text"
                value={guestNameInput}
                onChange={(e) => setGuestNameInput(e.target.value)}
                placeholder={tr('id.namePlaceholder')}
                style={{ ...inputStyle, width: '100%', marginBottom: '0.75rem', textAlign: 'center' }}
                maxLength={40}
                autoFocus
              />
              {/* לשון פנייה לאורח/ת (gallery_participants.gender) - חובה, בלי ברירת מחדל */}
              <div id="guest-gender-label" style={{ color: theme.textMuted, marginBottom: '0.5rem', fontSize: 14 }}>
                {tr('id.genderLabel')}
              </div>
              <div role="radiogroup" aria-labelledby="guest-gender-label" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {([
                  { value: 'f', label: tr('id.genderF') },
                  { value: 'm', label: tr('id.genderM') },
                ] as { value: Gender; label: string }[]).map((option) => {
                  const active = guestGender === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setGuestGender(option.value)}
                      style={{
                        ...outlineButtonStyle, flex: 1, minHeight: 44, padding: '0.4rem 0.5rem',
                        borderColor: active ? theme.gold : theme.border,
                        color: active ? theme.gold : theme.textMuted,
                        background: active ? `${theme.gold}22` : 'transparent',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  if (guestGender) confirmIdentity({ displayName: guestNameInput, gender: guestGender });
                }}
                disabled={identifying || !guestNameInput.trim() || !guestGender}
                style={{ ...goldButtonStyle, width: '100%', opacity: identifying || !guestNameInput.trim() || !guestGender ? 0.6 : 1, marginBottom: '0.6rem' }}
              >
                {identifying ? trG(guestGender, 'id.joining') : tr('id.join')}
              </button>
              <button onClick={() => setJoiningAsGuest(false)} style={{ ...outlineButtonStyle, width: '100%' }}>
                {tr('common.back')}
              </button>
            </>
          )}

          {identityError && (
            <p id="identity-error" role="alert" style={{ background: theme.errorBg, color: theme.errorText, padding: '0.6rem 1rem', borderRadius: 8, marginTop: '1rem' }}>
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
    // מחליף פעולה קודמת על אותה תמונה מאותו סוג (רק המצב האחרון חשוב), ושומר
    // סטטוס לפני הערה של אותה תמונה - ראו enqueueAction. נקרא מחדש מהאחסון
    // ממש לפני השמירה, כדי לא לדרוס פעולות שנוספו בינתיים.
    const queue = enqueueAction(loadPendingQueue(galleryId, myParticipant.id), action);
    savePendingQueue(galleryId, myParticipant.id, queue);
    setPendingCount(queue.length);
  }

  // אחרי שליחה ישירה מוצלחת - פעולות ישנות על אותה תמונה שעדיין בתור כבר
  // לא רלוונטיות (ואם יישלחו אחר כך ידרסו את המצב החדש).
  function dropQueuedAfterDirectSuccess(action: PendingAction) {
    if (!myParticipant) return;
    const stored = loadPendingQueue(galleryId, myParticipant.id);
    const next = dropActionsAfterDirectSuccess(stored, action);
    if (next.length !== stored.length) {
      savePendingQueue(galleryId, myParticipant.id, next);
      setPendingCount(next.length);
    }
  }

  // שולחת את התור לפי הסדר. מחזירה כמה פעולות עוד ממתינות בסוף.
  // participantIdOverride - כשנקראת מתוך loadGallery/submitFinish לפני
  // שסטייט ה-myParticipant התעדכן.
  async function flushPendingQueue(participantIdOverride?: string): Promise<number> {
    const participantId = participantIdOverride ?? myParticipant?.id;
    if (!participantId) return 0;
    if (flushInFlightRef.current) {
      flushAgainRef.current = true;
      return loadPendingQueue(galleryId, participantId).length;
    }
    flushInFlightRef.current = true;

    let hadServerError = false;
    let anyProcessed = false;
    let remaining: PendingAction[] = [];
    try {
      // כמה סבבים - פעולות שנכנסו לתור בזמן ה-flush נשלחות באותה ריצה
      for (let pass = 0; pass < 5; pass++) {
        flushAgainRef.current = false;
        const snapshot = loadPendingQueue(galleryId, participantId);
        if (snapshot.length === 0) {
          remaining = [];
          break;
        }

        const processed: PendingAction[] = [];
        let networkError = false;
        for (const action of snapshot) {
          const result = await postAction(action);
          if (result === 'network-error') {
            networkError = true; // עדיין בלי חיבור - עוצרים כאן, מנסים שוב בפעם הבאה
            break;
          }
          // 'server-error' - דחייה אמיתית (למשל הגלריה כבר ננעלה): לא מנסים
          // שוב, אבל צריך לרענן את המסך ולהודיע. 'ok' - בוצע.
          if (result === 'server-error') hadServerError = true;
          processed.push(action);
        }

        // קוראים שוב מהאחסון וממזגים - לא דורסים פעולות שנוספו/הוחלפו בזמן השליחה
        remaining = reconcileQueueAfterFlush(loadPendingQueue(galleryId, participantId), processed);
        savePendingQueue(galleryId, participantId, remaining);
        setPendingCount(remaining.length);
        if (processed.length > 0) anyProcessed = true;

        if (networkError || remaining.length === 0 || !flushAgainRef.current) break;
      }
    } finally {
      flushInFlightRef.current = false;
    }

    if (hadServerError) {
      // לפעולות בתור אין את המצב "לפני" (current) כמו ב-setPhotoStatus, אז אי
      // אפשר לבטל בדיוק את אותה פעולה - טוענים מחדש מהשרת (ברקע, בלי מסך טעינה).
      await refreshGallerySilently();
      notifyError(tr('err.offlineNotSaved'));
    } else if (anyProcessed) {
      // סנכרון הצליח - טוענים מחדש סימונים ומונים מהשרת (אמת אחת)
      await refreshGallerySilently();
    }
    return remaining.length;
  }

  // תמונת מתנה כבר כלולה אוטומטית - לא מסמנים אותה (השרת גם דוחה, ראו
  // app/api/gallery/[id]/selection/route.ts), כדי שלא תיספר למכסת החבילה.
  function isGiftPhoto(photoId: string) {
    return photos.some((p) => p.id === photoId && p.isGift);
  }

  // הלב בפינת הכרטיס בגריד - בחירה מהירה בלי לפתוח: נבחרה <-> כלום בלבד
  // ("אולי" נקבע רק מהתצוגה המוגדלת / סקירה ברצף / בחירה מהירה).
  function toggleSelectedFromGrid(photoId: string) {
    if (isLocked || !myParticipant) return; // הבחירה כבר נשלחה - נעול לעריכה
    if (isGiftPhoto(photoId)) return;
    return setPhotoStatus(photoId, toggleStatusTo(myMarks[photoId]?.status, 'selected'));
  }

  // כפתורי הפס התחתון בתצוגה המוגדלת (וגם מקשי S/M). אחרי "אני רוצה את זו"
  // (קביעה, לא ביטול) - מעבר אוטומטי לתמונה הבאה אחרי רגע קצר; בתמונה
  // האחרונה נשארים. אותם שומרים כמו בכל מקום: נעילה, משתתפת מזוהה, מתנה.
  function markEnlarged(photoId: string, target: 'maybe' | 'selected') {
    if (isLocked || !myParticipant) return;
    if (isGiftPhoto(photoId)) return;
    const next = toggleStatusTo(myMarks[photoId]?.status, target);
    setPhotoStatus(photoId, next);

    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    const index = photos.findIndex((p) => p.id === photoId);
    if (!shouldAutoAdvance(next, index, photos.length)) return;
    const nextId = photos[index + 1].id;
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      setZoomScale(1);
      // רק אם הלקוחה עדיין על אותה תמונה (לא דפדפה/סגרה בינתיים)
      setEnlargedId((cur) => (cur === photoId ? nextId : cur));
    }, AUTO_ADVANCE_MS);
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
        nextMarks[photoId] = { status: next, note: prev[photoId]?.note ?? null, photographerReply: prev[photoId]?.photographerReply ?? null };
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

    // תמונת מתנה לא נספרת ב-ownerSelectedCount (השרת סופר עם countBillableSelected) -
    // ביטול סימון ישן שלה (או החזרתו אחרי שגיאת שרת) לא משנה את המונה.
    if (isGiftPhoto(photoId)) return;
    if (myParticipant.isOwner && next === 'selected') {
      setOwnerSelectedCount((prev) => prev + (current === 'selected' ? 0 : 1));
    } else if (myParticipant.isOwner && current === 'selected' && next !== 'selected') {
      setOwnerSelectedCount((prev) => Math.max(0, prev - 1));
    }
  }

  // נקודת הכניסה המשותפת לכל שינוי סטטוס (לב בגריד, התצוגה המוגדלת, השוואה,
  // סקירה ברצף, בחירה מהירה) - קובעת ישירות את הסטטוס הרצוי.
  //
  // מעדכן את המסך מיד (אופטימי), לפני תשובת השרת - כדי שאפשר יהיה להמשיך
  // לדפדף ולבחור גם באינטרנט חלש/מנותק. אם זו שגיאת רשת (לא שרת), הפעולה
  // נכנסת לתור ותסונכרן אוטומטית כשהחיבור יחזור (ראו flushPendingQueue).
  async function setPhotoStatus(photoId: string, next: 'maybe' | 'selected' | null, options: { silentUndo?: boolean } = {}) {
    if (isLocked || !myParticipant) return;
    // ביטול (null) עדיין מותר - למקרה שסומנה לפני שהפכה למתנה
    if (next !== null && isGiftPhoto(photoId)) return;
    const current = myMarks[photoId]?.status;

    applyStatusChange(photoId, next, current);

    // הסרת בחירה/"אולי" - הודעה עם "בטל" שמחזירה את הסימון הקודם (דרך אותה
    // setPhotoStatus, בגרסה העדכנית שלה - liveRef). לא אחרי ה"בטל" עצמו.
    if (next === null && current && !options.silentUndo) {
      const n = photos.findIndex((p) => p.id === photoId) + 1;
      notify({
        type: 'success',
        key: 'undo-remove',
        message: tr(current === 'selected' ? 'notify.selectionRemoved' : 'notify.maybeRemoved', { n }),
        action: { label: tr('notify.undo'), run: () => liveRef.current?.setPhotoStatus(photoId, current, { silentUndo: true }) },
      });
    }

    const action: PendingAction = { type: 'status', photoId, status: next };

    // flush באמצע, או שיש כבר פעולות ממתינות לאותה תמונה - נכנסים לתור כדי
    // לשמור על הסדר (אחרת פעולה ישנה מהתור עלולה להגיע לשרת אחרי החדשה).
    if (flushInFlightRef.current || queueHasPhoto(loadPendingQueue(galleryId, myParticipant.id), photoId)) {
      enqueuePendingAction(action);
      clearActionError();
      flushPendingQueue();
      return;
    }

    const result = await postAction(action);

    if (result === 'network-error') {
      enqueuePendingAction(action);
      clearActionError();
      return;
    }
    if (result === 'server-error') {
      applyStatusChange(photoId, current ?? null, next ?? undefined); // ביטול העדכון האופטימי - שגיאה אמיתית, לא ניתוק
      dismissKey('undo-remove');
      notifyError(tr('err.updateNotSaved'), () => liveRef.current?.setPhotoStatus(photoId, next, { silentUndo: true }));
      return;
    }
    dropQueuedAfterDirectSuccess(action);
    clearActionError();
  }

  function openNoteEditor(photoId: string, e: React.MouseEvent) {
    e.stopPropagation(); // לא לגעת בבחירה עצמה
    if (isLocked) return;
    setNoteEditingId(photoId);
    setNoteDraft(myMarks[photoId]?.note ?? '');
  }

  // הלקוחה עדיין רואה ועורכת הכל כרגיל בזמן הספירה - רק בתום ה-60 שניות
  // (או אם לא ביטלה) קוראים בפועל ל-API, שגם נועל את הגלריה וגם שולח מייל
  // התראה לצלמת "הלקוחה סיימה" - לא רוצים לשלוח את זה מוקדם מדי ואז לבטל.
  //
  // participantIdForCleanup מתקבל כפרמטר (ולא רק נלקח מ-myParticipant הסטייט)
  // כי checkPendingFinish עשויה לקרוא לפונקציה הזו מתוך loadGallery, לפני
  // שסטייט ה-myParticipant הספיק להתעדכן (setState אסינכרוני) - כדי לנקות את
  // מפתח ה-localStorage הנכון גם במקרה הזה.
  //
  // /api/gallery/[id]/finish אידמפוטנטי (פועל רק כש-status !== 'completed' או
  // שהגלריה נפתחה מחדש, לפני שהוא שולח מיילים) - קריאה כפולה לא גורמת למייל כפול, אבל
  // finishInFlightRef עדיין מונע שתי בקשות במקביל (למשל טיימר שהגיע ל-0 בדיוק
  // כשחוזרים לפוקוס והדפדפן גם שולח אירוע visibilitychange על אותו רגע).
  async function submitFinish(participantIdForCleanup?: string) {
    if (finishInFlightRef.current) return;
    finishInFlightRef.current = true;
    setFinishing(true);
    setFinishFailed(false);

    // לא שולחים "סיימתי" כשיש בחירות שעוד לא הגיעו לשרת - קודם מסנכרנים,
    // ואם עדיין נשאר משהו בתור (אין חיבור) עוצרים ומציגים הודעה + "נסי שוב".
    // הרשומה ב-localStorage נשארת, כך שהשליחה תושלם אוטומטית בחזרה לפוקוס.
    const pendingParticipantId = participantIdForCleanup ?? myParticipant?.id;
    if (pendingParticipantId && loadPendingQueue(galleryId, pendingParticipantId).length > 0) {
      const stillPending = await flushPendingQueue(pendingParticipantId);
      if (stillPending > 0) {
        finishInFlightRef.current = false;
        setFinishing(false);
        setFinishCountdown(null);
        setFinishFailed(true);
        notifyError(tr('err.finishPendingOffline'));
        return;
      }
    }

    let res: Response;
    try {
      res = await fetch(`/api/gallery/${galleryId}/finish`, { method: 'POST' });
    } catch {
      finishInFlightRef.current = false;
      setFinishing(false);
      setFinishCountdown(null);
      setFinishFailed(true);
      notifyError(tr('err.offlineRetryLater'));
      // לא מנקים את ה-localStorage כאן - זו לא כשלון סופי, רק ניתוק. הרשומה
      // נשארת, וה"סיימתי לבחור" יושלם אוטומטית בפעם הבאה שהעמוד ייטען או
      // שהטאב יחזור לפוקוס (checkPendingFinish), בלי שהלקוחה תצטרך ללחוץ שוב.
      return;
    }
    finishInFlightRef.current = false;
    setFinishing(false);

    const participantId = participantIdForCleanup ?? myParticipant?.id;
    if (participantId) {
      // בין אם הצליחה ובין אם השרת דחה סופית (403/410 וכו') - אין טעם לנסות
      // שוב את אותה בקשה, אז מנקים את הרשומה השמורה בכל מקרה מכאן והלאה.
      clearFinishDeadline(galleryId, participantId);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setFinishCountdown(null);
      setFinishFailed(true);
      notifyError(localizedErrorFromBody(lang, body, tr('err.finishFailed'), viewerGender));
      return;
    }

    clearActionError();
    setFinishCountdown(null);
    setFinishFailed(false);
    setGalleryStatus('completed');
    // סיום אחרי פתיחה מחדש: השרת מנקה את reopened_for_selection_at - מסנכרנים
    // כדי ש-isLocked יחזור להיות true מיד.
    setReopenedForSelectionAt(null);
    setConfettiPieces(generateConfetti());
    setShowCelebration(true);
    setTimeout(() => setShowCelebration(false), 3500);
  }

  // בודקת אם יש ספירת "סיימתי לבחור" ממתינה שהתחילה בהפעלה קודמת של העמוד
  // (נשמרה ב-localStorage ע"י handleFinish) - ראו הערה מפורטת ליד ה-useEffect
  // שמאזין ל-finishDeadline, ואת שני מקומות הקריאה (loadGallery, ו-
  // visibilitychange). currentlyLocked מועבר רק כשידוע טרי מהשרת (loadGallery);
  // אם הגלריה כבר נעולה (completed ולא נפתחה מחדש) אין טעם לנסות לשלוח שוב -
  // רק מנקים רשומה ישנה.
  function checkPendingFinish(participantId: string, currentlyLocked?: boolean) {
    const deadline = loadFinishDeadline(galleryId, participantId);
    if (deadline === null) return;

    if (currentlyLocked) {
      clearFinishDeadline(galleryId, participantId);
      return;
    }

    if (Date.now() >= deadline) {
      // הספירה כבר הייתה אמורה להסתיים בזמן שהטאב היה ברקע/סגור - שולחים
      // עכשיו במקום לאבד את הבחירה בשקט (זה בדיוק התרחיש שהתיקון הזה פותר).
      submitFinish(participantId);
    } else {
      setFinishDeadline(deadline);
      setFinishCountdown(Math.max(1, Math.ceil((deadline - Date.now()) / 1000)));
    }
  }

  // "סיימתי" פותח קודם חלון סיכום (במקום window.confirm) - רק לבעלים, רק
  // כשהבחירה פתוחה ויש לפחות תמונה אחת. אורחות לא יכולות לסיים (כמו קודם).
  function handleFinish() {
    if (!myParticipant?.isOwner || isLocked || ownerSelectedCount === 0) return;
    if (finishDeadline !== null || finishInFlightRef.current) return;
    setFinishModalOpen(true);
  }

  // "שליחה לצלמת ✓" בחלון הסיכום - נכנס לזרימה הקיימת, כולל ספירת הביטול
  function confirmFinishFromModal() {
    setFinishModalOpen(false);
    if (!myParticipant?.isOwner || isLocked || ownerSelectedCount === 0) return;
    startFinishCountdown();
  }

  // "לעבור עליהן" - סוגר את החלון ומציג בגריד רק את ה"אולי"
  function reviewMaybesFromModal() {
    setFinishModalOpen(false);
    setViewFilter('maybe');
    setTimeout(() => {
      document.getElementById('gallery-filter-row')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }, 0);
  }

  // Escape סוגר, ו-Tab/Shift+Tab נשארים בתוך החלון (focusTrapIndex)
  function handleFinishModalKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setFinishModalOpen(false);
      return;
    }
    if (e.key !== 'Tab' || !finishModalRef.current) return;
    const focusables = Array.from(finishModalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const target = focusTrapIndex(focusables.indexOf(document.activeElement as HTMLElement), focusables.length, e.shiftKey);
    if (target === null) return;
    e.preventDefault();
    focusables[target].focus();
  }

  // "המשך" בבאנר ברוכה השבה - גוללת לכרטיס ופותחת אותו בגדול
  function resumeFromOffer() {
    const offer = resumeOffer;
    setResumeOffer(null);
    if (!offer) return;
    const photo = photos.find((p) => p.id === offer.photoId);
    if (!photo) return;
    document.getElementById(`photo-card-${photo.id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    if (photo.thumbnailUrl && photo.fullUrl) {
      setZoomScale(1);
      setEnlargedId(photo.id);
    }
  }

  function startFinishCountdown() {
    const deadline = Date.now() + FINISH_UNDO_SECONDS * 1000;
    if (myParticipant) {
      saveFinishDeadline(galleryId, myParticipant.id, deadline);
    }
    setFinishFailed(false);
    setFinishCountdown(FINISH_UNDO_SECONDS);
    setFinishDeadline(deadline);
  }

  function cancelFinish() {
    if (myParticipant) {
      clearFinishDeadline(galleryId, myParticipant.id);
    }
    setFinishDeadline(null);
    setFinishCountdown(null);
    setFinishFailed(false);
  }

  // skipConfirm - רק מ"נסי שוב" אחרי כשל (כבר אישרו פעם אחת)
  async function clearAllSelections(skipConfirm = false) {
    if (!myParticipant || isLocked) return;
    if (!skipConfirm && !window.confirm(tr('act.clearConfirm'))) return;

    setClearingAll(true);
    let res: Response;
    try {
      res = await fetch(`/api/gallery/${galleryId}/selection`, { method: 'DELETE' });
    } catch {
      setClearingAll(false);
      notifyError(tr('err.offlineRetryLater'), () => liveRef.current?.clearAllSelections(true));
      return;
    }
    setClearingAll(false);

    if (!res.ok) {
      notifyError(tr('err.clearFailed'), () => liveRef.current?.clearAllSelections(true));
      return;
    }
    clearActionError();
    dismissKey('undo-remove');

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

  // ה-API כבר שמר את הסימונים בשרת (app/api/gallery/[id]/ai-picks) - בלי
  // setPhotoStatus לכל תמונה (בקשת רשת מיותרת לכל אחת); אחרי הריצה טוענים
  // מחדש מהשרת את הסימונים והמונים.
  async function handleAiPicks() {
    if (!myParticipant?.isOwner || isLocked || aiPicksRunning) return;

    setAiPicksRunning(true);
    clearActionError();

    let res: Response;
    try {
      res = await fetch(`/api/gallery/${galleryId}/ai-picks`, { method: 'POST' });
    } catch {
      setAiPicksRunning(false);
      notifyError(tr('err.offlineRetryLater'), () => liveRef.current?.aiPicks());
      return;
    }
    setAiPicksRunning(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notifyError(localizedErrorFromBody(lang, data, tr('err.aiFailed'), viewerGender));
      return;
    }

    const data = await res.json().catch(() => ({}));
    // השרת כבר שמר את הסימונים - טוענים מחדש מהשרת (סימונים + מונים) במקום
    // לעדכן מקומית, כדי שהמסך יהיה אמת אחת עם מה שבאמת נשמר.
    await refreshGallerySilently();

    notify(
      data.pickedCount > 0
        ? { type: 'success', key: 'ai', message: tr('act.aiPicked', { picked: data.pickedCount, analyzed: data.analyzedCount }) }
        : { type: 'info', key: 'ai', message: tr('act.aiNone') }
    );
  }

  // אופטימי כמו setPhotoStatus - ההערה נשמרת מקומית מיד, ומסונכרנת מהתור אם
  // הייתה שגיאת רשת (לא שגיאת שרת אמיתית).
  async function saveNote() {
    if (!noteEditingId || !myParticipant) return;
    const photoId = noteEditingId;
    const trimmed = noteDraft.trim().slice(0, NOTE_MAX_LENGTH);
    const previousNote = myMarks[photoId]?.note ?? null; // נשמר לפני העדכון האופטימי, לביטול אם השרת ידחה (כמו current ב-setPhotoStatus)

    setMyMarks((prev) => {
      const existing = prev[photoId];
      if (!existing) return prev;
      return { ...prev, [photoId]: { ...existing, note: trimmed || null } };
    });
    setNoteEditingId(null);

    const action: PendingAction = { type: 'note', photoId, note: trimmed };

    // סימון התמונה עוד ממתין בתור (או flush באמצע) - ההערה חייבת לחכות
    // אחריו, אחרת השרת ידחה אותה ("תמונה שלא סומנה").
    if (flushInFlightRef.current || queueHasPhoto(loadPendingQueue(galleryId, myParticipant.id), photoId)) {
      enqueuePendingAction(action);
      clearActionError();
      flushPendingQueue();
      return;
    }

    const result = await postAction(action);

    if (result === 'network-error') {
      enqueuePendingAction(action);
      clearActionError();
      return;
    }
    if (result === 'server-error') {
      // ביטול העדכון האופטימי - שגיאה אמיתית (למשל הבחירה שההערה תלויה בה כבר
      // הוסרה בינתיים), לא ניתוק
      setMyMarks((prev) => {
        const existing = prev[photoId];
        if (!existing) return prev;
        return { ...prev, [photoId]: { ...existing, note: previousNote } };
      });
      // "נסי שוב" פותח מחדש את חלון ההערה עם הטקסט שנכתב
      notifyError(tr('err.noteNotSaved'), () => {
        setNoteEditingId(photoId);
        setNoteDraft(trimmed);
      });
      return;
    }
    dropQueuedAfterDirectSuccess(action);
    clearActionError();
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
  function setSwipeCursorBoth(next: number) {
    swipeCursorRef.current = next;
    setSwipeCursor(next);
  }

  function startSwipeMode(pass: 1 | 2) {
    // תמונות מתנה לא נכנסות לבחירה המהירה - הן כבר כלולות, אין מה להכריע עליהן
    const queue = pass === 1
      ? photos.filter((p) => !p.isGift).map((p) => p.id)
      : photos.filter((p) => !p.isGift && myMarks[p.id]?.status === 'maybe').map((p) => p.id);
    const startIndex = pass === 1 ? findNextUnmarkedIndex(queue, 0, (id) => !!myMarks[id]?.status) : 0;
    setSwipeQueue(queue);
    setSwipeCursorBoth(startIndex);
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
  //
  // דילוג רק מקדם את הסמן - לא מוחק סימון קיים (למשל "אולי" בסבב השני).
  // הסמן מתקדם לפני ההמתנה לרשת, והקשה על תמונה שבקשה עליה עדיין בדרך
  // נדחית (planSwipeTap ב-lib/galleryClient.ts).
  async function handleSwipeAction(choice: 'skip' | 'maybe' | 'selected') {
    if (isLocked) return;
    const cursor = swipeCursorRef.current;
    const plan = planSwipeTap(cursor, swipeQueue, swipeInFlightRef.current, choice, myMarks[swipeQueue[cursor]]?.status);
    if (!plan) return;
    setSwipeCursorBoth(plan.nextCursor);
    if (!plan.post) return;
    swipeInFlightRef.current.add(plan.photoId);
    try {
      await setPhotoStatus(plan.photoId, plan.post);
    } finally {
      swipeInFlightRef.current.delete(plan.photoId);
    }
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
    return <GallerySkeleton label={tr('common.loadingGallery')} dir={dir} lang={lang} />;
  }

  // "נבחרו X/Y" ופס ההתקדמות תמיד לפי ה-ownerSelectedCount (הרשמי) - לא לפי
  // הבחירות המקומיות של המשתמש/ת הנוכחי/ת, כדי שאורחים לא יראו מספר "כאילו רשמי"
  // שלא באמת נספר. ראו app/api/gallery/[id]/route.ts.
  const myStatuses = Object.fromEntries(Object.entries(myMarks).map(([id, m]) => [id, m.status]));
  const mySelectedCount = Object.values(myStatuses).filter((s) => s === 'selected').length;
  const maybeCount = Object.values(myStatuses).filter((s) => s === 'maybe').length;
  // ownerSelectedCount כבר בלי תמונות מתנה (השרת סופר עם countBillableSelected,
  // והבחירה של מתנה חסומה) - מתנות אף פעם לא מגדילות את המחיר. lib/gifts.ts.
  const usage = packageInfo
    ? computePackageUsage({
        billableSelectedCount: ownerSelectedCount,
        included: packageInfo.included,
        extraPrice: packageInfo.extraPrice,
        basePrice: packageInfo.basePrice,
      })
    : null;
  const overIncluded = usage?.extraCount ?? 0;
  const remaining = usage?.remaining ?? 0;
  const extraCost = usage?.extraCost ?? 0;
  const totalEstimate = usage?.totalEstimate ?? 0;
  const progressPct = usage?.progressPct ?? 0;
  // סכום ידני של הצלמת גובר על "N × מחיר" - ראו lib/clientPricing.ts
  const priceDisplay = resolveClientPriceDisplay(packageInfo, { extraCount: overIncluded, totalEstimate });
  const giftPhotos = photos.filter((p) => p.isGift);
  // סינון תצוגה בלבד ("הצג רק בחירות שלי") - לא נוגע בנתונים עצמם, רק
  // באיזה תת-קבוצה מוצגת בגריד. עוזר לסקור לפני "סיימתי לבחור" בגלריות גדולות.
  // "בוחרים ביחד" (lib/choosingTogether.ts) - הסינונים המשותפים מחושבים מחדש
  // בכל רינדור, כך שהמספרים מתעדכנים מיד עם כל סימון שלי ועם כל סקר חי.
  const together = computeTogetherFilters(photos.map((p) => p.id), myParticipant?.id, myStatuses, allMarks);
  const togetherIds = together.show ? photoIdsForTogetherFilter(together, viewFilter) : null;
  const filteredPhotos =
    viewFilter === 'selected' || viewFilter === 'maybe'
      ? photos.filter((p) => myStatuses[p.id] === viewFilter)
      : togetherIds
      ? photos.filter((p) => togetherIds.includes(p.id))
      : photos;
  const isMySelected = (id: string) => myStatuses[id] === 'selected';
  const visiblePhotos = applyNavFilters(filteredPhotos, { chapterFilter, hideSimilar, isSelected: isMySelected });
  const burstsById = burstMembers(photos);
  const owner = participants.find((p) => p.isOwner);
  // מספר רץ קבוע לכל תמונה (מקום ברשימה המלאה, לא ברשימה המסוננת) - מוצג
  // ללקוחה במקום שם הקובץ המקורי (IMG_1234.JPG).
  const photoNumberById = new Map(photos.map((p, i) => [p.id, i + 1]));
  const isOwner = myParticipant?.isOwner ?? false;
  // "✨ כל תמונה נוספת: X ₪" - רק כשיש מחיר לתמונה נוספת
  const extraLabel = packageInfo && priceDisplay.showExtraCosts && Number(packageInfo.extraPrice) > 0 ? tr('info.extraPrice', { price: money(packageInfo.extraPrice) }) : null;
  const viewProgress = viewedProgress(viewedIds, photos.map((p) => p.id));
  // הפס התחתון הקבוע בגריד - רק לבעלים כשהבחירה פתוחה, ולא כשמסך מלא פתוח
  // (לתצוגה המוגדלת יש פס משלה).
  const showBottomBar = isOwner && !isLocked && !enlargedId && !slideshowActive && !swipeMode && !compareViewOpen;
  // ההודעות החולפות יושבות מעל מה שקבוע בתחתית המסך באותו רגע
  const notifyBottom = enlargedId
    ? 'calc(11rem + env(safe-area-inset-bottom))'
    : swipeMode
    ? 'calc(7.5rem + env(safe-area-inset-bottom))'
    : showBottomBar
    ? 'calc(4.25rem + env(safe-area-inset-bottom))'
    : 'calc(1rem + env(safe-area-inset-bottom))';

  // שורת הסינון ("הכל/נבחרו/אולי/ביחד") מופיעה רק כשיש מה לסנן: אחרי הסימון
  // הראשון, כשמישהו אחר כבר סימן, או בגלריה עם פרקים (הצ'יפים של הפרקים
  // עצמם - GalleryNavBar - גלויים מההתחלה). סינון פעיל תמיד נשאר גלוי.
  const othersHaveMarks = Object.values(allMarks).some((marks) => marks.some((m) => m.participantId !== myParticipant?.id));
  const showFilterRow = mySelectedCount + maybeCount > 0 || othersHaveMarks || together.show || chapters.length > 0 || viewFilter !== 'all';
  // "🪄 עזרי לי לבחור" - רק לבעלים כשהבחירה פתוחה (ראו handleAiPicks)
  const aiPicksAvailable = !isLocked && isOwner && photos.length > 0;
  // תפריט "⋯ עוד" (components/GalleryMoreMenu.tsx) - פעולות משניות במקום
  // שורת כפתורים; השפה נוספת בתוך התפריט עצמו
  const moreMenuItems: MoreMenuItem[] = [
    {
      key: 'compare',
      label: compareMode ? tr('hdr.exitCompare') : tr('hdr.compare'),
      onSelect: () => {
        setCompareMode((prev) => !prev);
        setCompareIds([]);
        setCompareViewOpen(false);
      },
    },
    ...(photos.length > 0 ? [{ key: 'slideshow', label: tr('act.slideshow'), onSelect: openSlideshow }] : []),
    ...(aiPicksAvailable && ownerSelectedCount > 0
      ? [{ key: 'ai', label: aiPicksRunning ? tr('act.aiRunning') : tr('act.aiHelp'), onSelect: handleAiPicks, disabled: aiPicksRunning }]
      : []),
    // האישור (window.confirm) נשאר בתוך clearAllSelections
    ...(!isLocked && (mySelectedCount > 0 || maybeCount > 0)
      ? [{ key: 'clear', label: clearingAll ? tr('act.clearing') : tr('act.clearAll'), onSelect: () => { clearAllSelections(); }, disabled: clearingAll, danger: true }]
      : []),
  ];

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
        dir={dir}
        lang={lang}
        style={{
          minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontFamily: theme.fontSans, padding: '1.5rem',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: 12, insetInlineEnd: 12, zIndex: 1 }}>
          <LanguagePicker lang={lang} onChange={changeLang} accent={accent} />
        </div>
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
            {tr('welcome.title', { nameSuffix: myParticipant ? `, ${myParticipant.displayName}` : '' })}
          </p>
          <p style={{ color: theme.textMuted, fontSize: 14, marginBottom: '1.5rem', lineHeight: 1.6 }}>
            {tr('welcome.ready')}
            {packageInfo ? tr('welcome.package', { n: packageInfo.included }) : ''}
            {expiresAt ? tr('welcome.until', { date: dateText(expiresAt) }) : ''}
            {tr('welcome.end')}
          </p>
          {/* שער פתיחה קצר: שורה אחת על הגלריה (+ שורת מתנות אם יש) וכפתור
              התחלה - ההסברים עצמם מופיעים בגריד ברגע שהם רלוונטיים */}
          {giftPhotos.length > 0 && (
            <p style={{ color: accent, fontSize: 14, marginTop: '-0.75rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              {tr('welcome.gifts', { count: giftPhotos.length })}
            </p>
          )}
          <button onClick={dismissWelcome} style={{ ...primaryButtonStyle, width: '100%' }}>
            {tr('welcome.start')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div dir={dir} lang={lang} style={{ background: theme.bg, minHeight: '100vh', color: theme.text, fontFamily: theme.fontSans }}>
      {/* עיצוב משותף לכותרת הדביקה (שורה דקה אחת בנייד, מתכווצת בגלילה למטה) -
          כ-CSS ולא inline כי צריך media queries ומצב מכווץ */}
      <style>{`
        .gh {
          position: sticky; top: 0; z-index: 50; backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: space-between;
          padding: 1rem 1.5rem; border-bottom: 1px solid ${theme.border}; flex-wrap: wrap; gap: 1rem;
          background: rgba(15,22,38,0.92); transition: padding 0.2s ease;
        }
        .gh-start { display: flex; gap: 0.75rem 1rem; align-items: center; font-size: 14px; flex-wrap: wrap; min-width: 0; }
        .gh-end { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }
        .gh-btn { padding: 0.35rem 0.75rem !important; font-size: 12px !important; white-space: nowrap; }
        .gh-ring {
          width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: bold; transition: width 0.2s ease, height 0.2s ease;
        }
        .gh-ring-inner {
          width: 34px; height: 34px; border-radius: 50%; background: ${theme.bg};
          display: flex; align-items: center; justify-content: center; transition: width 0.2s ease, height 0.2s ease;
        }
        @media (max-width: 640px) {
          .gh { padding: 0.45rem 0.75rem; gap: 0.3rem 0.5rem; }
          .gh-start { flex-wrap: nowrap; gap: 0.4rem; }
          .gh-who { display: none; }
          .gh-count-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
          .gh-btn { min-height: 40px; min-width: 40px; padding: 0.3rem 0.6rem !important; font-size: 13px !important; }
          .gh[data-compact="true"] { padding: 0.2rem 0.75rem; }
          .gh[data-compact="true"] .gh-btn { min-height: 34px; min-width: 34px; padding: 0.15rem 0.5rem !important; }
          .gh[data-compact="true"] .gh-ring { width: 30px; height: 30px; font-size: 9px; }
          .gh[data-compact="true"] .gh-ring-inner { width: 23px; height: 23px; }
        }
        /* גבהים לפי 100dvh (הגובה הנראה בפועל בנייד, בלי סרגל הכתובת) עם נפילה
           ל-vh בדפדפנים ישנים */
        .enl-img { max-height: calc(100vh - 13rem); max-height: calc(100dvh - 13rem); }
        .vh-45 { max-height: 45vh; max-height: 45dvh; }
        .vh-75 { max-height: 75vh; max-height: 75dvh; }
        .vh-80 { max-height: 80vh; max-height: 80dvh; }
        .vh-90 { max-height: 90vh; max-height: 90dvh; }
        /* גריד: אוטומטי במסך רחב; בנייד 2/3/4 עמודות לפי בחירה (▦, נשמר במכשיר) */
        .ggrid { display: grid; align-items: start; grid-template-columns: repeat(auto-fill, minmax(min(140px, 45vw), 1fr)); gap: 1rem; }
        .gcols-row { display: none; }
        @media (max-width: 640px) {
          .ggrid { grid-template-columns: repeat(var(--gcols, 2), minmax(0, 1fr)); gap: 0.6rem; }
          .ggrid[data-cols="3"] { gap: 0.4rem; }
          .ggrid[data-cols="4"] { gap: 0.3rem; }
          .ggrid[data-cols="3"] .gc-extra, .ggrid[data-cols="4"] .gc-extra { display: none; }
          .gcols-row { display: flex; }
        }
        /* תמונות הגריד נכנסות בהדרגה כשהן נטענות (data-loaded מ-onLoad/onError) */
        .gimg { opacity: 0; transition: opacity 0.35s ease; }
        .gimg[data-loaded="true"] { opacity: 1; }
        @media (prefers-reduced-motion: reduce) {
          .gh, .gh-ring, .gh-ring-inner, .gimg { transition: none; }
        }
      `}</style>
      <header className="gh" data-compact={headerCompact ? 'true' : 'false'}>
        <div className="gh-start">
          {myParticipant && (
            <span className="gh-who" style={{ color: theme.textFaint, fontSize: 12 }}>
              {tr('hdr.connectedAs', { name: myParticipant.displayName })}{isOwner ? '' : tr('hdr.family')}
            </span>
          )}
          {/* "⚡ בחירה מהירה" נשארת גלויה; כל השאר (השוואה, סקירה ברצף, ביטול
              הכל, שפה) בתפריט "⋯ עוד" אחד - components/GalleryMoreMenu.tsx */}
          {!readOnly && (
          <button
            className="gh-btn"
            onClick={() => (swipeMode ? exitSwipeMode() : startSwipeMode(1))}
            disabled={isLocked || photos.length === 0}
            style={{
              ...outlineButtonStyle,
              borderColor: swipeMode ? accent : theme.border, color: swipeMode ? accent : theme.textMuted,
              opacity: isLocked || photos.length === 0 ? 0.5 : 1,
            }}
          >
            {swipeMode ? tr('hdr.exitSwipe') : tr('hdr.swipe')}
          </button>
          )}
          <GalleryMoreMenu
            label={tr('hdr.more')}
            ariaLabel={tr('hdr.moreAria')}
            items={moreMenuItems}
            lang={lang}
            onLangChange={changeLang}
            languageLabel={tr('common.language')}
            accent={accent}
            buttonClassName="gh-btn"
          />
        </div>

        {/* מונה אחד בלבד: "X/Y בחבילה" + טבעת אחוזים. הספירות "נבחר/אולי" של
            הצופה/ה עצמו/ה מופיעות בשורת הסינון, וההתקדמות בצפייה - מתחתיה */}
        <div className="gh-end">
          <div style={{ textAlign: 'start', fontSize: 14, whiteSpace: 'nowrap' }}>
            <span className="gh-count-label">{tr('hdr.selectedInPackage')}{' '}</span>
            <bdi dir="ltr">
              <b style={{ color: accent, fontFamily: theme.fontSerif }}>{ownerSelectedCount}</b> / {packageInfo?.included ?? 0}
            </bdi>
          </div>
          <div
            className="gh-ring"
            aria-hidden="true"
            style={{
              color: accent, fontFamily: theme.fontSerif,
              background: `conic-gradient(${accentSolid} ${progressPct}%, ${theme.panelInput} ${progressPct}%)`,
            }}
          >
            <div className="gh-ring-inner">{progressPct}%</div>
          </div>
        </div>

        {/* מצב השוואה (נפתח מתפריט "⋯ עוד") - השורה בתוך הכותרת הדביקה, כדי
            ש"השוואה כעת" ו"יציאה" יהיו זמינים מכל מקום בגריד */}
        {compareMode && (
          <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: 13 }}>
            <span role="status" style={{ color: theme.textMuted }}>
              {tr('act.compareHint', { max: MAX_COMPARE, count: compareIds.length })}
            </span>
            {compareIds.length >= 2 && (
              <button
                onClick={() => setCompareViewOpen(true)}
                style={{ ...primaryButtonStyle, padding: '0.4rem 1rem', minHeight: 40 }}
              >
                {tr('act.compareNow', { count: compareIds.length })}
              </button>
            )}
            <button
              onClick={() => {
                setCompareMode(false);
                setCompareIds([]);
                setCompareViewOpen(false);
              }}
              style={{ ...outlineButtonStyle, padding: '0.4rem 0.9rem', minHeight: 40 }}
            >
              {tr('act.exitCompare')}
            </button>
          </div>
        )}
      </header>

      {(isOffline || pendingCount > 0) && (
        <div role="status" aria-live="polite" style={{ padding: '0.5rem 1.5rem', background: theme.warningBg, color: theme.warningText, fontSize: 13, textAlign: 'center' }}>
          {isOffline && tr('off.noInternet')}
          {pendingCount > 0 ? tr('off.pending', { count: pendingCount }) : tr('off.keepGoing')}
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
            {rich('info.packageIncludes', { n: <b style={{ color: theme.text }}>{packageInfo.included}</b> })}
            {remaining > 0 && rich('info.remaining', { n: <b style={{ color: accent }}>{remaining}</b> })}
          </span>
        )}
        {/* מחיר תמונה נוספת מוצג מראש, לא רק אחרי שכבר חרגו מהחבילה */}
        {packageInfo && extraLabel && <span style={{ color: theme.text }}>{extraLabel}</span>}
        {packageInfo && priceDisplay.total != null && (
          <span>
            {priceDisplay.mode === 'agreed'
              ? rich('info.agreedTotal', { total: <b style={{ color: accent }}>{money(priceDisplay.total)}</b> })
              : rich('info.estimate', { total: <b style={{ color: accent }}>{money(priceDisplay.total)}</b> })}
            {priceDisplay.showBreakdown && (
              <span style={{ color: theme.textFaint }}>
                {tr('info.estimateBreakdown', { base: money(packageInfo.basePrice), extra: money(extraCost) })}
              </span>
            )}
          </span>
        )}
        {expiresAt && !readOnly && (
          <span>
            {rich('info.until', { date: <b style={{ color: theme.text }}>{dateText(expiresAt)}</b> })}
          </span>
        )}
      </div>

      {/* ספירה לאחור (3 ימים ומטה) + "לבקש הארכה" לבעלת הגלריה בלבד - ראו components/ExtensionCountdownBanner.tsx */}
      <ExtensionCountdownBanner
        galleryId={galleryId}
        expiresAt={expiresAt}
        isOwner={isOwner}
        selectionOpen={!isLocked}
        accent={accent}
        gender={viewerGender}
        lang={lang}
      />

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
          {priceDisplay.showExtraCosts
            ? tr('over.banner', { selected: ownerSelectedCount, included: packageInfo.included, extra: overIncluded, cost: money(extraCost) })
            : tr('over.bannerNoCost', { selected: ownerSelectedCount, included: packageInfo.included, extra: overIncluded })}
        </div>
      )}

      {resumeOffer && (
        <div
          role="status"
          style={{
            margin: '0.6rem 1.5rem 0', padding: '0.4rem 0.5rem 0.4rem 0.75rem', borderRadius: 8,
            background: theme.panel, border: `1px solid ${accent}55`, color: theme.text, fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap',
          }}
        >
          <span>
            {rich('resume.text', { n: <bdi dir="ltr">{resumeOffer.index + 1}</bdi> })}
            {/* ההתקדמות בצפייה עברה מהכותרת לכאן (ולשורה העדינה מעל הגריד) */}
            {viewProgress.seen > 0 && (
              <span style={{ display: 'block', fontSize: 12, color: theme.textFaint }}>
                {rich('hdr.viewed', { seen: <bdi dir="ltr">{viewProgress.seen}</bdi>, total: <bdi dir="ltr">{viewProgress.total}</bdi> })}
              </span>
            )}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button type="button" onClick={resumeFromOffer} style={{ ...primaryButtonStyle, padding: '0.4rem 1.1rem', minHeight: 44 }}>
              {tr('resume.continue')}
            </button>
            <button
              type="button"
              onClick={() => setResumeOffer(null)}
              aria-label={tr('common.closeNotice')}
              style={{
                width: 44, height: 44, borderRadius: '50%', border: 'none',
                background: 'transparent', color: theme.textMuted, fontSize: 16, cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {!isLocked && (
      <p style={{ textAlign: 'center', fontSize: 12, color: theme.textFaint, padding: '0.5rem 1.5rem 0' }}>
        {rich('grid.hint', { heart: <span style={{ color: accent }}>♡</span> })}
      </p>
      )}

      {readOnly && (
        <div
          role="note"
          style={{
            margin: '0.75rem 1.5rem 0', padding: '0.75rem 1rem', borderRadius: 8, textAlign: 'center',
            background: theme.panel, border: `1px solid ${theme.border}`, color: theme.textMuted, fontSize: 14,
          }}
        >
          {expiresAt ? tr('ro.endedWithDate', { date: dateText(expiresAt) }) : tr('ro.ended')}
        </div>
      )}

      {/* מסך תודה - מוצג ברגע שהקונפטי דועך (showCelebration חוזר ל-false), כדי
          שלא יתחרה איתו על תשומת הלב. לא חוסם את הגלריה שמתחתיו - "אפשר עדיין
          לצפות בתמונות" נשאר תקף כרגיל, זה רק פאנל בזרימת העמוד. */}
      {isLocked && !readOnly && !showCelebration && (
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
            {tr('thanks.title', { nameSuffix: myParticipant?.displayName ? `, ${myParticipant.displayName}` : '' })}
          </p>
          <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.7, maxWidth: 420, margin: '0 auto' }}>
            {photographerName ? tr('thanks.bodyNamed', { photographer: photographerName }) : tr('thanks.body')}
          </p>
          <p style={{ color: theme.textFaint, fontSize: 12, marginTop: '1rem' }}>
            {tr('thanks.viewOnly')}
          </p>
          {/* קולאז' מתנה אוטומטי (components/GiftCollage.tsx) - נשאר זמין במסך
              הזה כל עוד הגלריה פתוחה לצפייה, לא רק מיד אחרי הסיום */}
          <GiftCollage
            photos={photos}
            statuses={myStatuses}
            photographerName={photographerName}
            photographerLogo={photographerLogo}
            accent={accent}
            buttonStyle={primaryButtonStyle}
            fileLabel={myParticipant?.displayName ?? photographerName}
            refreshPhotos={async () => (await refreshGallerySilently())?.photos ?? null}
            lang={lang}
          />
          {/* "מה הבא?" + תשלום על התוספת (components/ClientProgressTracker.tsx) */}
          <ClientProgressTracker galleryId={galleryId} photographerName={photographerName} accent={accent} buttonStyle={primaryButtonStyle} lang={lang} gender={viewerGender} />
        </div>
      )}
      {readOnly && myParticipant && <ClientProgressTracker framed galleryId={galleryId} photographerName={photographerName} accent={accent} buttonStyle={primaryButtonStyle} lang={lang} gender={viewerGender} />}

      {/* תמונות ערוכות סופיות שהצלמת מסרה - עצמאי לגמרי מ-galleryStatus (יכול
          להופיע גם לפני שהלקוחה סיימה לבחור, אם הצלמת כבר מסרה חלק מהתמונות). */}
      {showReveal && deliveredPhotos.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reveal-title"
          onClick={closeReveal}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,12,22,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
            animation: 'revealFade 0.6s ease-out',
          }}
        >
          <style>{`@keyframes revealFade{from{opacity:0}to{opacity:1}}@keyframes revealUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}`}</style>
          <div onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', maxWidth: 360, width: '100%', animation: 'revealUp 0.8s ease-out' }}>
            {deliveredPhotos[0]?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={deliveredPhotos[0].url}
                alt=""
                style={{ width: '100%', maxHeight: '45vh', objectFit: 'cover', borderRadius: 14, border: `1px solid ${accent}88`, marginBottom: '1.25rem' }}
              />
            )}
            <p id="reveal-title" style={{ fontSize: 24, fontFamily: theme.fontSerif, color: theme.text, margin: '0 0 0.5rem' }}>
              {tr('reveal.title')}
            </p>
            <p style={{ color: theme.textMuted, fontSize: 14, margin: '0 0 1.25rem' }}>
              {tr('reveal.sub', { count: deliveredPhotos.length })}
            </p>
            <button onClick={closeReveal} autoFocus style={{ ...primaryButtonStyle, minHeight: 44, padding: '0.7rem 1.6rem', fontSize: 15 }}>
              {tr('reveal.cta')}
            </button>
          </div>
        </div>
      )}

      {deliveredPhotos.length > 0 && (
        <div
          id={DELIVERED_SECTION_ID}
          style={{
            margin: '1rem 1.5rem 0', padding: '1.5rem', borderRadius: 14,
            background: theme.panel, border: `1px solid ${accent}55`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <p style={{ fontSize: 18, fontFamily: theme.fontSerif, color: theme.text, marginBottom: '0.25rem' }}>
                {tr('dl.title')}
              </p>
              <p style={{ color: theme.textMuted, fontSize: 13 }}>
                {tr('dl.sub', { count: deliveredPhotos.length })}
              </p>
            </div>
            <button
              onClick={handleDownloadAllDelivered}
              disabled={downloadingZip}
              style={{ ...primaryButtonStyle, opacity: downloadingZip ? 0.6 : 1 }}
            >
              {downloadingZip ? tr('dl.preparingZip') : tr('dl.zipAll')}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(130px, 40vw), 1fr))', gap: '0.75rem' }}>
            {deliveredPhotos.map((photo) => (
              <div key={photo.id} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
                {photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt={photo.filename}
                    loading="lazy"
                    decoding="async"
                    className="gimg"
                    onLoad={markImageLoaded}
                    onError={(e) => {
                      markImageLoaded(e);
                      handleImageError(`delivered:${photo.id}`);
                    }}
                    style={{ width: '100%', height: 130, objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: 130, background: theme.panelInput }} />
                )}
                <button
                  onClick={() => handleDownloadDeliveredPhoto(photo)}
                  disabled={downloadingId === photo.id}
                  aria-label={tr('dl.downloadAria', { name: photo.filename })}
                  title={tr('dl.downloadTitle')}
                  style={{
                    position: 'absolute', bottom: 6, left: 6, right: 6, padding: '0.4rem', borderRadius: 8, minHeight: 44,
                    background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12,
                    opacity: downloadingId === photo.id ? 0.6 : 1,
                  }}
                >
                  {downloadingId === photo.id ? tr('dl.downloading') : tr('dl.download')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 13, color: theme.textFaint, padding: '0.75rem 1.5rem 0' }}>
        {tr('wm.note')}
      </p>

      <div style={{ padding: '0 1.5rem 1rem', textAlign: 'center' }}>
        {/* "🪄 עזרי לי לבחור" גלוי רק כל עוד לבעלים אין אף בחירה - אחר כך הוא
            בתפריט "⋯ עוד". רק לבעלים - השרת מחזיר 403 לאורחים (עלות AI לצלמת),
            ראו app/api/gallery/[id]/ai-picks */}
        {aiPicksAvailable && ownerSelectedCount === 0 && (
          <button
            onClick={handleAiPicks}
            disabled={aiPicksRunning}
            title={tr('act.aiTitle')}
            style={{ ...outlineButtonStyle, marginTop: '0.5rem', borderColor: theme.gold, color: theme.gold, opacity: aiPicksRunning ? 0.6 : 1 }}
          >
            {aiPicksRunning ? tr('act.aiRunning') : tr('act.aiHelp')}
          </button>
        )}

        {/* "סיימתי" / ספירת הביטול / "נסי שוב" של הבעלים - בפס התחתון הקבוע (למטה) */}

        {!isLocked && !isOwner && (
          <p style={{ fontSize: 13, color: theme.textFaint, marginTop: '0.75rem' }}>
            {trOwner('act.onlyOwnerFinal', { owner: ownerLabel(owner?.displayName) })}
          </p>
        )}
      </div>

      {compareMode && compareViewOpen && compareIds.length >= 2 && (
        <div
          ref={compareDialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={tr('cmp.aria')}
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
            title={tr('cmp.exit')}
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
                  decoding="async"
                  onError={() => handleImageError(photo.id)}
                  onContextMenu={(e) => e.preventDefault()}
                  className={compareIds.length > 2 ? 'vh-45' : 'vh-80'}
                  style={{
                    maxWidth: '100%', objectFit: 'contain', borderRadius: 6,
                    WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                  }}
                />
                {!isLocked && myParticipant && !isGiftPhoto(id) && (
                  <button
                    onClick={async () => {
                      await setPhotoStatus(id, 'selected');
                      setCompareMode(false);
                      setCompareIds([]);
                      setCompareViewOpen(false);
                    }}
                    style={{ ...primaryButtonStyle, padding: '0.5rem 1.25rem' }}
                  >
                    {tr('cmp.pick')}
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
              ref={swipeDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={tr('sw.summaryAria')}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 60,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '2rem', textAlign: 'center', gap: '1.1rem',
              }}
            >
              <p style={{ fontSize: 40, margin: 0 }}>🎉</p>
              <p style={{ fontSize: 22, fontFamily: theme.fontSerif, color: '#fff', margin: 0 }}>
                {isSecondPass ? tr('sw.doneSecond') : tr('sw.doneAll')}
              </p>
              {!isSecondPass && maybeCount > 0 && (
                <>
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, maxWidth: 320, margin: 0 }}>
                    {tr('sw.maybePrompt', { n: maybeCount })}
                  </p>
                  <button onClick={() => startSwipeMode(2)} style={{ ...primaryButtonStyle, minWidth: 240 }}>
                    {tr('sw.secondPass', { n: maybeCount })}
                  </button>
                </>
              )}
              <button
                onClick={exitSwipeMode}
                style={{ ...outlineButtonStyle, minWidth: 240, color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
              >
                {!isSecondPass && maybeCount > 0 ? tr('sw.noThanks') : tr('common.close')}
              </button>
            </div>
          );
        }

        const photo = photos.find((p) => p.id === swipeQueue[idx]);
        if (!photo) return null;

        const currentSwipeStatus = myMarks[photo.id]?.status;

        const swipeActionBtn = (bg: string, border: string) => ({
          width: 68, height: 68, borderRadius: '50%', fontSize: 30, cursor: 'pointer',
          background: bg, border: `1px solid ${border}`,
        });

        return (
          <div
            ref={swipeDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={tr('sw.aria', { i: idx + 1, total })}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 60,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
              padding: '1.1rem 1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 480 }}>
              <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>
                {swipePass === 2 ? tr('sw.labelSecond') : tr('sw.label')}<bdi dir="ltr">{idx + 1}/{total}</bdi>
              </span>
              <span
                role="status"
                aria-live="polite"
                style={{
                  fontSize: 12, padding: '3px 10px', borderRadius: 12,
                  background: currentSwipeStatus === 'selected' ? accent : currentSwipeStatus === 'maybe' ? theme.green : 'rgba(255,255,255,0.12)',
                  color: currentSwipeStatus === 'selected' ? accentText : currentSwipeStatus === 'maybe' ? theme.goldText : 'rgba(255,255,255,0.8)',
                }}
              >
                {currentSwipeStatus === 'selected' ? tr('status.selected') : currentSwipeStatus === 'maybe' ? tr('status.maybeMarked') : tr('status.unmarked')}
              </span>
              <button
                onClick={exitSwipeMode}
                title={tr('common.close')}
                aria-label={tr('sw.closeAria')}
                style={{
                  width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.4)',
                  background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 16, cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 0 }}>
              {photo.thumbnailUrl && photo.fullUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.fullUrl}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onError={() => handleImageError(photo.id)}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', borderRadius: 8,
                    WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                  }}
                />
              ) : (
                <div style={{ width: 'min(80vw, 420px)' }}>
                  <ProcessingPlaceholder lang={lang} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => handleSwipeAction('skip')} aria-label={tr('sw.skipAria')} style={swipeActionBtn('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.3)')}>
                  👎
                </button>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{tr('sw.skip')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => handleSwipeAction('maybe')} aria-label={tr('sw.maybeAria')} style={swipeActionBtn(`${theme.green}33`, theme.green)}>
                  🤔
                </button>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{tr('sw.maybe')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => handleSwipeAction('selected')} aria-label={tr('sw.pickAria')} style={swipeActionBtn(`${accent}33`, accent)}>
                  👍
                </button>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{tr('sw.picked')}</span>
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
        const enlargedStatus = myStatuses[photo.id];
        const canMark = !isLocked && !!myParticipant && !photo.isGift;
        return (
          <div
            ref={enlargedDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={tr('en.aria', { n: currentIndex + 1 })}
            aria-describedby="enlarged-keyboard-hint"
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 50,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 2rem 11rem',
            }}
            // הקשה על הרקע רק סוגרת - אף פעם לא משנה בחירה. קליק שמגיע מיד
            // אחרי החלקה (דפדפנים מסוימים) לא נחשב הקשה.
            onClick={() => {
              if (Date.now() - enlargedLastSwipeAtRef.current < 400) return;
              setEnlargedId(null);
            }}
            // החלקה באצבע אחת ימינה/שמאלה = דפדוף (swipeNavDeltaForLang - לפי כיוון
            // השפה, אותה סמנטיקה כמו החצים). צביטה (שתי אצבעות) מבטלת את ההחלקה, ובזום אין החלקה
            // בכלל - שם התנועה שייכת לזום (ראו המאזינים ה-native על התמונה).
            onTouchStart={(e) => {
              if (e.touches.length !== 1) {
                enlargedSwipeStartRef.current = null;
                return;
              }
              enlargedSwipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }}
            onTouchEnd={(e) => {
              const start = enlargedSwipeStartRef.current;
              if (!start || e.touches.length > 0 || e.changedTouches.length === 0) return;
              enlargedSwipeStartRef.current = null;
              const t = e.changedTouches[0];
              const delta = swipeNavDeltaForLang(t.clientX - start.x, t.clientY - start.y, zoomScale > 1, lang);
              if (delta === 0) return;
              enlargedLastSwipeAtRef.current = Date.now();
              navigateEnlarged(delta);
            }}
            onTouchCancel={() => {
              enlargedSwipeStartRef.current = null;
            }}
          >
            <span id="enlarged-keyboard-hint" style={visuallyHiddenStyle}>
              {tr('en.kbd')}
              {canMark ? tr('en.kbdMark') : ''}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEnlargedId(null);
              }}
              title={tr('common.close')}
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
                title={tr('common.prev')}
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
                title={tr('common.next')}
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
                  position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 51,
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
              alt={tr('common.photoN', { n: currentIndex + 1 })}
              draggable={false}
              decoding="async"
              onError={() => handleImageError(photo.id)}
              onClick={(e) => {
                e.stopPropagation();
                if (Date.now() - enlargedLastSwipeAtRef.current < 400) return; // סוף החלקה, לא הקשה לזום
                setZoomScale((prev) => (prev > 1 ? 1 : 2));
              }}
              onContextMenu={(e) => e.preventDefault()}
              title={tr('en.zoomTitle')}
              className="enl-img"
              style={{
                // מקום לפס הבחירה הקבוע למטה (max-height ב-.enl-img, לפי 100dvh), כדי
                // שהכפתורים לא יכסו את התמונה
                maxWidth: '90vw', objectFit: 'contain', borderRadius: 6,
                transform: `scale(${zoomScale})`, transition: zoomScale === 1 ? 'transform 0.15s ease-out' : 'none',
                cursor: zoomScale > 1 ? 'zoom-out' : 'zoom-in',
                WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
              }}
            />

            {/* פס בחירה קבוע בתחתית, הרחק מהתמונה - כאן (ולא בהקשה על הכרטיס)
                בוחרים. קליקים/מגע בתוכו לא מגיעים לרקע (סגירה) או להחלקה. */}
            <div
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              style={{
                position: 'fixed', bottom: 0, insetInline: 0, zIndex: 52,
                background: 'rgba(15,22,38,0.96)', borderTop: `1px solid ${theme.border}`,
                padding: '0.6rem 1rem calc(0.75rem + env(safe-area-inset-bottom))',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
                color: theme.text,
              }}
            >
              <div aria-live="polite" style={{ fontSize: 13, color: theme.textMuted, textAlign: 'center' }}>
                <span>{rich('en.counter', { current: <bdi dir="ltr">{currentIndex + 1}</bdi>, total: <bdi dir="ltr">{photos.length}</bdi> })}</span>
                {packageInfo && (
                  <>
                    {' · '}{tr('en.selected')}{' '}
                    <bdi dir="ltr">
                      <b style={{ color: accent }}>{ownerSelectedCount}</b> / {packageInfo.included}
                    </bdi>
                    {overIncluded > 0 && (
                      <span style={{ color: accent }}>
                        {' · '}{tr('en.extra', { n: overIncluded })}{priceDisplay.showExtraCosts && extraCost > 0 ? tr('en.extraCost', { cost: money(extraCost) }) : ''}
                      </span>
                    )}
                  </>
                )}
                {!isOwner && myParticipant && <span>{' · '}{tr('en.guestMine', { n: mySelectedCount })}</span>}
              </div>
              {othersWhoSelected(allMarks[photo.id], myParticipant?.id).length > 0 && (
                <div style={{ fontSize: 12, color: accent, textAlign: 'center' }}>
                  {tr('en.othersPicked', {
                    names: othersWhoSelected(allMarks[photo.id], myParticipant?.id).join(', '),
                    count: othersWhoSelected(allMarks[photo.id], myParticipant?.id).length,
                  })}
                </div>
              )}

              {/* הערה לצלמת - עברה מהכרטיס בגריד לכאן (#14). הערה נשמרת רק על
                  תמונה מסומנת (השרת דוחה הערה על תמונה לא מסומנת). */}
              {canMark && enlargedStatus && (
                <button
                  type="button"
                  onClick={(e) => openNoteEditor(photo.id, e)}
                  aria-label={myMarks[photo.id]?.note ? tr('en.noteEditAria') : tr('en.noteAddAria')}
                  style={{
                    minHeight: 36, padding: '0.25rem 1rem', borderRadius: 18, cursor: 'pointer', fontSize: 13,
                    fontFamily: theme.fontSans, color: myMarks[photo.id]?.note ? accent : 'rgba(255,255,255,0.85)',
                    border: `1px solid ${myMarks[photo.id]?.note ? accent : 'rgba(255,255,255,0.3)'}`,
                    background: 'transparent',
                  }}
                >
                  {myMarks[photo.id]?.note ? tr('en.noteEdit') : tr('en.noteAdd')}
                </button>
              )}
              {canMark ? (
                <div style={{ display: 'flex', gap: '0.75rem', width: '100%', maxWidth: 480 }}>
                  <button
                    type="button"
                    aria-pressed={enlargedStatus === 'selected'}
                    aria-keyshortcuts="S"
                    title={tr('en.wantTitle')}
                    onClick={() => markEnlarged(photo.id, 'selected')}
                    style={{
                      flex: 2, minHeight: 52, borderRadius: 12, fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
                      fontFamily: theme.fontSans,
                      border: `2px solid ${enlargedStatus === 'selected' ? accent : 'rgba(255,255,255,0.45)'}`,
                      background: enlargedStatus === 'selected' ? accentSolid : 'rgba(255,255,255,0.08)',
                      color: enlargedStatus === 'selected' ? accentText : '#fff',
                    }}
                  >
                    {tr('en.want')}
                    {/* המצב עצמו מוכרז דרך aria-pressed - כאן רק חיזוק ויזואלי */}
                    {enlargedStatus === 'selected' && (
                      <span aria-hidden="true" style={{ display: 'block', fontSize: 12, fontWeight: 'normal' }}>
                        {tr('en.wantOn')}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-pressed={enlargedStatus === 'maybe'}
                    aria-keyshortcuts="M"
                    title={tr('en.maybeTitle')}
                    onClick={() => markEnlarged(photo.id, 'maybe')}
                    style={{
                      flex: 1, minHeight: 52, borderRadius: 26, fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
                      fontFamily: theme.fontSans,
                      border: `2px solid ${enlargedStatus === 'maybe' ? theme.green : 'rgba(255,255,255,0.45)'}`,
                      background: enlargedStatus === 'maybe' ? theme.green : 'rgba(255,255,255,0.08)',
                      color: enlargedStatus === 'maybe' ? theme.goldText : '#fff',
                    }}
                  >
                    {tr('en.maybe')}
                    {enlargedStatus === 'maybe' && (
                      <span aria-hidden="true" style={{ display: 'block', fontSize: 12, fontWeight: 'normal' }}>
                        {tr('en.maybeOn')}
                      </span>
                    )}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: photo.isGift ? accent : theme.textFaint, textAlign: 'center', maxWidth: 480 }}>
                  {photo.isGift ? (
                    <>
                      <b>{tr('en.giftFromMe')}</b>{tr('en.giftIncluded')}
                      {photo.giftMessage && <div style={{ fontStyle: 'italic', marginTop: 2, overflowWrap: 'anywhere', color: theme.text }}>"{photo.giftMessage}"</div>}
                    </>
                  ) : readOnly ? tr('ro.viewOnlyEnded') : isLocked ? tr('ro.viewOnlySent') : ''}
                </div>
              )}
            </div>
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
            ref={slideshowDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={tr('ss.aria', { i: currentIndex + 1, total })}
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
              title={tr('ss.exitTitle')}
              style={{
                position: 'absolute', top: 16, insetInlineEnd: 16, zIndex: 57,
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.5rem 1rem', borderRadius: 20, border: '1px solid rgba(255,255,255,0.4)',
                background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 14, cursor: 'pointer',
              }}
            >
              {tr('ss.exit')}
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
                title={tr('common.prev')}
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
                title={tr('common.next')}
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

            {photo.fullUrl && photo.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.fullUrl}
                alt={tr('common.photoN', { n: currentIndex + 1 })}
                draggable={false}
                decoding="async"
                onError={() => handleImageError(photo.id)}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
                className="vh-75"
                style={{
                  maxWidth: '90vw', objectFit: 'contain', borderRadius: 6,
                  WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                }}
              />
            ) : (
              <p style={{ color: theme.textMuted }} onClick={(e) => e.stopPropagation()}>
                {tr('common.processingStill')}
              </p>
            )}

            {!isLocked && myParticipant && !photo.isGift ? (
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
                  {status === 'maybe' ? tr('ss.maybeOn') : tr('ss.maybeOff')}
                </button>
                <button
                  onClick={() => slideshowMarkStatus(photo.id, 'selected')}
                  style={{
                    ...primaryButtonStyle, padding: '0.5rem 1.25rem',
                    opacity: status === 'selected' ? 1 : 0.85,
                  }}
                >
                  {status === 'selected' ? tr('ss.selectedOn') : tr('ss.select')}
                </button>
              </div>
            ) : (
              <p style={{ color: theme.textFaint, fontSize: 13, marginTop: '1.5rem' }} onClick={(e) => e.stopPropagation()}>
                {photo.isGift && !isLocked ? tr('ss.giftIncluded') : readOnly ? tr('ro.viewOnlyEnded') : tr('ro.viewOnlySent')}
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
              {tr('cele.done')}
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
            ref={noteDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-dialog-title"
            onClick={(e) => e.stopPropagation()}
            style={{ background: theme.panel, color: theme.text, padding: '1.25rem', borderRadius: 10, width: 320, border: `1px solid ${theme.border}` }}
          >
            <label htmlFor="note-text" id="note-dialog-title" style={{ display: 'block', fontFamily: theme.fontSerif, fontSize: 17, marginBottom: '0.75rem' }}>
              {tr('note.title')}
            </label>

            {/* תגובת הצלמת להערה - לקריאה בלבד, מוצגת רק אם קיימת (ראו
                app/api/galleries/[id]/photos/[photoId]/reply/route.ts) */}
            {myMarks[noteEditingId]?.photographerReply && (
              <div style={{ background: theme.panelInput, borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: 13 }}>
                <div style={{ color: theme.textFaint, fontSize: 11, marginBottom: '0.25rem' }}>
                  {tr('note.reply', { name: photographerName ?? tr('common.photographer') })}
                </div>
                {myMarks[noteEditingId]?.photographerReply}
              </div>
            )}

            <textarea
              id="note-text"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value.slice(0, NOTE_MAX_LENGTH))}
              rows={3}
              maxLength={NOTE_MAX_LENGTH}
              aria-describedby="note-char-count"
              style={{ ...inputStyle, width: '100%' }}
              placeholder={tr('note.placeholder')}
              autoFocus
            />
            <div
              id="note-char-count"
              style={{ fontSize: 11, color: noteDraft.length >= NOTE_MAX_LENGTH ? theme.errorText : theme.textFaint, textAlign: 'end', marginTop: 2 }}
            >
              <bdi dir="ltr">{noteDraft.length}/{NOTE_MAX_LENGTH}</bdi>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button onClick={saveNote} style={{ ...goldButtonStyle, padding: '0.5rem 1rem' }}>{tr('common.save')}</button>
              <button onClick={() => setNoteEditingId(null)} style={{ ...outlineButtonStyle, padding: '0.5rem 1rem' }}>{tr('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {showFilterRow && (
      <div id="gallery-filter-row" style={{ display: 'flex', gap: '0.5rem', padding: '0 1.5rem 0.75rem', justifyContent: 'center', flexWrap: 'wrap', scrollMarginTop: 96 }}>
        {([
          { key: 'all', label: tr('f.all', { n: photos.length }) },
          { key: 'selected', label: tr('f.selected', { n: mySelectedCount }) },
          { key: 'maybe', label: tr('f.maybe', { n: maybeCount }) },
          // "בוחרים ביחד" - רק כשיש לפחות 2 משתתפים עם סימונים
          ...(together.show
            ? [
                { key: 'together', label: tr('f.together', { n: together.everyone.length }) },
                ...together.onlyOthers.map((o) => ({ key: onlyParticipantKey(o.participantId), label: tr('f.only', { name: o.displayName, n: o.photoIds.length }) })),
                { key: 'onlyMe', label: tr('f.onlyMe', { n: together.onlyMe.length }) },
              ]
            : []),
        ]).map((f) => (
          <button
            key={f.key}
            aria-pressed={viewFilter === f.key}
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
      )}

      {/* כמה תמונות כבר נפתחו במסך מלא (מקומי, למכשיר הזה) - שורה עדינה
          מתחת לסינון, במקום מונה נוסף בכותרת */}
      {!isLocked && viewProgress.seen > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0 1.5rem 0.6rem', fontSize: 11, color: theme.textFaint }}>
          <span>
            {rich('hdr.viewed', { seen: <bdi dir="ltr">{viewProgress.seen}</bdi>, total: <bdi dir="ltr">{viewProgress.total}</bdi> })}
          </span>
          <div
            role="progressbar"
            aria-label={tr('hdr.viewedAria')}
            aria-valuemin={0}
            aria-valuemax={viewProgress.total}
            aria-valuenow={viewProgress.seen}
            style={{ width: 60, height: 3, borderRadius: 2, background: theme.panelInput, overflow: 'hidden' }}
          >
            <div style={{ width: `${viewProgress.pct}%`, height: '100%', background: accentSolid }} />
          </div>
        </div>
      )}

      <GalleryNavBar
        chapters={chapters}
        photos={photos}
        chapterFilter={chapterFilter}
        onChapterFilter={setChapterFilter}
        viewedIds={viewedIds}
        isSelected={isMySelected}
        hasBursts={burstsById.size > 0}
        hideSimilar={hideSimilar}
        onHideSimilar={setHideSimilar}
        accent={accent}
      />
      {burstChooserId && burstsById.has(burstChooserId) && (
        <BurstChooser
          photos={burstsById.get(burstChooserId)!}
          photoNumberById={photoNumberById}
          isSelected={isMySelected}
          onPick={
            !isLocked && myParticipant
              ? (id) => {
                  if (!isMySelected(id)) setPhotoStatus(id, 'selected');
                  setBurstChooserId(null);
                }
              : null
          }
          onClose={() => setBurstChooserId(null)}
          accent={accentSolid}
          accentText={accentText}
        />
      )}

      {visiblePhotos.length === 0 && (
        <p style={{ textAlign: 'center', color: theme.textFaint, fontSize: 13, padding: '1rem' }}>
          {tr('grid.empty')}
        </p>
      )}

      {/* ▦ מספר עמודות בנייד (2/3/4) - מוצג רק במסך צר (.gcols-row) */}
      <div className="gcols-row" style={{ justifyContent: 'flex-end', padding: '0 1rem 0.5rem' }}>
        <button
          type="button"
          onClick={cycleMobileCols}
          aria-label={tr('grid.colsAria', { n: mobileCols })}
          title={tr('grid.colsAria', { n: mobileCols })}
          style={{ ...outlineButtonStyle, minHeight: 40, minWidth: 44, padding: '0.25rem 0.7rem', fontSize: 13 }}
        >
          <span aria-hidden="true">▦ <bdi dir="ltr">{mobileCols}</bdi></span>
        </button>
      </div>

      <div
        className="ggrid"
        data-cols={mobileCols}
        style={{
          ['--gcols' as string]: mobileCols,
          // מקום לפס התחתון הקבוע, כדי שלא יכסה את השורה האחרונה
          padding: showBottomBar ? '0 1.5rem calc(4.5rem + env(safe-area-inset-bottom))' : '0 1.5rem 1.5rem',
        }}
      >
        {visiblePhotos.map((photo) => {
          const status = myStatuses[photo.id]; // undefined | 'maybe' | 'selected'
          const isComparing = compareIds.includes(photo.id);
          const hasNote = !!myMarks[photo.id]?.note;
          const othersMarks = (allMarks[photo.id] ?? []).filter((m) => m.participantId !== myParticipant?.id);
          const isGift = !!photo.isGift;
          const photoNumber = photoNumberById.get(photo.id) ?? 0;
          const photoLabel = tr('common.photoN', { n: photoNumber });

          const borderColor = isComparing
            ? theme.compare
            : isGift
            ? accent
            : status === 'selected'
            ? accent
            : status === 'maybe'
            ? theme.green
            : 'transparent';

          const isSelected = status === 'selected';
          // הלב בפינה = נבחרה <-> כלום בלבד; "אולי" מוצג בתג הסטטוס, לא בלב
          const heartBg = isSelected ? accent : 'rgba(10,10,11,0.6)';
          const heartColor = isSelected ? accentText : '#fff';
          const showStatusBadge = !!status && !isGift;

          // תיאור נגיש לקורא מסך - הסטטוס מוכרז על הקבוצה (הכרטיס), והפעולות
          // עצמן הן כפתורים אמיתיים נפרדים (פתיחה / לב / הערה), בלי role מקונן.
          const statusLabel = isGift
            ? tr('status.giftPlain')
            : status === 'selected' ? tr('status.selectedPlain') : status === 'maybe' ? tr('status.maybePlain') : tr('status.unmarked');
          const canOpen = !!photo.thumbnailUrl && !!photo.fullUrl;
          const mainButtonLabel = compareMode
            ? `${photoLabel}, ${isComparing ? tr('card.compareOn') : tr('card.compareOff')}`
            : tr('card.open', { label: photoLabel });

          // הקשה/Enter על הכרטיס רק פותחת את התמונה בגדול - הבחירה עצמה בפס
          // שבתצוגה המוגדלת או בלב שבפינה. במצב השוואה - בחירה להשוואה כמו קודם.
          function handleCardActivate(e: React.MouseEvent) {
            if (compareMode) return toggleCompareSelect(photo.id, e);
            if (!canOpen) return;
            setZoomScale(1);
            setEnlargedId(photo.id);
          }

          return (
            <div
              key={photo.id}
              id={`photo-card-${photo.id}`}
              role="group"
              aria-label={`${photoLabel}, ${statusLabel}${hasNote ? tr('card.hasNote') : ''}`}
              onContextMenu={(e) => e.preventDefault()} // חסימת קליק ימני - הרתעה בלבד, לא הגנה אמיתית
              style={{
                position: 'relative',
                border: `2px solid ${borderColor}`,
                borderRadius: 6,
                overflow: 'hidden',
                background: theme.panel,
                boxShadow: isGift && !isComparing ? `0 0 0 3px ${accent}33, 0 8px 24px ${accent}40` : undefined,
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 1, pointerEvents: 'none',
                  background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 11,
                  padding: '1px 7px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {/* מספר רץ במקום שם הקובץ (מה שכבר נצפה נשמר ב-viewedIds - להתקדמות
                    ולפרקים, בלי אייקון על כל כרטיס) */}
                <bdi dir="ltr">{photoNumber}</bdi>
              </div>

              {showStatusBadge && (
                // סימון שלא תלוי רק בצבע: אייקון + טקסט, וצורה שונה - "נבחרה"
                // מרובע, "אולי" עגול
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute', bottom: 8, right: 8, zIndex: 1, pointerEvents: 'none',
                    fontSize: 12, fontWeight: 'bold', padding: '3px 8px', whiteSpace: 'nowrap',
                    border: '1px solid rgba(255,255,255,0.55)', boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                    ...(isSelected
                      ? { background: accentSolid, color: accentText, borderRadius: 3 }
                      : { background: theme.green, color: theme.goldText, borderRadius: 999 }),
                  }}
                >
                  {isSelected ? tr('status.selected') : tr('card.badgeMaybe')}
                </div>
              )}

              {/* רמז עדין ש"ייתכן שלא חדה" - בפינה העליונה מתחת למספר, הרחק
                  ממרכז התמונה (פנים), קטן ושקוף-למחצה */}
              {photo.possiblyBlurry && (
                <div
                  className="gc-extra"
                  role="img"
                  aria-label={tr('card.blurAria')}
                  title={tr('card.blurTitle')}
                  style={{
                    position: 'absolute', top: 30, right: 8, zIndex: 1, pointerEvents: 'none',
                    background: 'rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.9)', fontSize: 11, lineHeight: 1.4,
                    padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap',
                  }}
                >
                  <span aria-hidden="true">{tr('card.blurLabel')}</span>
                </div>
              )}

              {othersMarks.length > 0 && (
                <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, display: 'flex', gap: 2 }}>
                  {othersMarks.map((m) => (
                    <span
                      key={m.participantId}
                      role="img"
                      title={`${m.displayName}: ${m.status === 'selected' ? tr('card.markSelected') : tr('card.markMaybe')}`}
                      aria-label={`${m.displayName}: ${m.status === 'selected' ? tr('card.markSelected') : tr('card.markMaybe')}`}
                      style={{
                        width: 22, height: 22, borderRadius: '50%', fontSize: 12, fontWeight: 'bold',
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

              {isGift && (
                <div
                  title={tr('card.giftTitle')}
                  style={{
                    position: 'absolute', top: othersMarks.length > 0 ? 36 : 8, left: 8, zIndex: 1, pointerEvents: 'none',
                    background: accentSolid, color: accentText, fontSize: 12, fontWeight: 'bold',
                    padding: '4px 10px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.45)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.35)', whiteSpace: 'nowrap',
                  }}
                >
                  {tr('en.giftFromMe')}
                </div>
              )}

              {isGift && (
                <div
                  className="gc-extra"
                  style={{
                    // zIndex 0 - מעל התמונה, מתחת לשאר התגים/כפתורים (zIndex 1)
                    position: 'absolute', bottom: 0, insetInline: 0, zIndex: 0, pointerEvents: 'none',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.35) 70%, transparent)',
                    color: '#fff', fontSize: 12, lineHeight: 1.45, padding: '1.5rem 3.5rem 0.6rem 0.75rem',
                  }}
                >
                  {photo.giftMessage && (
                    <div style={{ fontStyle: 'italic', marginBottom: '0.2rem', overflowWrap: 'anywhere' }}>"{photo.giftMessage}"</div>
                  )}
                  <div style={{ fontSize: 10.5, opacity: 0.85 }}>{tr('card.giftFooter')}</div>
                </div>
              )}

              {/* מוסתר כשהבחירה נעולה/צפייה בלבד - הסטטוס עדיין מוצג בתג */}
              {!compareMode && !isGift && !isLocked && myParticipant && (
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={tr('card.heartAria', { label: photoLabel })}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelectedFromGrid(photo.id);
                  }}
                  title={isSelected ? tr('card.heartOn') : tr('card.heartOff')}
                  style={{
                    position: 'absolute', top: othersMarks.length > 0 ? 30 : 6, left: 6, zIndex: 1,
                    background: heartBg, border: '1px solid rgba(255,255,255,0.3)', color: heartColor,
                    borderRadius: '50%', width: 44, height: 44, fontSize: 18, padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}
                >
                  <span aria-hidden="true">{isSelected ? '♥' : '♡'}</span>
                </button>
              )}

              {/* הכפתור הראשי של הכרטיס - התמונה עצמה */}
              <button
                type="button"
                onClick={handleCardActivate}
                disabled={!compareMode && !canOpen}
                aria-pressed={compareMode ? isComparing : undefined}
                aria-label={mainButtonLabel}
                style={{
                  display: 'block', width: '100%', padding: 0, margin: 0, border: 'none',
                  background: 'transparent', color: 'inherit', font: 'inherit',
                  cursor: compareMode || canOpen ? 'pointer' : 'default',
                }}
              >
                {photo.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    // thumbnailUrl = תמונת הגריד הקטנה (480px) מה-API, או התצוגה הגדולה
                    // לתמונות ישנות. בלי srcset לתצוגה הגדולה: 480px כבר מכסה אריח של
                    // ~200px ב-x2, ו-2x היה מוריד את ה-2000px כמעט בכל טלפון.
                    src={photo.thumbnailUrl}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    className="gimg"
                    onLoad={markImageLoaded}
                    onError={(e) => {
                      markImageLoaded(e);
                      handleImageError(photo.id);
                    }}
                    style={{
                      // aspectRatio 'auto 4 / 3': שומר מקום (ורקע) עד שהתמונה נטענת ואז
                      // עובר ליחס האמיתי שלה - בלי זה אריחים שלא נטענו בגובה 0, כך שגם
                      // loading="lazy" טוען כמעט את כולם בבת אחת.
                      width: '100%', height: 'auto', aspectRatio: 'auto 4 / 3', background: theme.panelInput,
                      display: 'block', pointerEvents: 'none',
                      WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
                    }}
                  />
                ) : (
                  <ProcessingPlaceholder lang={lang} />
                )}
              </button>

              {!compareMode && photo.burstId && (
                <BurstBadge count={burstsById.get(photo.burstId)?.length ?? 0} onOpen={() => setBurstChooserId(photo.burstId ?? null)} />
              )}

              {/* כפתור ההערה עבר לתצוגה המוגדלת (#14) - בכרטיס נשאר רק סימון קטן
                  ולא אינטראקטיבי שיש הערה (מוכרז בתווית הכרטיס) */}
              {hasNote && !isGift && (
                <div
                  aria-hidden="true"
                  title={tr('card.noteTitle')}
                  style={{
                    position: 'absolute', bottom: 8, left: 8, zIndex: 1, pointerEvents: 'none',
                    width: 22, height: 22, borderRadius: '50%', fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: theme.goldBright, color: theme.goldText, boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                  }}
                >
                  ✎
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* פס תחתון קבוע בגריד (בעיקר לנייד): המונה + "סיימתי" / ספירת הביטול /
          "נסי שוב". רק לבעלים כשהבחירה פתוחה (showBottomBar). */}
      {showBottomBar && (
        <div
          style={{
            position: 'fixed', bottom: 0, insetInline: 0, zIndex: 45,
            background: 'rgba(15,22,38,0.96)', borderTop: `1px solid ${theme.border}`, backdropFilter: 'blur(12px)',
            padding: '0.35rem 1rem calc(0.35rem + env(safe-area-inset-bottom))',
          }}
        >
          <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            {finishCountdown !== null ? (
              <>
                <span role="status" aria-live="polite" style={{ color: theme.successText, fontSize: 14 }}>
                  {rich('bar.countdown', { n: <bdi dir="ltr">{finishCountdown}</bdi> })}
                </span>
                <button onClick={cancelFinish} style={{ ...outlineButtonStyle, minHeight: 40, padding: '0.3rem 1rem' }}>
                  {tr('bar.undo')}
                </button>
              </>
            ) : finishFailed ? (
              <>
                <span role="alert" style={{ color: theme.errorText, fontSize: 14 }}>{tr('bar.notSent')}</span>
                <span style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => submitFinish()}
                    disabled={finishing}
                    style={{ ...primaryButtonStyle, minHeight: 40, padding: '0.3rem 1rem', opacity: finishing ? 0.6 : 1 }}
                  >
                    {finishing ? tr('bar.sending') : tr('bar.retry')}
                  </button>
                  <button onClick={cancelFinish} disabled={finishing} style={{ ...outlineButtonStyle, minHeight: 40, padding: '0.3rem 0.9rem' }}>
                    {tr('common.cancel')}
                  </button>
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 15 }}>
                  <bdi dir="ltr">
                    <b style={{ color: accent, fontFamily: theme.fontSerif }}>{ownerSelectedCount}</b>
                    {packageInfo ? ` / ${packageInfo.included}` : ''}
                  </bdi>{' '}
                  {tr('bar.selected')}
                  {overIncluded > 0 && <span style={{ color: accent, fontSize: 13 }}>{tr('bar.extra', { n: overIncluded })}</span>}
                </span>
                <button
                  onClick={handleFinish}
                  disabled={finishing || ownerSelectedCount === 0}
                  title={ownerSelectedCount === 0 ? tr('bar.needOne') : undefined}
                  style={{
                    ...primaryButtonStyle, minHeight: 40, padding: '0.3rem 1.1rem', fontSize: 14,
                    opacity: finishing || ownerSelectedCount === 0 ? 0.5 : 1,
                  }}
                >
                  {finishing ? tr('bar.sending') : tr('bar.finish')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* חלון סיכום לפני השליחה לצלמת (במקום window.confirm) */}
      {finishModalOpen && isOwner && !isLocked && (() => {
        const summary = computeFinishSummary({
          selectedCount: ownerSelectedCount,
          included: packageInfo?.included ?? 0,
          extraPrice: packageInfo?.extraPrice ?? 0,
          maybeCount,
        });
        const rowStyle: React.CSSProperties = {
          display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.45rem 0',
          borderBottom: `1px solid ${theme.border}`, fontSize: 14,
        };
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 65, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
            onClick={() => setFinishModalOpen(false)}
          >
            <div
              ref={finishModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="finish-dialog-title"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={handleFinishModalKeyDown}
              className="vh-90"
              style={{
                background: theme.panel, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 14,
                padding: '1.25rem 1.25rem 1rem', width: '100%', maxWidth: 380, overflowY: 'auto',
              }}
            >
              <p id="finish-dialog-title" style={{ fontFamily: theme.fontSerif, fontSize: 20, margin: '0 0 0.75rem', textAlign: 'center' }}>
                {tr('fm.title')}
              </p>

              <div style={rowStyle}>
                <span>{tr('fm.selected')}</span>
                <b style={{ color: accent }}>{summary.selected}</b>
              </div>
              {packageInfo && (
                <div style={rowStyle}>
                  <span>{tr('fm.included')}</span>
                  <b>{summary.includedUsed}</b>
                </div>
              )}
              {packageInfo && summary.extraCount > 0 && (
                <div style={rowStyle}>
                  <span>{tr('fm.extra')}</span>
                  <b style={{ color: accent }}>
                    {priceDisplay.showExtraCosts && summary.extraPrice > 0 ? (
                      <bdi dir="ltr">{summary.extraCount} × {money(summary.extraPrice)} = {money(summary.extraCost)}</bdi>
                    ) : (
                      summary.extraCount
                    )}
                  </b>
                </div>
              )}
              {giftPhotos.length > 0 && (
                <div style={{ ...rowStyle, color: theme.textMuted }}>
                  <span>{tr('fm.gifts')}</span>
                  <b>{giftPhotos.length}</b>
                </div>
              )}
              {priceDisplay.mode === 'agreed' && priceDisplay.total != null && (
                <div style={rowStyle}>
                  <span>{tr('fm.agreedTotal')}</span>
                  <b style={{ color: accent }}>{money(priceDisplay.total)}</b>
                </div>
              )}
              {/* עם סכום ידני - הסכום שהשרת חישב (app/api/gallery/[id]/progress, כולל
                  amount_due_override ותשלומים שנרשמו), לא "N × מחיר" מהדפדפן */}
              <ClientPayButton
                compact
                galleryId={galleryId}
                amount={priceDisplay.showExtraCosts ? summary.extraCost : undefined}
                lang={lang}
                gender={viewerGender}
                accent={accent}
                buttonStyle={primaryButtonStyle}
              />

              {packageInfo && summary.remainingIncluded > 0 && (
                <p style={{ fontSize: 13, color: theme.textMuted, margin: '0.75rem 0 0' }}>
                  {rich('fm.remaining', { n: <b style={{ color: accent }}>{summary.remainingIncluded}</b> })}
                </p>
              )}

              {summary.undecidedMaybe > 0 && (
                <div
                  style={{
                    marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: 8,
                    background: theme.panelInput, fontSize: 13,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap',
                  }}
                >
                  <span>{tr('fm.undecided', { count: summary.undecidedMaybe })}</span>
                  <button type="button" onClick={reviewMaybesFromModal} style={{ ...outlineButtonStyle, minHeight: 44, padding: '0.3rem 0.9rem', fontSize: 13 }}>
                    {tr('fm.review')}
                  </button>
                </div>
              )}

              {pendingCount > 0 && (
                <p style={{ fontSize: 12, color: theme.warningText, margin: '0.75rem 0 0' }}>
                  {tr('fm.pending', { n: pendingCount })}
                </p>
              )}

              <p style={{ fontSize: 12, color: theme.textFaint, margin: '0.75rem 0 0' }}>
                {tr('fm.noUndo', { n: FINISH_UNDO_SECONDS })}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" onClick={confirmFinishFromModal} style={{ ...primaryButtonStyle, minHeight: 48 }}>
                  {tr('fm.send')}
                </button>
                <button type="button" onClick={() => setFinishModalOpen(false)} style={{ ...outlineButtonStyle, minHeight: 48 }}>
                  {tr('fm.backToChoosing')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* הודעות חולפות (components/useNotify.tsx) - מעל הפס התחתון, או מעל פס
          הבחירה בתצוגה המוגדלת / כפתורי הבחירה המהירה */}
      <NotifyHost
        notifier={notifier}
        bottom={notifyBottom}
        closeLabel={tr('common.closeNotice')}
        accent={accent}
        dir={dir}
      />
    </div>
  );
}
