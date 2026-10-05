// לוגיקה טהורה של מחזור החיים של גלריה (בחירה -> סיום -> עריכה -> מסירה ->
// מחיקת מקור) - בלי DB, כדי שההחלטות "מה מותר עכשיו" ייבדקו ב-vitest וישותפו
// בין ה-API (אכיפה) לבין הדשבורד (הסתרה/הסבר).

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
