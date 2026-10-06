import { describe, expect, it } from 'vitest';
import { deliveryMatchKey, deliveryMatchSummary, matchDelivery } from './deliveryMatch';

describe('deliveryMatchKey', () => {
  it('מסירה סיומת, רישיות ונתיב', () => {
    expect(deliveryMatchKey('IMG_1234.CR3')).toBe('img_1234');
    expect(deliveryMatchKey('export/IMG_1234.JPG')).toBe('img_1234');
  });

  it('מסירה תוספות עריכה', () => {
    expect(deliveryMatchKey('IMG_1234-edit.jpg')).toBe('img_1234');
    expect(deliveryMatchKey('IMG_1234_final.jpg')).toBe('img_1234');
    expect(deliveryMatchKey('IMG_1234 (1).jpg')).toBe('img_1234');
    expect(deliveryMatchKey('IMG_1234-Edit-2.jpg')).toBe('img_1234');
    expect(deliveryMatchKey('IMG_1234_final-edit (2).jpg')).toBe('img_1234');
    expect(deliveryMatchKey('IMG_1234 copy.jpg')).toBe('img_1234');
  });

  it('לא נוגעת במספרים שהם חלק מהשם', () => {
    expect(deliveryMatchKey('DSC-1234.jpg')).toBe('dsc-1234');
    expect(deliveryMatchKey('IMG_1234-2.jpg')).toBe('img_1234-2');
  });

  it('שם שהוא כולו "תוספת" לא מתרוקן', () => {
    expect(deliveryMatchKey('final.jpg')).toBe('final');
  });
});

describe('matchDelivery', () => {
  it('הכל תואם', () => {
    const r = matchDelivery(['A.CR3', 'B.CR3'], ['a-edit.jpg', 'B_final.jpg']);
    expect(r).toMatchObject({ matchedCount: 2, expectedCount: 2, missing: [], extras: [], allMatched: true });
  });

  it('חסרות ומיותרות', () => {
    const r = matchDelivery(['A.CR3', 'B.CR3', 'C.CR3'], ['A.jpg', 'Z.jpg']);
    expect(r.matchedCount).toBe(1);
    expect(r.expectedCount).toBe(3);
    expect(r.missing).toEqual(['B.CR3', 'C.CR3']);
    expect(r.extras).toEqual(['Z.jpg']);
    expect(r.allMatched).toBe(false);
  });

  it('כפילויות נספרות פעם אחת', () => {
    const r = matchDelivery(['A.CR3', 'A.jpg'], ['A-edit.jpg', 'A-Edit-2.jpg']);
    expect(r).toMatchObject({ matchedCount: 1, expectedCount: 1, extras: [] });
  });

  it('אין צפויות - כל הסופיות מיותרות', () => {
    const r = matchDelivery([], ['A.jpg']);
    expect(r).toMatchObject({ matchedCount: 0, expectedCount: 0, extras: ['A.jpg'], allMatched: false });
  });
});

describe('deliveryMatchSummary', () => {
  it('הכל תואם', () => {
    expect(deliveryMatchSummary(matchDelivery(['A.jpg'], ['A.jpg']))).toBe('✓ 1/1 תואמות');
  });

  it('חסרות ומיותרות, מקוצר', () => {
    const r = matchDelivery(['A.jpg', 'B.jpg', 'C.jpg', 'D.jpg'], ['Z.jpg']);
    expect(deliveryMatchSummary(r, 2)).toBe('⚠ 0/4 תואמות · חסרות: A, B ועוד 2 · מיותרות: Z');
  });
});
