import { describe, it, expect } from 'vitest';
import {
  type NotifyItem,
  type NotifyType,
  NOTIFY_ACTION_BONUS_MS,
  NOTIFY_DURATION_MS,
  NOTIFY_MAX_QUEUE,
  NOTIFY_STALE_MS,
  enqueueNotification,
  notifyDuration,
  pickVisible,
  removeNotification,
  removeNotificationsByKey,
} from './notifyQueue';

function item(id: number, type: NotifyType, extra: Partial<NotifyItem> = {}): NotifyItem {
  return { id, type, message: `m${id}`, createdAt: 1000 + id, ...extra };
}

describe('pickVisible', () => {
  it('תור ריק - אין הודעה', () => {
    expect(pickVisible([])).toBeNull();
  });

  it('שגיאה > אזהרה > הצלחה > מידע', () => {
    expect(pickVisible([item(1, 'info'), item(2, 'success')])?.id).toBe(2);
    expect(pickVisible([item(1, 'success'), item(2, 'warning'), item(3, 'info')])?.id).toBe(2);
    expect(pickVisible([item(1, 'warning'), item(2, 'error'), item(3, 'success')])?.id).toBe(2);
  });

  it('באותה עדיפות - הוותיקה קודם', () => {
    expect(pickVisible([item(5, 'error'), item(3, 'error')])?.id).toBe(3);
  });
});

describe('enqueueNotification', () => {
  it('אותו key מחליף את הקודמת', () => {
    const q = enqueueNotification([item(1, 'error', { key: 'action' }), item(2, 'info')], item(3, 'error', { key: 'action' }));
    expect(q.map((i) => i.id)).toEqual([2, 3]);
  });

  it('בלי key - מצטבר', () => {
    const q = enqueueNotification([item(1, 'info')], item(2, 'info'));
    expect(q).toHaveLength(2);
  });

  it('תור מלא זורק את הפחות חשובה והוותיקה', () => {
    let q: NotifyItem[] = [];
    for (let i = 1; i <= NOTIFY_MAX_QUEUE; i++) q = enqueueNotification(q, item(i, i === 1 ? 'error' : 'info'));
    q = enqueueNotification(q, item(99, 'warning'));
    expect(q).toHaveLength(NOTIFY_MAX_QUEUE);
    expect(q.some((i) => i.id === 2)).toBe(false); // המידע הוותיק ביותר
    expect(q.some((i) => i.id === 1)).toBe(true); // השגיאה נשארת
  });

  it('הצלחה/מידע שהתיישנו בתור נזרקות, שגיאה לא', () => {
    const old = [item(1, 'success', { createdAt: 0 }), item(2, 'error', { createdAt: 0 })];
    const q = enqueueNotification(old, item(3, 'info', { createdAt: NOTIFY_STALE_MS + 1 }));
    expect(q.map((i) => i.id)).toEqual([2, 3]);
  });
});

describe('notifyDuration', () => {
  it('לפי סוג, עם תוספת לכפתור פעולה, ומשך מותאם גובר', () => {
    expect(notifyDuration({ type: 'error' })).toBe(NOTIFY_DURATION_MS.error);
    expect(notifyDuration({ type: 'success', action: { label: 'x', run: () => {} } })).toBe(NOTIFY_DURATION_MS.success + NOTIFY_ACTION_BONUS_MS);
    expect(notifyDuration({ type: 'info', durationMs: 1234 })).toBe(1234);
    expect(NOTIFY_DURATION_MS.error).toBeGreaterThan(NOTIFY_DURATION_MS.info);
  });
});

describe('remove', () => {
  it('לפי id ולפי key', () => {
    const q = [item(1, 'info', { key: 'a' }), item(2, 'error', { key: 'b' })];
    expect(removeNotification(q, 1).map((i) => i.id)).toEqual([2]);
    expect(removeNotificationsByKey(q, 'b').map((i) => i.id)).toEqual([1]);
  });
});
