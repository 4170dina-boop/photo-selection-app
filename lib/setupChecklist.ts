// רשימת "השלמת הגדרות" שמוצגת לצלמת בראש "היום" ו"הגלריות שלי"
// (components/SetupChecklist.tsx). לוגיקה טהורה: מקבלת את מה שה-API כבר
// מחזיר ומחליטה מה מסומן, מה מוצג כמידע בלבד ומתי הרשימה כולה מוסתרת.

// הכתובת הזמנית (sandbox) של Resend - שולחת רק לכתובת של בעלת החשבון ב-Resend,
// כך שמיילים ללקוחות לא באמת יוצאים עד שמגדירים דומיין מאומת.
export const RESEND_SANDBOX_FROM = 'onboarding@resend.dev';

// מקבלת גם צורת '"שם" <addr>' - משווים רק את הכתובת עצמה
export function isSandboxFromAddress(from: string | null | undefined): boolean {
  if (typeof from !== 'string') return false;
  const match = from.match(/<([^>]+)>/);
  const address = (match ? match[1] : from).trim().toLowerCase();
  return address === RESEND_SANDBOX_FROM;
}

export type ChecklistItemId = 'logo' | 'watermark' | 'package' | 'firstGallery' | 'payment' | 'emailDomain' | 'ai';

// task = משהו שהצלמת עצמה משלימה (נספר להתקדמות). info = מצב מערכת (משתני
// סביבה / דומיין) - מוצג רק כשיש בעיה, לא נספר ולא מונע את הסתרת הרשימה.
export interface ChecklistItem {
  id: ChecklistItemId;
  label: string;
  kind: 'task' | 'info';
  done: boolean;
  hint: string;
  href?: string;
}

export interface SetupChecklistInput {
  // GET /api/photographer (null = לא נטען)
  photographer: {
    logo_url?: string | null;
    watermark_text?: string | null;
    default_base_price?: number | string | null;
    default_extra_photo_price?: number | string | null;
    payment_bit_url?: string | null;
    payment_paybox_url?: string | null;
    payment_bank_details?: string | null;
    // false = העמודות של קישורי התשלום עוד לא קיימות -> לא מציגים את הסעיף
    payment_links_available?: boolean;
    [key: string]: unknown;
  } | null;
  // גלריות "אמיתיות" (בלי גלריית דוגמה). null = לא ידוע
  realGalleryCount: number | null;
  // GET /api/photographer/capabilities (null = לא נטען)
  capabilities: { ai: boolean; email: boolean; emailSandbox?: boolean | null } | null;
}

function hasText(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function positive(v: unknown): boolean {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

// אמצעי תשלום: כל שדה payment_* שיש בו ערך (גם אם יתווספו בעתיד שדות נוספים
// באותה תבנית שמות) - כך שהבדיקה לא צריכה להתעדכן עם כל אמצעי חדש.
function hasPaymentMethod(p: Record<string, unknown>): boolean {
  return Object.entries(p).some(([key, value]) => key.startsWith('payment_') && key !== 'payment_links_available' && hasText(value));
}

function paymentFieldsExist(p: Record<string, unknown>): boolean {
  if (p.payment_links_available === false) return false;
  return Object.keys(p).some((key) => key.startsWith('payment_') && key !== 'payment_links_available');
}

export function evaluateSetupChecklist(input: SetupChecklistInput): ChecklistItem[] {
  const p = input.photographer;
  if (!p) return [];
  const items: ChecklistItem[] = [];

  const hasLogo = hasText(p.logo_url);
  items.push({
    id: 'logo',
    label: 'לוגו',
    kind: 'task',
    done: hasLogo,
    hint: 'מוצג ללקוחות בגלריה ומשמש כסימן מים',
    href: '/dashboard/settings',
  });

  items.push({
    id: 'watermark',
    label: 'סימן מים',
    kind: 'task',
    // הלוגו עצמו הוא סימן המים המועדף (ראו lib/watermark.ts)
    done: hasLogo || hasText(p.watermark_text),
    hint: 'לוגו או טקסט שמוטבע על התמונות ללקוחה',
    href: '/dashboard/settings',
  });

  items.push({
    id: 'package',
    label: 'חבילת ברירת מחדל',
    kind: 'task',
    done: positive(p.default_base_price) || positive(p.default_extra_photo_price),
    hint: 'מחיר חבילה ותמונה נוספת - ממלא אוטומטית כל גלריה חדשה',
    href: '/dashboard/settings',
  });

  items.push({
    id: 'firstGallery',
    label: 'גלריה ראשונה',
    kind: 'task',
    done: (input.realGalleryCount ?? 0) > 0,
    hint: 'יוצרים גלריה ושולחים ללקוחה קישור וקוד',
    href: '/dashboard/galleries/new',
  });

  if (paymentFieldsExist(p)) {
    items.push({
      id: 'payment',
      label: 'אמצעי תשלום',
      kind: 'task',
      done: hasPaymentMethod(p),
      hint: 'ביט / PayBox / העברה בנקאית - מוצג ללקוחה על התוספת',
      href: '/dashboard/settings',
    });
  }

  const caps = input.capabilities;
  if (caps) {
    if (caps.email && caps.emailSandbox != null) {
      items.push({
        id: 'emailDomain',
        label: 'דומיין למיילים',
        kind: 'info',
        done: !caps.emailSandbox,
        hint: 'המיילים נשלחים מכתובת הבדיקה של Resend - צריך דומיין מאומת כדי שיגיעו ללקוחות',
      });
    }
    items.push({
      id: 'ai',
      label: 'מפתח AI',
      kind: 'info',
      done: caps.ai,
      hint: 'בלי ANTHROPIC_API_KEY אין "עזרי לי לבחור" ועיצוב גלריה עם AI',
    });
  }

  return items;
}

export interface ChecklistSummary {
  tasks: ChecklistItem[];
  // רק מידע שדורש תשומת לב (done=false)
  warnings: ChecklistItem[];
  doneCount: number;
  totalTasks: number;
  // כל המשימות הושלמו -> הרשימה מוסתרת (מידע לבד לא מחזיק אותה פתוחה)
  allDone: boolean;
}

export function summarizeChecklist(items: ChecklistItem[]): ChecklistSummary {
  const tasks = items.filter((i) => i.kind === 'task');
  const warnings = items.filter((i) => i.kind === 'info' && !i.done);
  const doneCount = tasks.filter((i) => i.done).length;
  return { tasks, warnings, doneCount, totalTasks: tasks.length, allDone: tasks.length > 0 && doneCount === tasks.length };
}
