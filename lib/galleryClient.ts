// עזרים טהורים לעמוד הגלריה של הלקוחה (app/gallery/[id]/page.tsx) - מופרדים
// מהקומפוננטה כדי שאפשר יהיה לבדוק אותם ב-vitest בלי DOM/React: תור הפעולות
// הממתינות (אופליין), סמן "בחירה מהירה", שמות קבצים ל-ZIP, נרמול קוד גישה,
// תאריך עברי לפי לוח השנה בישראל, וכיווני חצים ב-RTL.

import { israelDateString } from './israelTime';
import { toHebrewDateString } from './hebrewDate';

export type MarkStatus = 'maybe' | 'selected';

export type PendingAction =
  | { type: 'status'; photoId: string; status: MarkStatus | null }
  | { type: 'note'; photoId: string; note: string };

// אורך מקסימלי להערה בממשק (maxLength + מונה תווים).
export const NOTE_MAX_LENGTH = 1000;

// אחרי כמה זמן נתוני הגלריה נחשבים "ישנים" - ה-URLs החתומים תקפים שעה
// (SIGNED_URL_TTL_SECONDS ב-API), אז מרעננים קצת לפני שהם פגים.
export const GALLERY_STALE_MS = 50 * 60 * 1000;

export function isGalleryDataStale(fetchedAt: number | null, now: number, maxAgeMs = GALLERY_STALE_MS): boolean {
  if (fetchedAt === null) return false; // עוד לא נטען בכלל - הטעינה הראשונה מטפלת בזה
  return now - fetchedAt >= maxAgeMs;
}

export function actionsEqual(a: PendingAction, b: PendingAction): boolean {
  if (a.type !== b.type || a.photoId !== b.photoId) return false;
  if (a.type === 'status' && b.type === 'status') return a.status === b.status;
  if (a.type === 'note' && b.type === 'note') return a.note === b.note;
  return false;
}

// מוסיף פעולה לתור: מחליף פעולה קודמת מאותו סוג על אותה תמונה (רק המצב
// האחרון חשוב), ושומר שפעולת סטטוס של תמונה תמיד קודמת להערה של אותה
// תמונה - השרת דוחה הערה על תמונה שעוד לא סומנה (note/route.ts), אז אם
// ההערה תישלח לפני הסימון היא תיכשל.
export function enqueueAction(queue: PendingAction[], action: PendingAction): PendingAction[] {
  const next = queue.filter((a) => !(a.type === action.type && a.photoId === action.photoId));
  if (action.type === 'status') {
    const firstNoteIdx = next.findIndex((a) => a.type === 'note' && a.photoId === action.photoId);
    if (firstNoteIdx !== -1) {
      next.splice(firstNoteIdx, 0, action);
      return next;
    }
  }
  next.push(action);
  return next;
}

// אחרי ששליחה ישירה של פעולה הצליחה - פעולות ישנות מאותו סוג על אותה תמונה
// שעדיין בתור כבר לא רלוונטיות (ואם יישלחו אחר כך ידרסו את המצב החדש).
// ביטול סימון (status=null) מוחק בשרת גם את ההערה, אז גם הערות ממתינות
// לאותה תמונה נזרקות.
export function dropActionsAfterDirectSuccess(queue: PendingAction[], action: PendingAction): PendingAction[] {
  const dropAllForPhoto = action.type === 'status' && action.status === null;
  return queue.filter((a) => {
    if (a.photoId !== action.photoId) return true;
    if (dropAllForPhoto) return false;
    return a.type !== action.type;
  });
}

// מיזוג אחרי flush: התור בזיכרון (stored) נקרא מחדש מה-localStorage, כי
// בזמן שה-flush רץ ייתכן שנוספו/הוחלפו פעולות. מסירים ממנו רק את הפעולות
// שבאמת עובדו (processed), כל אחת פעם אחת, לפי שוויון מלא - פעולה שהוחלפה
// בינתיים בגרסה חדשה יותר נשארת.
export function reconcileQueueAfterFlush(stored: PendingAction[], processed: PendingAction[]): PendingAction[] {
  const toRemove = [...processed];
  const result: PendingAction[] = [];
  for (const action of stored) {
    const idx = toRemove.findIndex((p) => actionsEqual(p, action));
    if (idx !== -1) {
      toRemove.splice(idx, 1);
      continue;
    }
    result.push(action);
  }
  return result;
}

export function queueHasPhoto(queue: PendingAction[], photoId: string): boolean {
  return queue.some((a) => a.photoId === photoId);
}

export interface ClientMark {
  status: MarkStatus;
  note: string | null;
  photographerReply: string | null;
}

