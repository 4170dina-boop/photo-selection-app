import { describe, it, expect } from 'vitest';
import {
  NO_CHAPTER,
  chapterProgress,
  defaultSplitName,
  filterByChapter,
  normalizeChapterName,
  orderForTimeline,
  proposeTimeSplits,
  sortChapters,
  splitEvenly,
} from './chapters';

const at = (h: number, m: number) => new Date(Date.UTC(2024, 5, 1, h, m, 0)).toISOString();

describe('normalizeChapterName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeChapterName('  💍   חופה ')).toBe('💍 חופה');
  });
  it('rejects empty / too long / non-string', () => {
    expect(normalizeChapterName('   ')).toBeNull();
    expect(normalizeChapterName('א'.repeat(61))).toBeNull();
    expect(normalizeChapterName(5)).toBeNull();
  });
});

describe('sortChapters', () => {
  it('sorts by sort then name', () => {
    expect(sortChapters([{ sort: 2, name: 'ב' }, { sort: 1, name: 'ג' }, { sort: 1, name: 'א' }]).map((c) => c.name)).toEqual(['א', 'ג', 'ב']);
  });
});

describe('orderForTimeline', () => {
  it('keeps upload order when most photos lack capture time', () => {
    const r = orderForTimeline([
      { id: 'a', takenAt: null },
      { id: 'b', takenAt: at(10, 0) },
      { id: 'c', takenAt: null },
    ]);
    expect(r.usedCaptureTime).toBe(false);
    expect(r.ordered.map((o) => o.photo.id)).toEqual(['a', 'b', 'c']);
  });
  it('sorts by capture time; photos without time stay next to their upload neighbour', () => {
    const r = orderForTimeline([
      { id: 'late', takenAt: at(20, 0) },
      { id: 'noTime', takenAt: null },
      { id: 'early', takenAt: at(18, 0) },
      { id: 'mid', takenAt: at(19, 0) },
    ]);
    expect(r.usedCaptureTime).toBe(true);
    expect(r.ordered.map((o) => o.photo.id)).toEqual(['early', 'mid', 'late', 'noTime']);
  });
});

describe('proposeTimeSplits', () => {
  const photos = [
    { id: '1', takenAt: at(18, 0) },
    { id: '2', takenAt: at(18, 10) },
    { id: '3', takenAt: at(18, 35) }, // הפסקה של 25 דקות
    { id: '4', takenAt: at(19, 30) }, // 55 דקות
    { id: '5', takenAt: at(19, 31) },
  ];
  it('splits on gaps larger than N minutes', () => {
    const r = proposeTimeSplits(photos, 30);
    expect(r.usedCaptureTime).toBe(true);
    expect(r.splits.map((s) => s.photoIds)).toEqual([['1', '2', '3'], ['4', '5']]);
    expect(r.splits[0].startAt).toBe(at(18, 0));
    expect(r.splits[0].endAt).toBe(at(18, 35));
  });
  it('splits more with a smaller gap', () => {
    expect(proposeTimeSplits(photos, 20).splits.map((s) => s.photoIds)).toEqual([['1', '2'], ['3'], ['4', '5']]);
  });
  it('returns a single group without capture times', () => {
    const r = proposeTimeSplits([{ id: 'a', takenAt: null }, { id: 'b', takenAt: null }], 30);
    expect(r.usedCaptureTime).toBe(false);
    expect(r.splits).toEqual([{ photoIds: ['a', 'b'], startAt: null, endAt: null }]);
  });
  it('handles empty input', () => {
    expect(proposeTimeSplits([], 30).splits).toEqual([]);
  });
});

describe('splitEvenly', () => {
  it('splits into contiguous near-equal parts', () => {
    expect(splitEvenly(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b', 'c'], ['d', 'e']]);
    expect(splitEvenly(['a', 'b', 'c', 'd'], 2)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(splitEvenly(['a', 'b'], 5)).toEqual([['a'], ['b']]);
    expect(splitEvenly([], 3)).toEqual([]);
    expect(splitEvenly(['a', 'b', 'c', 'd', 'e'], 2).flat()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('defaultSplitName', () => {
  it('includes the time range when available', () => {
    expect(defaultSplitName(0, { startAt: at(18, 5), endAt: at(19, 40) })).toBe('חלק 1 · 18:05–19:40');
    expect(defaultSplitName(1, { startAt: null, endAt: null })).toBe('חלק 2');
  });
});

describe('chapterProgress / filterByChapter', () => {
  const chapters = [
    { id: 'c2', name: 'ריקודים', sort: 2 },
    { id: 'c1', name: 'חופה', sort: 1 },
    { id: 'empty', name: 'ריק', sort: 3 },
  ];
  const photos = [
    { id: 'p1', chapterId: 'c1' },
    { id: 'p2', chapterId: 'c1' },
    { id: 'p3', chapterId: 'c2' },
    { id: 'p4', chapterId: null },
  ];
  it('counts viewed/selected per chapter, in chapter order, skipping empty chapters', () => {
    const r = chapterProgress(chapters, photos, new Set(['p1', 'p2', 'p4']), (id) => id === 'p3');
    expect(r).toEqual([
      { id: 'c1', name: 'חופה', total: 2, viewed: 2, selected: 0, done: true },
      { id: 'c2', name: 'ריקודים', total: 1, viewed: 0, selected: 1, done: false },
    ]);
  });
  it('filters by chapter / no chapter / all', () => {
    expect(filterByChapter(photos, 'all')).toHaveLength(4);
    expect(filterByChapter(photos, 'c1').map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(filterByChapter(photos, NO_CHAPTER).map((p) => p.id)).toEqual(['p4']);
  });
});
