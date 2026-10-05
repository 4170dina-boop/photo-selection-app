import type { SupabaseClient } from '@supabase/supabase-js';
import { safeCompare } from './session';
import { isLockedOut, type LockoutState } from './accessLockout';

export function isGalleryExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  return !!expiresAt && new Date(expiresAt) < now;
}

export type GalleryWritableResult = { ok: true } | { ok: false; status: number; error: string };

// החלק הטהור של checkGalleryWritable (בלי I/O) - ראו ההסבר שם.
export function evaluateGalleryWritable(
  gallery: { status: string | null; expires_at: string | null; reopened_for_selection_at?: string | null } | null,
  now = new Date()
): GalleryWritableResult {
  if (!gallery) {
    return { ok: false, status: 404, error: 'גלריה לא נמצאה' };
  }
  if (isGalleryExpired(gallery.expires_at, now)) {
    return { ok: false, status: 410, error: 'תוקף הגלריה פג' };
  }
  // reopened_for_selection_at פתוח ע"י הצלמת (app/api/galleries/[id]/reopen-selection)
  // בלי לגעת ב-status עצמו - ראו ההערה על זה בשדה הזה ב-supabase/schema.sql.
  if (gallery.status === 'completed' && !gallery.reopened_for_selection_at) {
    return { ok: false, status: 403, error: 'הבחירה כבר נשלחה - אי אפשר לערוך אותה יותר' };
  }
  return { ok: true };
}

// בדיקה משותפת ל-selection/note/ai-picks routes: אחרי שהלקוחה לוחצת "סיימתי לבחור"
// (app/api/gallery/[id]/finish/route.ts) או שתוקף הגלריה פג, אסור לאפשר
// עוד שינויים - זה מה שהופך את "completed"/"expired" למשמעותיים בפועל,
// ולא רק תווית בדשבורד. חריג: reopened_for_selection_at מאפשר לצלמת לפתוח
// שוב בחירה שהושלמה בלי לשנות את status עצמו (ראו הערה בשדה ב-schema.sql) -
// תוקף שפג עדיין חוסם, גם אם נפתחה מחדש. גם גישת "צפייה בלבד" אחרי תפוגה
// (resolveGalleryViewAccess למטה) לא פותחת כתיבה - היא נחסמת כאן.
export async function checkGalleryWritable(
  supabaseAdmin: SupabaseClient,
  galleryId: string
): Promise<GalleryWritableResult> {
  const { data: gallery } = await supabaseAdmin
    .from('galleries')
    .select('status, expires_at, reopened_for_selection_at')
    .eq('id', galleryId)
    .single();

  return evaluateGalleryWritable(gallery ?? null);
}

export type GalleryViewAccess = { ok: true; readOnly: boolean } | { ok: false };

// האם מותר לפתוח (לצפייה) גלריה - לא לכתיבה. עד תפוגת התוקף: תמיד, ו-readOnly=false
// (נעילת "סיימתי לבחור" עצמה מיוצגת ב-status, לא כאן). אחרי התפוגה: רק אם
// הלקוחה כבר סיימה לבחור (completed) או שהצלמת כבר מסרה תמונות סופיות -
// אחרת הלקוחה לא הייתה יכולה להוריד את התמונות שקיבלה בגלל תאריך שעבר.
// במצב הזה readOnly=true, וכל ה-routes שכותבים עדיין חסומים ע"י checkGalleryWritable.
export function resolveGalleryViewAccess(
  gallery: { status: string | null; expires_at: string | null; delivered_at?: string | null },
  hasDeliveredPhotos: boolean,
  now = new Date()
): GalleryViewAccess {
  if (!isGalleryExpired(gallery.expires_at, now)) {
    return { ok: true, readOnly: false };
  }
  if (gallery.status === 'completed' || !!gallery.delivered_at || hasDeliveredPhotos) {
    return { ok: true, readOnly: true };
  }
  return { ok: false };
}

// עוטף את resolveGalleryViewAccess עם שאילתת delivered_photos - רק כשבאמת צריך
// (פג תוקף ואין כבר סימן אחר לזכאות), כדי לא להוסיף שאילתה לכל כניסה רגילה.
export async function loadGalleryViewAccess(
  supabaseAdmin: SupabaseClient,
  galleryId: string,
  gallery: { status: string | null; expires_at: string | null; delivered_at?: string | null }
): Promise<GalleryViewAccess> {
  let hasDeliveredPhotos = false;
  if (isGalleryExpired(gallery.expires_at) && gallery.status !== 'completed' && !gallery.delivered_at) {
    const { count } = await supabaseAdmin
      .from('delivered_photos')
      .select('id', { count: 'exact', head: true })
      .eq('gallery_id', galleryId);
    hasDeliveredPhotos = (count ?? 0) > 0;
  }
  return resolveGalleryViewAccess(gallery, hasDeliveredPhotos);
}

