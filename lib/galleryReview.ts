// עזרים טהורים לחוויית הסקירה בגלריית הלקוחה (app/gallery/[id]/page.tsx):
// מחיר תמונה נוספת מראש, סיכום לפני "סיימתי" (חלון השליחה), ו"להמשיך
// מאיפה שעצרתי" (התמונה האחרונה שנצפתה + אילו תמונות כבר נצפו). בלי DOM/React,
// כדי שאפשר יהיה לבדוק ב-vitest.

// ---- מחיר תמונה נוספת ----

// סכום בשקלים לתצוגה: עד שתי ספרות אחרי הנקודה, בלי אפסים מיותרים (12, 12.5).
export function formatShekels(amount: number): string {
  const n = Number(amount) || 0;
  return String(Math.round(n * 100) / 100);
}

// "✨ כל תמונה נוספת: X ₪" - רק כשיש באמת מחיר לתמונה נוספת.
export function extraPriceLabel(extraPrice: number | null | undefined): string | null {
  const n = Number(extraPrice) || 0;
  if (n <= 0) return null;
  return `✨ כל תמונה נוספת: ${formatShekels(n)} ₪`;
}

// האם המונה בדיוק עבר עכשיו את מכסת החבילה (מ-<= כלולות ל-> כלולות).
// prev=null = עוד אין ערך קודם (טעינה ראשונה) - לא נחשב חציה, גם אם כבר
// מעל המכסה, כדי שלקוחה שחוזרת לגלריה לא תקבל הודעה על משהו שקרה מזמן.
export function crossedIncludedQuota(prev: number | null, next: number, included: number): boolean {
  if (prev === null || included < 0) return false;
  return prev <= included && next > included;
}

// ההודעה הקופצת על מחיר תמונה נוספת מוצגת פעם אחת בלבד לכל משתתפת בגלריה
export function extraPriceToastKey(galleryId: string, participantId: string): string {
  return `gallery_extra_price_toast_${galleryId}_${participantId}`;
}

// ---- סיכום לפני שליחה לצלמת ----

export interface FinishSummary {
  selected: number;
  includedUsed: number; // כמה מהנבחרות נכנסות במסגרת החבילה
  extraCount: number;
  extraPrice: number;
  extraCost: number;
  remainingIncluded: number; // כמה עוד אפשר לבחור בלי תוספת
  undecidedMaybe: number;
}

export function computeFinishSummary(params: {
  selectedCount: number;
  included: number;
  extraPrice: number;
  maybeCount: number;
}): FinishSummary {
  const selected = Math.max(0, params.selectedCount);
  const included = Math.max(0, params.included);
  const extraPrice = Math.max(0, Number(params.extraPrice) || 0);
  const extraCount = Math.max(0, selected - included);
  return {
    selected,
    includedUsed: Math.min(selected, included),
    extraCount,
    extraPrice,
    extraCost: extraCount * extraPrice,
    remainingIncluded: Math.max(0, included - selected),
    undecidedMaybe: Math.max(0, params.maybeCount),
  };
}

// "מלכודת פוקוס קלה" לחלון מודאלי: Tab מהאלמנט האחרון חוזר לראשון, ו-Shift+Tab
// מהראשון (או מהחלון עצמו, currentIndex=-1) עובר לאחרון. מחזיר את האינדקס
// שצריך לקבל פוקוס, או null כשאפשר לתת לדפדפן להמשיך כרגיל.
export function focusTrapIndex(currentIndex: number, count: number, shiftKey: boolean): number | null {
  if (count <= 0) return null;
  if (shiftKey) return currentIndex <= 0 ? count - 1 : null;
  if (currentIndex === -1 || currentIndex >= count - 1) return 0;
  return null;
}

// ---- להמשיך מאיפה שעצרתי ----

export interface ResumeState {
  lastPhotoId: string | null;
  // מהישנה לחדשה - כשעוברים את התקרה נזרקות הישנות ביותר
  viewed: string[];
}

// תקרה לגודל רשימת התמונות שנצפו (localStorage מוגבל, וגלריות ענק נדירות)
export const MAX_VIEWED_IDS = 2000;

export function resumeStateKey(galleryId: string, participantId: string): string {
  return `gallery_resume_${galleryId}_${participantId}`;
}

export function emptyResumeState(): ResumeState {
  return { lastPhotoId: null, viewed: [] };
}

// קריאה סלחנית - ערך פגום/ישן באחסון לא מפיל את העמוד
export function parseResumeState(raw: string | null, cap = MAX_VIEWED_IDS): ResumeState {
  if (!raw) return emptyResumeState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyResumeState();
    const lastPhotoId = typeof parsed.lastPhotoId === 'string' && parsed.lastPhotoId ? parsed.lastPhotoId : null;
    const viewed = Array.isArray(parsed.viewed)
      ? Array.from(new Set((parsed.viewed as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)))
      : [];
    return { lastPhotoId, viewed: viewed.slice(-cap) };
  } catch {
    return emptyResumeState();
  }
}

// רישום צפייה בתמונה: היא נהיית "האחרונה", ועוברת לסוף הרשימה (הכי חדשה).
// מחזיר את אותו אובייקט כשאין שינוי, כדי לחסוך כתיבה לאחסון.
export function recordPhotoView(state: ResumeState, photoId: string, cap = MAX_VIEWED_IDS): ResumeState {
  if (!photoId) return state;
  const viewed = state.viewed;
  if (state.lastPhotoId === photoId && viewed[viewed.length - 1] === photoId) return state;
  const next = viewed.filter((id) => id !== photoId);
  next.push(photoId);
  return { lastPhotoId: photoId, viewed: next.length > cap ? next.slice(next.length - cap) : next };
}

// הצעת "להמשיך מתמונה N?" - רק אם התמונה האחרונה עדיין בגלריה ואינה
// הראשונה (מהראשונה אין ממה "להמשיך"). index מבוסס 0.
export function resumeOffer(state: ResumeState, photoIds: string[]): { photoId: string; index: number } | null {
  if (!state.lastPhotoId) return null;
  const index = photoIds.indexOf(state.lastPhotoId);
  if (index <= 0) return null;
  return { photoId: state.lastPhotoId, index };
}

// "עברת על X מתוך Y תמונות" - רק תמונות שעדיין בגלריה נספרות
export function viewedProgress(viewed: ReadonlySet<string>, photoIds: string[]): { seen: number; total: number; pct: number } {
  const total = photoIds.length;
  let seen = 0;
  for (const id of photoIds) if (viewed.has(id)) seen++;
  return { seen, total, pct: total > 0 ? Math.round((seen / total) * 100) : 0 };
}
