import { describe, expect, it } from 'vitest';
import {
  buildTodayView,
  daysSince,
  editingProgress,
  gallerySections,
  isExpiringSoon,
  isSelectingNow,
  isStalled,
  lastClientActivityAt,
  sortShoots,
  todayAndTomorrow,
  wazeUrl,
  type TodayGallery,
} from './todayDashboard';

// 12:00 בישראל (שעון קיץ, +03:00)
const NOW = new Date('2026-10-06T09:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString();

function gallery(overrides: Partial<TodayGallery> = {}): TodayGallery {
  return {
    id: 'g1',
    status: 'in_progress',
    created_at: daysAgo(20),
    sent_at: daysAgo(20),
    expires_at: daysAhead(10),
    last_activity_at: daysAgo(1),
    last_viewed_at: null,
    editing_started_at: null,
    delivered_at: null,
    reopened_for_selection_at: null,
    selectedCount: 5,
    outstanding: 0,
    pendingExtension: null,
    ...overrides,
  };
}

describe('isExpiringSoon', () => {
  it('עד 3 ימים, עדיין בבחירה', () => {
    expect(isExpiringSoon(gallery({ expires_at: daysAhead(2.5) }), NOW)).toBe(true);
    expect(isExpiringSoon(gallery({ status: 'sent', expires_at: daysAhead(1) }), NOW)).toBe(true);
  });
  it('לא כשרחוק, כבר פג, או שהבחירה הסתיימה', () => {
    expect(isExpiringSoon(gallery({ expires_at: daysAhead(3.5) }), NOW)).toBe(false);
    expect(isExpiringSoon(gallery({ expires_at: daysAgo(0.1) }), NOW)).toBe(false);
    expect(isExpiringSoon(gallery({ status: 'expired', expires_at: daysAhead(1) }), NOW)).toBe(false);
    expect(isExpiringSoon(gallery({ status: 'completed', expires_at: daysAhead(1) }), NOW)).toBe(false);
    expect(isExpiringSoon(gallery({ expires_at: null }), NOW)).toBe(false);
  });
  it('completed שנפתחה מחדש נחשבת בבחירה', () => {
    expect(isExpiringSoon(gallery({ status: 'completed', reopened_for_selection_at: daysAgo(1), expires_at: daysAhead(1) }), NOW)).toBe(true);
  });
});

describe('lastClientActivityAt / isStalled', () => {
  it('לוקח את המאוחר מבין בחירה אחרונה וצפייה אחרונה', () => {
    expect(lastClientActivityAt(gallery({ last_activity_at: daysAgo(6), last_viewed_at: daysAgo(2) }))).toBe(daysAgo(2));
    expect(lastClientActivityAt(gallery({ last_activity_at: daysAgo(2), last_viewed_at: daysAgo(6) }))).toBe(daysAgo(2));
  });
  it('בלי סימני פעילות - נופל לזמן השליחה', () => {
    expect(lastClientActivityAt(gallery({ last_activity_at: null, last_viewed_at: null }))).toBe(daysAgo(20));
  });
  it('נעצרה: בחרה משהו ולא פעילה 4 ימים לפחות', () => {
    expect(isStalled(gallery({ last_activity_at: daysAgo(4) }), NOW)).toBe(true);
    expect(isStalled(gallery({ last_activity_at: daysAgo(3) }), NOW)).toBe(false);
  });
  it('צפייה עדכנית מבטלת "נעצרה"', () => {
    expect(isStalled(gallery({ last_activity_at: daysAgo(8), last_viewed_at: daysAgo(1) }), NOW)).toBe(false);
  });
  it('לא כשלא נבחר כלום, לא in_progress, או שפג התוקף', () => {
    expect(isStalled(gallery({ last_activity_at: daysAgo(9), selectedCount: 0 }), NOW)).toBe(false);
    expect(isStalled(gallery({ last_activity_at: daysAgo(9), status: 'sent' }), NOW)).toBe(false);
    expect(isStalled(gallery({ last_activity_at: daysAgo(9), expires_at: daysAgo(1) }), NOW)).toBe(false);
  });
});

describe('daysSince', () => {
  it('ימים לוחיים בזמן ישראל', () => {
    // 23:30 בישראל אתמול -> 1, גם שעברו רק 12.5 שעות
    expect(daysSince('2026-10-05T20:30:00Z', NOW)).toBe(1);
    expect(daysSince('2026-10-06T05:00:00Z', NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
  });
});

describe('editingProgress', () => {
  it('בלי ימי מסירה - רק ימים בעריכה', () => {
    expect(editingProgress(daysAgo(5), NOW)).toEqual({ daysInEditing: 5, dueDate: null, daysLeft: null });
  });
  it('עם ימי מסירה - תאריך יעד וימים שנותרו', () => {
    expect(editingProgress(daysAgo(5), NOW, 14)).toEqual({ daysInEditing: 5, dueDate: '2026-10-15', daysLeft: 9 });
    expect(editingProgress(daysAgo(20), NOW, 14).daysLeft).toBe(-6);
  });
});

describe('gallerySections / buildTodayView', () => {
  it('גלריה מופיעה פעם אחת, במקטע הדחוף, ושאר המצבים כתגיות', () => {
    const g = gallery({
      pendingExtension: { id: 'r1', days: 4, createdAt: daysAgo(1) },
      expires_at: daysAhead(1),
      outstanding: 300,
    });
    expect(gallerySections(g, NOW)).toEqual(['extension', 'expiring', 'payment']);
    const view = buildTodayView([g], NOW);
    expect(view.sections.extension).toHaveLength(1);
    expect(view.sections.extension[0].tags).toEqual(['expiring', 'payment']);
    expect(view.sections.expiring).toHaveLength(0);
    expect(view.sections.payment).toHaveLength(0);
    expect(view.totalItems).toBe(1);
  });

  it('סיימו לבחור -> תור עריכה -> נמסר', () => {
    const finished = gallery({ status: 'completed' });
    expect(gallerySections(finished, NOW)).toEqual(['finished']);
    const editing = gallery({ status: 'completed', editing_started_at: daysAgo(2) });
    expect(gallerySections(editing, NOW)).toEqual(['editing']);
    const delivered = gallery({ status: 'completed', editing_started_at: daysAgo(2), delivered_at: daysAgo(1) });
    expect(gallerySections(delivered, NOW)).toEqual([]);
  });

  it('נמסרה אבל לא שולמה -> ממתין לתשלום', () => {
    const g = gallery({ status: 'completed', delivered_at: daysAgo(1), outstanding: 150.5 });
    expect(gallerySections(g, NOW)).toEqual(['payment']);
  });

  it('KPI: סכום פתוח ובוחרות עכשיו', () => {
    const view = buildTodayView(
      [
        gallery({ id: 'a', outstanding: 0.1 }),
        gallery({ id: 'b', outstanding: 0.2, status: 'completed', delivered_at: daysAgo(1) }),
        gallery({ id: 'c', status: 'sent' }),
        gallery({ id: 'd', expires_at: daysAgo(1) }),
      ],
      NOW
    );
    expect(view.outstandingTotal).toBe(0.3);
    expect(view.outstandingCount).toBe(2);
    expect(view.selectingCount).toBe(1);
  });

  it('אין מה לעשות - totalItems 0', () => {
    expect(buildTodayView([gallery()], NOW).totalItems).toBe(0);
  });

  it('מיון: התוקף הקרוב ראשון, החוב הגדול ראשון', () => {
    const view = buildTodayView(
      [
        gallery({ id: 'late', expires_at: daysAhead(2) }),
        gallery({ id: 'soon', expires_at: daysAhead(0.5) }),
        gallery({ id: 'p1', status: 'expired', outstanding: 100 }),
        gallery({ id: 'p2', status: 'expired', outstanding: 500 }),
      ],
      NOW
    );
    expect(view.sections.expiring.map((i) => i.gallery.id)).toEqual(['soon', 'late']);
    expect(view.sections.payment.map((i) => i.gallery.id)).toEqual(['p2', 'p1']);
  });
});

describe('isSelectingNow', () => {
  it('in_progress בתוקף או נפתחה מחדש', () => {
    expect(isSelectingNow(gallery(), NOW)).toBe(true);
    expect(isSelectingNow(gallery({ expires_at: null }), NOW)).toBe(true);
    expect(isSelectingNow(gallery({ status: 'completed', reopened_for_selection_at: daysAgo(1) }), NOW)).toBe(true);
    expect(isSelectingNow(gallery({ status: 'completed' }), NOW)).toBe(false);
    expect(isSelectingNow(gallery({ status: 'sent' }), NOW)).toBe(false);
  });
});

describe('shoots', () => {
  it('היום ומחר בזמן ישראל', () => {
    // 23:30 בישראל ב-6.10 -> עדיין 6.10
    expect(todayAndTomorrow(new Date('2026-10-06T20:30:00Z'))).toEqual(['2026-10-06', '2026-10-07']);
    // 00:30 בישראל ב-7.10
    expect(todayAndTomorrow(new Date('2026-10-06T21:30:00Z'))).toEqual(['2026-10-07', '2026-10-08']);
  });
  it('מיון לפי תאריך ושעה', () => {
    const sorted = sortShoots([
      { shoot_date: '2026-10-07', start_time: '09:00:00' },
      { shoot_date: '2026-10-06', start_time: '18:00:00' },
      { shoot_date: '2026-10-06', start_time: '08:30:00' },
    ]);
    expect(sorted.map((s) => `${s.shoot_date} ${s.start_time}`)).toEqual([
      '2026-10-06 08:30:00',
      '2026-10-06 18:00:00',
      '2026-10-07 09:00:00',
    ]);
  });
  it('קישור Waze מקודד', () => {
    expect(wazeUrl(' פארק הירקון, תל אביב ')).toBe(
      `https://waze.com/ul?q=${encodeURIComponent('פארק הירקון, תל אביב')}&navigate=yes`
    );
  });
});
