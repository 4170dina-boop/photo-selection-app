import { describe, it, expect } from 'vitest';
import {
  GIFT_MESSAGE_MAX_LENGTH,
  normalizeGiftMessage,
  countBillableSelected,
  computePackageUsage,
  computeOverage,
  mergeGiftPhotosIntoExport,
  giftExclusionFilter,
  groupGiftIdsByGallery,
} from './gifts';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';
const P1 = '33333333-3333-3333-3333-333333333333';
const P2 = '44444444-4444-4444-4444-444444444444';

describe('normalizeGiftMessage', () => {
  it('null/undefined/רווחים = אין הודעה', () => {
    expect(normalizeGiftMessage(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeGiftMessage(null)).toEqual({ ok: true, value: null });
    expect(normalizeGiftMessage('   ')).toEqual({ ok: true, value: null });
  });

  it('חותך רווחים מסביב', () => {
    expect(normalizeGiftMessage('  אהבתי את זו במיוחד  ')).toEqual({ ok: true, value: 'אהבתי את זו במיוחד' });
  });

  it('דוחה הודעה ארוכה מדי או שאינה מחרוזת', () => {
    expect(normalizeGiftMessage('א'.repeat(GIFT_MESSAGE_MAX_LENGTH)).ok).toBe(true);
    expect(normalizeGiftMessage('א'.repeat(GIFT_MESSAGE_MAX_LENGTH + 1)).ok).toBe(false);
    expect(normalizeGiftMessage(42).ok).toBe(false);
  });
});

describe('countBillableSelected', () => {
  const selections = [
    { photo_id: P1, status: 'selected' },
    { photo_id: P2, status: 'maybe' },
    { photo_id: G1, status: 'selected' }, // סומנה לפני שהפכה למתנה
  ];

  it('לא סופר תמונות מתנה ולא "אולי"', () => {
    expect(countBillableSelected(selections, [G1])).toBe(1);
    expect(countBillableSelected(selections, new Set([G1, G2]))).toBe(1);
  });

  it('בלי מתנות - סופר את כל ה-selected', () => {
    expect(countBillableSelected(selections, [])).toBe(2);
  });
});

describe('computePackageUsage', () => {
  it('בתוך המכסה - אין חיוב נוסף', () => {
    const usage = computePackageUsage({ billableSelectedCount: 8, included: 10, extraPrice: 20, basePrice: 1000 });
    expect(usage).toEqual({ remaining: 2, extraCount: 0, extraCost: 0, totalEstimate: 1000, progressPct: 80 });
  });

  it('מעבר למכסה - מחייב רק את החריגה', () => {
    const usage = computePackageUsage({ billableSelectedCount: 13, included: 10, extraPrice: 20, basePrice: 1000 });
    expect(usage.extraCount).toBe(3);
    expect(usage.extraCost).toBe(60);
    expect(usage.totalEstimate).toBe(1060);
    expect(usage.remaining).toBe(0);
    expect(usage.progressPct).toBe(100);
  });

  it('מתנות לא משפיעות על המחיר: 10 נבחרו + 2 מתנות במכסה של 10 = 0 תוספת', () => {
    const selections = [
      ...Array.from({ length: 10 }, (_, i) => ({ photo_id: `p${i}`, status: 'selected' })),
      { photo_id: G1, status: 'selected' },
      { photo_id: G2, status: 'selected' },
    ];
    const billable = countBillableSelected(selections, [G1, G2]);
    const usage = computePackageUsage({ billableSelectedCount: billable, included: 10, extraPrice: 25, basePrice: 0 });
    expect(usage.extraCount).toBe(0);
    expect(usage.extraCost).toBe(0);
  });

  it('מכסה 0 - אין אחוז התקדמות, כל בחירה היא תוספת', () => {
    const usage = computePackageUsage({ billableSelectedCount: 2, included: 0, extraPrice: 10, basePrice: 0 });
    expect(usage.progressPct).toBe(0);
    expect(usage.extraCost).toBe(20);
  });
});

describe('computeOverage', () => {
  it('תואם לחישוב החבילה', () => {
    expect(computeOverage(12, 10, 15)).toEqual({ count: 2, cost: 30 });
    expect(computeOverage(5, 10, 15)).toEqual({ count: 0, cost: 0 });
  });
});

describe('mergeGiftPhotosIntoExport', () => {
  it('מוסיף מתנות שלא נבחרו, מסמן isGift, בלי כפילויות', () => {
    const selected = [
      { photoId: P1, filename: 'a.jpg' },
      { photoId: G1, filename: 'gift1.jpg' },
    ];
    const gifts = [
      { photoId: G1, filename: 'gift1.jpg' },
      { photoId: G2, filename: 'gift2.jpg' },
    ];
    const merged = mergeGiftPhotosIntoExport(selected, gifts);
    expect(merged.map((m) => [m.photoId, m.isGift])).toEqual([
      [P1, false],
      [G1, true],
      [G2, true],
    ]);
  });

  it('בלי מתנות - הרשימה המקורית', () => {
    const merged = mergeGiftPhotosIntoExport([{ photoId: P1 }], []);
    expect(merged).toEqual([{ photoId: P1, isGift: false }]);
  });
});

describe('giftExclusionFilter', () => {
  it('null כשאין מתנות', () => {
    expect(giftExclusionFilter([])).toBeNull();
  });

  it('בונה רשימת PostgREST ומסנן ערכים שאינם uuid', () => {
    expect(giftExclusionFilter([G1, 'x),(evil', G2])).toBe(`(${G1},${G2})`);
  });
});

describe('groupGiftIdsByGallery', () => {
  it('מקבץ לפי גלריה', () => {
    const map = groupGiftIdsByGallery([
      { id: G1, gallery_id: 'g-a' },
      { id: G2, gallery_id: 'g-a' },
      { id: P1, gallery_id: 'g-b' },
    ]);
    expect(map.get('g-a')).toEqual([G1, G2]);
    expect(map.get('g-b')).toEqual([P1]);
    expect(map.get('g-c')).toBeUndefined();
  });
});
