// בקשות הארכה של תקופת הבחירה (טבלת gallery_extension_requests, ראו
// supabase/schema.sql) - לוגיקה טהורה בלי DB, כדי שהמגבלות (עד 2 בקשות
// לגלריה, עד 7 ימים לבקשה, בקשה אחת ממתינה בכל פעם), נוסח באנר הספירה
// לאחור וחישוב התוקף החדש ייבדקו ב-vitest וישותפו בין ה-API (אכיפה) לבין
// הממשק (הסתרה/הסבר).

import { isSelectionFinal, statusAfterExpiryChange } from '@/lib/galleryLifecycle';
import type { RowGuard } from '@/lib/rowGuard';
import {
  addDaysToDateString,
  daysBetweenDateStrings,
  israelDateString,
  israelEndOfDayIso,
} from '@/lib/israelTime';

// דרישה מפורשת של הצלמת: לכל היותר 2 בקשות לגלריה (בסך הכל, לא משנה אם
// אושרו או נדחו), וכל בקשה עד 7 ימים.
export const EXTENSION_MAX_REQUESTS = 2;
export const EXTENSION_MAX_DAYS = 7;
export const EXTENSION_DAY_OPTIONS = [2, 4, 7] as const;
// מכמה ימים לפני סוף הבחירה מוצג באנר האזהרה (וכפתור הבקשה)
export const EXTENSION_WARNING_DAYS = 3;

export const EXTENSION_LIMIT_REACHED_MESSAGE = 'כבר ביקשת הארכה פעמיים - לשאלות פני לצלמת';
export const EXTENSION_PENDING_MESSAGE = 'כבר שלחת בקשת הארכה - הצלמת תעדכן אותך בקרוב';

export type ExtensionRequestStatus = 'pending' | 'approved' | 'declined';

export interface ExtensionRequestRow {
  id: string;
  requested_days: number;
  status: string;
  created_at: string | null;
  decided_at?: string | null;
}

// ---------- ימים מבוקשים ----------

export type ParsedDays = { ok: true; days: number } | { ok: false; error: string };

// מספר שלם בין 1 ל-7 (תואם ל-check בטבלה). הממשק מציע 2/4/7, אבל השרת
// מקבל כל ערך חוקי בטווח - המגבלה האמיתית היא המקסימום.
export function parseRequestedDays(value: unknown): ParsedDays {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > EXTENSION_MAX_DAYS) {
    return { ok: false, error: `אפשר לבקש הארכה של 1 עד ${EXTENSION_MAX_DAYS} ימים` };
  }
  return { ok: true, days: n };
}

// ---------- סיכום מצב הבקשות של גלריה ----------

export interface ExtensionSummary {
  requestsUsed: number;
  maxRequests: number;
  pending: { id: string; days: number; createdAt: string | null } | null;
  lastDecision: { status: 'approved' | 'declined'; days: number; decidedAt: string | null } | null;
}

function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function summarizeExtensionRequests(rows: ExtensionRequestRow[]): ExtensionSummary {
  const pendingRow = rows
    .filter((r) => r.status === 'pending')
    .sort((a, b) => timeOf(a.created_at) - timeOf(b.created_at))[0];
  const decided = rows
    .filter((r) => r.status === 'approved' || r.status === 'declined')
    .sort((a, b) => timeOf(b.decided_at ?? b.created_at) - timeOf(a.decided_at ?? a.created_at))[0];
  return {
    requestsUsed: rows.length,
    maxRequests: EXTENSION_MAX_REQUESTS,
    pending: pendingRow
      ? { id: pendingRow.id, days: pendingRow.requested_days, createdAt: pendingRow.created_at ?? null }
      : null,
    lastDecision: decided
      ? {
          status: decided.status as 'approved' | 'declined',
          days: decided.requested_days,
          decidedAt: decided.decided_at ?? null,
        }
      : null,
  };
}

// ---------- האם מותר ליצור בקשה חדשה (אכיפה בשרת) ----------

export interface ExtensionGalleryState {
  status: string | null | undefined;
  expires_at: string | null | undefined;
  reopened_for_selection_at?: string | null;
  delivered_at?: string | null;
}

export type ExtensionRequestDecision = { ok: true } | { ok: false; httpStatus: 400 | 403 | 409; error: string };

export function decideNewExtensionRequest(params: {
  gallery: ExtensionGalleryState;
  isOwner: boolean;
  requestsUsed: number;
  hasPending: boolean;
}): ExtensionRequestDecision {
  const { gallery, isOwner, requestsUsed, hasPending } = params;
  // שיתוף גלריה משפחתי: רק הבעלים הרשומה (לא אורחים)
  if (!isOwner) {
    return { ok: false, httpStatus: 403, error: 'רק הלקוחה הראשית יכולה לבקש הארכה' };
  }
  if (!gallery.expires_at) {
    return { ok: false, httpStatus: 400, error: 'לגלריה הזו אין תאריך סיום לבחירה' };
  }
  if (isSelectionFinal(gallery) || gallery.delivered_at) {
    return { ok: false, httpStatus: 409, error: 'הבחירה כבר הסתיימה - אין צורך בהארכה' };
  }
  if (requestsUsed >= EXTENSION_MAX_REQUESTS) {
    return { ok: false, httpStatus: 409, error: EXTENSION_LIMIT_REACHED_MESSAGE };
  }
  if (hasPending) {
    return { ok: false, httpStatus: 409, error: EXTENSION_PENDING_MESSAGE };
  }
  return { ok: true };
}

