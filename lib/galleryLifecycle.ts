// לוגיקה טהורה של מחזור החיים של גלריה (בחירה -> סיום -> עריכה -> מסירה ->
// מחיקת מקור) - בלי DB, כדי שההחלטות "מה מותר עכשיו" ייבדקו ב-vitest וישותפו
// בין ה-API (אכיפה) לבין הדשבורד (הסתרה/הסבר).

import type { RowGuard } from '@/lib/rowGuard';

export interface GalleryLifecycleState {
  status: string | null | undefined;
  reopened_for_selection_at?: string | null;
}

// הבחירה של הלקוחה "סגורה" = היא סימנה "סיימתי לבחור" (completed), והצלמת לא
// פתחה לה אותה מחדש. רק אז יש בחירה סופית שאפשר לערוך ולמסור לפיה.
export function isSelectionFinal(gallery: GalleryLifecycleState): boolean {
  return gallery.status === 'completed' && !gallery.reopened_for_selection_at;
}

export const SELECTION_NOT_FINAL_MESSAGE =
  'אפשר למסור תמונות סופיות רק אחרי שהלקוחה סיימה לבחור (והבחירה לא פתוחה מחדש) - מסירה מתחילה את ספירת 30 הימים עד מחיקת תמונות המקור.';

// מסירה (העלאת תמונות סופיות / סימון "נמסר") מתחילה את ספירת 30 הימים למחיקת
// המקור (app/api/cron/tick), אז מותרת רק כשהבחירה סופית.
export function canDeliverFinals(gallery: GalleryLifecycleState): boolean {
  return isSelectionFinal(gallery);
}

export const EDITING_REQUIRES_COMPLETED_MESSAGE = 'אפשר לסמן "בעריכה" רק אחרי שהלקוחה סיימה לבחור';

// סימון "בעריכה" מגיע אחרי שהלקוחה סיימה לבחור. ביטול סימון קיים תמיד מותר
// (למשל אחרי פתיחה מחדש של הבחירה), רק הדלקה דורשת completed.
export function canStartEditing(gallery: GalleryLifecycleState): boolean {
  return gallery.status === 'completed';
}

// ---------- הארכת תוקף לגלריה שפג תוקפה ----------