// אחרי טעינה מחדש מהשרת, מחילים מעל התשובה את מה שעוד ממתין בתור - אחרת
// רענון ברקע "מעלים" בחירות שנעשו אופליין ועוד לא נשלחו. selectedDelta הוא
// השינוי ב"נבחרו" (לבעלים בלבד, בלי מתנות) כדי שהמונה הרשמי יישאר עקבי.
export function applyPendingToMarks(
  marks: Record<string, ClientMark>,
  queue: PendingAction[],
  isGift: (photoId: string) => boolean = () => false
): { marks: Record<string, ClientMark>; selectedDelta: number } {
  const next: Record<string, ClientMark> = { ...marks };
  let selectedDelta = 0;
  for (const action of queue) {
    const existing = next[action.photoId];
    if (action.type === 'status') {
      const wasSelected = existing?.status === 'selected';
      if (action.status === null) {
        delete next[action.photoId];
      } else {
        next[action.photoId] = {
          status: action.status,
          note: existing?.note ?? null,
          photographerReply: existing?.photographerReply ?? null,
        };
      }
      const isSelected = action.status === 'selected';
      if (!isGift(action.photoId) && wasSelected !== isSelected) selectedDelta += isSelected ? 1 : -1;
    } else if (existing) {
      next[action.photoId] = { ...existing, note: action.note.trim() || null };
    }
  }
  return { marks: next, selectedDelta };
}

// "בחירה מהירה": מה קורה בהקשה. דילוג רק מקדם את הסמן ולא נוגע בסימון
// קיים. הסמן מתקדם מיד (לפני הרשת), והקשה על תמונה שבקשה עליה עדיין בדרך
// נדחית (מחזיר null) - כך הקשה כפולה מהירה לא מסמנת שתי תמונות או את אותה פעמיים.
export type SwipeChoice = 'skip' | MarkStatus;

export interface SwipeTapPlan {
  nextCursor: number;
  photoId: string;
  post: MarkStatus | null; // null = אין מה לשלוח (דילוג / כבר באותו סטטוס)
}

export function planSwipeTap(
  cursor: number,
  queue: string[],
  inFlight: ReadonlySet<string>,
  choice: SwipeChoice,
  currentStatus?: MarkStatus
): SwipeTapPlan | null {
  if (cursor < 0 || cursor >= queue.length) return null;
  const photoId = queue[cursor];
  if (inFlight.has(photoId)) return null;
  const post = choice === 'skip' || choice === currentStatus ? null : choice;
  return { nextCursor: cursor + 1, photoId, post };
}