// ---------- באנר הספירה לאחור (גלריית הלקוחה) ----------

// כמה ימים לוחיים (לפי שעון ישראל) נשארו עד יום הסיום. 0 = היום הוא היום
// האחרון. null = אין תאריך / תאריך לא תקין.
export function daysLeftInIsrael(expiresAt: string | null | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return null;
  return daysBetweenDateStrings(israelDateString(now), israelDateString(end));
}

export function deadlineWarningText(daysLeft: number): string {
  if (daysLeft <= 0) return '⏳ היום הוא היום האחרון לבחירה';
  if (daysLeft === 1) return '⏳ נשאר יום אחד לבחירה';
  return `⏳ נשארו ${daysLeft} ימים לבחירה`;
}

// null = לא מציגים באנר (אין תאריך, כבר עבר, או רחוק מ-3 ימים)
export function deadlineWarning(
  expiresAt: string | null | undefined,
  now: Date
): { daysLeft: number; text: string } | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end) || end <= now.getTime()) return null;
  const daysLeft = daysLeftInIsrael(expiresAt, now);
  if (daysLeft === null || daysLeft > EXTENSION_WARNING_DAYS) return null;
  return { daysLeft: Math.max(0, daysLeft), text: deadlineWarningText(daysLeft) };
}

// מה להציג מתחת לבאנר: כפתור בקשה, הודעת "ממתינה", הודעת מגבלה, או כלום.
// available=false = הטבלה עוד לא קיימת (המיגרציה לא רצה) או שהסטטוס לא נטען -
// מסתירים הכל בשקט.
export type ExtensionButtonMode = 'button' | 'pending' | 'limit_reached' | 'hidden';

export function extensionButtonMode(params: {
  available: boolean;
  isOwner: boolean;
  selectionOpen: boolean;
  requestsUsed: number;
  hasPending: boolean;
}): ExtensionButtonMode {
  if (!params.available || !params.isOwner || !params.selectionOpen) return 'hidden';
  if (params.hasPending) return 'pending';
  if (params.requestsUsed >= EXTENSION_MAX_REQUESTS) return 'limit_reached';
  return 'button';
}

// ---------- התוקף החדש אחרי אישור ----------

// N ימים מ-max(עכשיו, התוקף הנוכחי), עד סוף היום בשעון ישראל - אותה
// משמעות כמו תאריך שהצלמת בוחרת בטופס העריכה (israelEndOfDayIso). גלריה
// שתוקפה כבר פג מקבלת N ימים מהיום, לא מהתאריך שעבר.
export function computeExtendedDeadline(currentExpiresAt: string | null | undefined, days: number, now: Date): string {
  const current = currentExpiresAt ? new Date(currentExpiresAt).getTime() : NaN;
  const base = !Number.isNaN(current) && current > now.getTime() ? new Date(current) : now;
  return israelEndOfDayIso(addDaysToDateString(israelDateString(base), days));
}

// תכנון עדכון הגלריה באישור בקשה: התוקף החדש, הסטטוס שחוזרים אליו אם
// הגלריה כבר סומנה expired (statusAfterExpiryChange - אותה לוגיקת החזרה
// לפעילה כמו עריכת התוקף בטופס, app/api/galleries/[id]/route.ts), ותנאי
// ה-UPDATE המותנה: status וגם expires_at כפי שנקראו - כך שסימון expired של
// ה-cron או שמירה מקבילה של טופס העריכה בין הקריאה לכתיבה לא נדרסים, אלא
// גורמים לקריאה מחדש וחישוב מחדש.
export function planExtensionApproval(params: {
  status: string | null | undefined;
  expiresAt: string | null | undefined;
  days: number;
  ownerHasSelections: boolean;
  now: Date;
}): { newExpiresAt: string; reactivatedStatus: 'sent' | 'in_progress' | null; guard: RowGuard } {
  const newExpiresAt = computeExtendedDeadline(params.expiresAt, params.days, params.now);
  const reactivatedStatus = statusAfterExpiryChange({
    status: params.status,
    oldExpiresAt: params.expiresAt,
    newExpiresAt,
    ownerHasSelections: params.ownerHasSelections,
    now: params.now,
  });
  return {
    newExpiresAt,
    reactivatedStatus,
    guard: { status: params.status ?? null, expires_at: params.expiresAt ?? null },
  };
}

// ---------- זיהוי "הטבלה עוד לא קיימת" ----------

// Postgres: 42P01 (undefined_table). PostgREST: PGRST205 (לא נמצאה בסכמה).
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const msg = error.message ?? '';
  return /gallery_extension_requests/.test(msg) && /(does not exist|could not find)/i.test(msg);
}
