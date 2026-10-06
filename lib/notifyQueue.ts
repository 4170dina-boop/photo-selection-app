// תור הודעות מאוחד לגלריית הלקוח/ה (components/useNotify.tsx): הצלחה/מידע/
// אזהרה/שגיאה, הודעה אחת גלויה בכל רגע לפי עדיפות (שגיאה > אזהרה > הצלחה >
// מידע), ובתוך אותה עדיפות - הוותיקה קודם. פונקציות טהורות בלבד (בלי React)
// כדי שאפשר יהיה לבדוק ב-vitest.

export type NotifyType = 'success' | 'info' | 'warning' | 'error';

export interface NotifyAction {
  label: string;
  run: () => void;
}

export interface NotifyItem {
  id: number;
  type: NotifyType;
  message: string;
  // הודעה חדשה עם אותו key מחליפה את הקודמת (למשל "שגיאת פעולה" אחת בלבד,
  // או עדכון "בני משפחה סימנו" שמתחלף בחדש) במקום להצטבר בתור
  key?: string;
  action?: NotifyAction;
  // משך מותאם במקום ברירת המחדל לפי סוג
  durationMs?: number;
  createdAt: number;
}

export const NOTIFY_PRIORITY: Record<NotifyType, number> = {
  error: 3,
  warning: 2,
  success: 1,
  info: 0,
};

// כמה זמן הודעה נשארת גלויה לפני שנעלמת לבד - שגיאות הכי הרבה, כדי שיהיה זמן
// לקרוא וללחוץ "נסי שוב"
export const NOTIFY_DURATION_MS: Record<NotifyType, number> = {
  info: 4500,
  success: 4000,
  warning: 7000,
  error: 10000,
};

// תוספת זמן להודעה עם כפתור פעולה ("בטל" / "נסי שוב") - צריך גם להגיע ללחוץ
export const NOTIFY_ACTION_BONUS_MS = 3000;

// לא שומרים יותר מזה בתור - הודעות ישנות בעדיפות נמוכה נזרקות קודם
export const NOTIFY_MAX_QUEUE = 5;

// הצלחה/מידע שחיכו בתור (כי שגיאה הוצגה לפניהן) יותר מזה כבר לא רלוונטיות
export const NOTIFY_STALE_MS = 20000;

export function notifyDuration(item: Pick<NotifyItem, 'type' | 'action' | 'durationMs'>): number {
  if (item.durationMs != null) return item.durationMs;
  return NOTIFY_DURATION_MS[item.type] + (item.action ? NOTIFY_ACTION_BONUS_MS : 0);
}

// ההודעה שמוצגת כרגע: העדיפות הגבוהה ביותר, ובתוכה הוותיקה ביותר
export function pickVisible(queue: readonly NotifyItem[]): NotifyItem | null {
  let best: NotifyItem | null = null;
  for (const item of queue) {
    if (!best) {
      best = item;
      continue;
    }
    const diff = NOTIFY_PRIORITY[item.type] - NOTIFY_PRIORITY[best.type];
    if (diff > 0 || (diff === 0 && item.id < best.id)) best = item;
  }
  return best;
}

// הוספה לתור: אותו key מחליף (ההודעה החדשה במקום הישנה), ותור מלא זורק את
// הפחות חשובה והוותיקה ביותר. הודעת הצלחה/מידע שהתיישנה בתור נזרקת.
export function enqueueNotification(queue: readonly NotifyItem[], item: NotifyItem, now: number = item.createdAt): NotifyItem[] {
  let next = queue.filter(
    (q) => (item.key == null || q.key !== item.key) && !(NOTIFY_PRIORITY[q.type] <= NOTIFY_PRIORITY.success && now - q.createdAt > NOTIFY_STALE_MS)
  );
  next = [...next, item];
  while (next.length > NOTIFY_MAX_QUEUE) {
    let drop = 0;
    for (let i = 1; i < next.length; i++) {
      const diff = NOTIFY_PRIORITY[next[i].type] - NOTIFY_PRIORITY[next[drop].type];
      if (diff < 0 || (diff === 0 && next[i].id < next[drop].id)) drop = i;
    }
    next = next.filter((_, i) => i !== drop);
  }
  return next;
}

export function removeNotification(queue: readonly NotifyItem[], id: number): NotifyItem[] {
  return queue.filter((q) => q.id !== id);
}

export function removeNotificationsByKey(queue: readonly NotifyItem[], key: string): NotifyItem[] {
  return queue.filter((q) => q.key !== key);
}