// שם ייחודי בתוך ZIP: "a.jpg", "a (2).jpg", "a (3).jpg"... (בלי רגישות לאותיות
// גדולות/קטנות, כי מערכות קבצים רבות לא מבדילות). מוסיף לסט את השם שנבחר.
export function uniqueFileName(name: string, used: Set<string>): string {
  const clean = name.trim() || 'photo';
  const dot = clean.lastIndexOf('.');
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let candidate = clean;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${n})${ext}`;
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

// קוד הגישה מושווה כאותיות גדולות - מנרמלים לפני השליחה (מקלדות נייד
// מתחילות לפעמים באות קטנה/מוסיפות רווח).
export function normalizeAccessCode(raw: string): string {
  return raw.toUpperCase().trim();
}

// הודעת שגיאה מתשובת שרת שאולי אינה JSON (דף שגיאה של פרוקסי/Vercel וכו').
export function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    const msg = (body as { error: string }).error.trim();
    if (msg) return msg;
  }
  return fallback;
}

export function accessCodeFallbackError(status: number): string {
  if (status === 429) return 'יותר מדי ניסיונות - נסי שוב בעוד כמה דקות';
  if (status === 503) return 'השירות לא זמין כרגע - נסי שוב בעוד רגע';
  if (status === 401) return 'קוד גישה שגוי';
  if (status === 410) return 'תוקף הגלריה פג';
  return 'שגיאה באימות, נסי שוב';
}

// תאריך עברי לפי היום האזרחי בישראל (ולא לפי אזור הזמן של הדפדפן) - קודם
// מחשבים את התאריך הלועזי בישראל, ואז ממירים את *אותו יום* לתאריך עברי.
// צהריים מקומיים של אותו תאריך, כדי ש-Intl (באזור הזמן של הדפדפן) יקרא בדיוק את היום הזה.
export function hebrewDateInIsrael(date: Date): string {
  const israelDay = israelDateString(date);
  return toHebrewDateString(new Date(`${israelDay}T12:00:00`));
}

// בממשק RTL כפתור "הבאה" נמצא משמאל, אז חץ שמאלה = הבאה וחץ ימינה = הקודמת.
export function rtlArrowDelta(key: string): 1 | -1 | 0 {
  if (key === 'ArrowLeft') return 1;
  if (key === 'ArrowRight') return -1;
  return 0;
}

export function zipDownloadSummary(done: number, total: number): string {
  return `הורדו ${done} מתוך ${total} תמונות`;
}

// ---- תצוגה מוגדלת כמקום הבחירה (במקום מחזור אולי/נבחר בהקשה על הכרטיס) ----

export type PhotoStatus = 'maybe' | 'selected';

// כפתור "אני רוצה את זו" / "אולי" / הלב בפינה: לחיצה על הסטטוס הנוכחי
// מבטלת אותו, כל לחיצה אחרת קובעת אותו (גם מעבר ישיר מ"אולי" ל"נבחר").
export function toggleStatusTo(current: PhotoStatus | undefined, target: PhotoStatus): PhotoStatus | null {
  return current === target ? null : target;
}

// מעבר אוטומטי לתמונה הבאה - רק כשהלקוחה בדיוק סימנה "נבחרה" (לא בביטול,
// לא ב"אולי"), ורק אם יש תמונה הבאה; בתמונה האחרונה נשארים.
export function shouldAutoAdvance(next: PhotoStatus | null, index: number, total: number): boolean {
  return next === 'selected' && index >= 0 && index < total - 1;
}

// החלקה אופקית בתצוגה המוגדלת. RTL - באותה סמנטיקה של rtlArrowDelta ("הבאה"
// משמאל): גרירת התמונה ימינה (dx>0) חושפת את מה שמשמאל = הבאה (1), שמאלה =
// הקודמת (-1). לא נחשב החלקה כשהתמונה מוגדלת (זום/צביטה), כשהתנועה בעיקר
// אנכית, או מתחת לסף.
export const SWIPE_THRESHOLD_PX = 50;

export function swipeNavDelta(dx: number, dy: number, zoomed: boolean, threshold = SWIPE_THRESHOLD_PX): 1 | -1 | 0 {
  if (zoomed) return 0;
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx > 0 ? 1 : -1;
}

// מקלדת בתצוגה המוגדלת: S = נבחרה, M = אולי. לפי e.code (מיקום פיזי של
// המקש) כדי שיעבוד גם כשהמקלדת על עברית (ד / צ), ובלי Ctrl/Alt/Meta כדי לא
// לחטוף קיצורים של הדפדפן (Ctrl+S וכו').
export function enlargedShortcutStatus(e: { code: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): PhotoStatus | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.code === 'KeyS') return 'selected';
  if (e.code === 'KeyM') return 'maybe';
  return null;
}

// הודעת "חדש" חד-פעמית על שינוי ההתנהגות של הקשה על תמונה
export function tapHintKey(galleryId: string): string {
  return `gallery_tap_hint_v2_${galleryId}`;
}

// ---- טעינה מוקדמת בתצוגה המוגדלת ----

// כתובות התצוגה הגדולה של התמונה הבאה (ואחריה הקודמת) לפי סדר photos - אותו
// סדר שבו מנווטים בתצוגה המוגדלת ובסליידשואו - כדי שמעבר יהיה מיידי. בלי
// כפילויות ובלי התמונה הנוכחית עצמה.
export function neighborPrefetchUrls(
  photos: { id: string; fullUrl: string | null }[],
  currentId: string | null
): string[] {
  if (!currentId) return [];
  const i = photos.findIndex((p) => p.id === currentId);
  if (i === -1) return [];
  const current = photos[i].fullUrl;
  const urls: string[] = [];
  for (const p of [photos[i + 1], photos[i - 1]]) {
    const url = p?.fullUrl;
    if (url && url !== current && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

// ---- מספר עמודות בגריד בנייד (▦) ----

// העדפה למכשיר (localStorage, לא לכל גלריה): 2/3/4 עמודות במסך צר. במסך רחב
// הגריד נשאר אוטומטי.
export type GridCols = 2 | 3 | 4;
export const DEFAULT_GRID_COLS: GridCols = 2;
export const GRID_COLS_KEY = 'gallery_grid_cols';

export function parseGridCols(raw: string | null | undefined): GridCols {
  const n = Number(raw);
  return n === 2 || n === 3 || n === 4 ? n : DEFAULT_GRID_COLS;
}

// 2 -> 3 -> 4 -> 2
export function nextGridCols(current: GridCols): GridCols {
  return current === 4 ? 2 : ((current + 1) as GridCols);
}