export interface ExpiryChangeInput {
  status: string | null | undefined;
  oldExpiresAt: string | null | undefined;
  newExpiresAt: string | null | undefined;
  ownerHasSelections: boolean;
  now: Date;
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

export function expiresAtChanged(oldExpiresAt: string | null | undefined, newExpiresAt: string | null | undefined): boolean {
  return timeOf(oldExpiresAt) !== timeOf(newExpiresAt);
}

// גלריה שה-cron סימן כ-expired חוזרת להיות פעילה כשהצלמת מאריכה את התוקף
// לעתיד (או מסירה אותו לגמרי). הסטטוס שחוזרים אליו משחזר את מה שהיה לפני
// התפוגה: in_progress אם הלקוחה (הבעלים) כבר בחרה, אחרת sent (כל גלריה
// נוצרת כ-sent, ראו app/api/galleries/route.ts). null = אין שינוי סטטוס.
export function statusAfterExpiryChange(input: ExpiryChangeInput): 'sent' | 'in_progress' | null {
  if (input.status !== 'expired') return null;
  const newTime = timeOf(input.newExpiresAt);
  if (input.newExpiresAt && newTime === null) return null;
  if (newTime !== null && newTime <= input.now.getTime()) return null;
  return input.ownerHasSelections ? 'in_progress' : 'sent';
}

// ---------- תזכורת מרוכזת ----------

export interface ReminderCandidate extends GalleryLifecycleState {
  expires_at: string | null;
}

// אותם תנאים כמו app/api/galleries/[id]/send-reminder: הלקוחה הוזמנה ועדיין
// בוחרת (sent/in_progress, או completed שנפתחה מחדש), ויש תוקף עתידי.
export function isReminderEligible(gallery: ReminderCandidate, now: Date): boolean {
  const inSelection =
    gallery.status === 'sent' ||
    gallery.status === 'in_progress' ||
    (gallery.status === 'completed' && !!gallery.reopened_for_selection_at);
  if (!inSelection) return false;
  const expires = timeOf(gallery.expires_at);
  return expires !== null && expires > now.getTime();
}

// ---------- פתיחה מחדש / נעילה של הבחירה (reopen-selection) ----------

export interface ReopenToggleState extends GalleryLifecycleState {
  originals_cleaned_up_at?: string | null;
}

export type ReopenToggleDecision =
  | {
      ok: true;
      newReopenedForSelectionAt: string | null;
      // תנאי ה-UPDATE המותנה: רק אם השורה עדיין במצב שעליו התקבלה ההחלטה.
      // בפתיחה - כולל originals_cleaned_up_at is null, הצד השני של התפיסה
      // המותנית של ה-cron (originalsCleanupClaimGuard ב-lib/cronTick.ts):
      // רק אחד מהשניים יכול להצליח על אותה שורה.
      guard: RowGuard;
    }
  | { ok: false; httpStatus: 400 | 409; error: string };

export const REOPEN_NOT_COMPLETED_MESSAGE = 'אפשר לפתוח מחדש רק גלריה שהבחירה בה כבר הושלמה';
export const REOPEN_ORIGINALS_DELETED_MESSAGE = 'אי אפשר לפתוח מחדש את הבחירה - תמונות המקור של הגלריה כבר נמחקו';
export const REOPEN_CONFLICT_MESSAGE = 'הגלריה השתנתה בינתיים - רענני את הדף ונסי שוב';

export function decideReopenToggle(gallery: ReopenToggleState, now: Date): ReopenToggleDecision {
  // נעילה בחזרה (reopened_for_selection_at -> null) תמיד מותרת - זו רק חזרה
  // למצב "הושלם" הרגיל. מותנית רק בכך שהסימון לא השתנה בינתיים.
  if (gallery.reopened_for_selection_at) {
    return {
      ok: true,
      newReopenedForSelectionAt: null,
      guard: { reopened_for_selection_at: gallery.reopened_for_selection_at },
    };
  }
  // פתיחה מחדש רלוונטית רק כשהבחירה באמת הושלמה - גלריה שעדיין בבחירה
  // (sent/in_progress) כבר פתוחה לעריכה כרגיל.
  if (gallery.status !== 'completed') {
    return { ok: false, httpStatus: 400, error: REOPEN_NOT_COMPLETED_MESSAGE };
  }
  // תמונות המקור נמחקות 30 יום אחרי המסירה (cron, originals_cleaned_up_at) -
  // אין יותר מה לבחור מתוכו.
  if (gallery.originals_cleaned_up_at) {
    return { ok: false, httpStatus: 409, error: REOPEN_ORIGINALS_DELETED_MESSAGE };
  }
  return {
    ok: true,
    newReopenedForSelectionAt: now.toISOString(),
    guard: { status: 'completed', reopened_for_selection_at: null, originals_cleaned_up_at: null },
  };
}

// ---------- עדכון מותנה בסטטוס (עריכת גלריה מול ה-cron) ----------

// שמירת עריכת גלריה מחשבת את הסטטוס החדש (statusAfterExpiryChange) לפי הסטטוס
// שנקרא. ה-cron יכול לסמן expired בין הקריאה לכתיבה - ואז הארכת התוקף הייתה
// נשמרת בלי להחזיר את הסטטוס, וגלריה עם תוקף עתידי נשארת expired. לכן העדכון
// מותנה בסטטוס שנקרא, ואם השתנה - קוראים מחדש ומחשבים שוב (מספר ניסיונות מוגבל).
export const STATUS_GUARDED_UPDATE_MAX_ATTEMPTS = 3;

export function statusGuard(status: string | null | undefined): RowGuard {
  return { status: status ?? null };
}

// ---------- העלאת תמונות מקור ----------

export interface OriginalsUploadState extends GalleryLifecycleState {
  expires_at?: string | null;
  originals_cleaned_up_at?: string | null;
}

// null = מותר להעלות. אחרת הודעה בעברית למה לא.
export function originalsUploadBlockReason(gallery: OriginalsUploadState, now: Date): string | null {
  if (gallery.originals_cleaned_up_at) {
    return 'תמונות המקור של הגלריה הזו כבר נמחקו אוטומטית אחרי המסירה - אי אפשר להעלות אליה תמונות מקור חדשות.';
  }
  if (isSelectionFinal(gallery)) {
    return 'הלקוחה כבר סיימה לבחור - כדי להעלות תמונות נוספות, פתחי לה קודם את הבחירה מחדש בדף עריכת הגלריה.';
  }
  const expires = timeOf(gallery.expires_at);
  const pastExpiry = expires !== null && expires < now.getTime();
  if (gallery.status === 'expired' || (gallery.status !== 'completed' && pastExpiry)) {
    return 'תוקף הגלריה פג - האריכי את התוקף בדף עריכת הגלריה לפני העלאת תמונות נוספות.';
  }
  return null;
}