// שיתוף גלריה משפחתי - מגבלה רכה על מספר המשתתפים בגלריה אחת (כולל הבעלים),
// כדי שמי שיש לו את הקוד לא יוכל לנפח את gallery_participants בלי סוף.
export const MAX_PARTICIPANTS_PER_GALLERY = 20;

export type IdentifyDecision =
  | { kind: 'reject'; status: number; error: string }
  | { kind: 'reuse'; participantId: string }
  | { kind: 'owner' }
  | { kind: 'guest' };

// מה לעשות עם בקשת identify (app/api/gallery/[id]/identify/route.ts), לפי
// ה-session הנוכחי:
// - session שכבר משויך למשתתף/ת: לא יוצרים משתתף חדש בכל קריאה חוזרת, משתמשים
//   באותו participantId. ו-session של בן/בת משפחה (לא הבעלים) לא יכול "לשדרג"
//   את עצמו לבעלים ע"י asOwner=true.
// - session חדש (אחרי verify-access): "כן, זאת אני" -> הבעלים; אחרת אורח/ת חדש/ה.
export function decideIdentify(params: {
  sessionParticipantId: string | null;
  ownerParticipantId: string | null;
  asOwner: boolean;
}): IdentifyDecision {
  const { sessionParticipantId, ownerParticipantId, asOwner } = params;

  if (sessionParticipantId) {
    if (asOwner && sessionParticipantId !== ownerParticipantId) {
      return { kind: 'reject', status: 403, error: 'כבר נכנסת לגלריה בשם אחר - אי אפשר להחליף לבעלת הגלריה' };
    }
    return { kind: 'reuse', participantId: sessionParticipantId };
  }

  if (asOwner) {
    if (!ownerParticipantId) {
      return { kind: 'reject', status: 500, error: 'לא נמצא בעלים לגלריה' };
    }
    return { kind: 'owner' };
  }
  return { kind: 'guest' };
}

// גורם אימות שני ל"כן, זאת אני" (app/api/gallery/[id]/identify/route.ts): קוד
// הגישה משותף לכל המשפחה (הוא נשלח גם ל-additional_invite_emails), אז הוא לבד
// לא מוכיח שמי שנכנסה היא הלקוחה הרשומה. כדי לקבל זהות בעלים (סיום בחירה וכו')
// צריך להקליד גם את כתובת המייל שהצלמת רשמה ללקוחה (clients.email).
// השוואה בלי תלות ברישיות/רווחים בקצוות, ובזמן קבוע (safeCompare משווה
// hash-ים באורך קבוע, כך שגם אורך המייל הנכון לא דולף דרך תזמון התשובה).
export function normalizeEmailForCompare(email: string | null | undefined): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function ownerEmailMatches(expected: string | null | undefined, provided: string | null | undefined): boolean {
  const a = normalizeEmailForCompare(expected);
  const b = normalizeEmailForCompare(provided);
  // מחשבים את ההשוואה גם כשאחד מהם ריק, כדי שלא יהיה מסלול מהיר שונה בתזמון
  const same = safeCompare(a, b);
  return !!a && !!b && same;
}

export type OwnerClaimCheck =
  | { kind: 'ok' }
  | { kind: 'locked' }
  | { kind: 'missing' }
  | { kind: 'no_registered_email' }
  | { kind: 'mismatch' };

// ההחלטה הטהורה לגבי ניסיון "זאת אני": נעילה קודמת (owner_claim_locked_until -
// אותה לוגיקה של lib/accessLockout.ts, אבל מונה נפרד; ראו ההסבר ב-route) נבדקת
// קודם, כדי שגם מייל נכון לא יעבור בזמן נעילה. mismatch = ניסיון שגוי שצריך
// להירשם (register_failed_owner_claim). missing לא נספר כניסיון - זו בקשה
// שלא מולאה (למשל דף ישן שעוד לא שולח את השדה).
export function evaluateOwnerClaim(params: {
  lockout: LockoutState | null | undefined;
  registeredEmail: string | null | undefined;
  providedEmail: string | null | undefined;
  now?: Date;
}): OwnerClaimCheck {
  const { lockout, registeredEmail, providedEmail, now = new Date() } = params;
  if (isLockedOut(lockout, now)) return { kind: 'locked' };
  if (!normalizeEmailForCompare(providedEmail)) return { kind: 'missing' };
  if (!normalizeEmailForCompare(registeredEmail)) return { kind: 'no_registered_email' };
  return ownerEmailMatches(registeredEmail, providedEmail) ? { kind: 'ok' } : { kind: 'mismatch' };
}
