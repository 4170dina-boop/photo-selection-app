import { describe, expect, it } from 'vitest';
import { packBySize, photoFilename, planEmailParts } from './emailSelectionBatches';

describe('planEmailParts', () => {
  it('splits 156 photos into parts of 40', () => {
    expect(planEmailParts(156)).toEqual([
      { index: 0, from: 1, to: 40 },
      { index: 1, from: 41, to: 80 },
      { index: 2, from: 81, to: 120 },
      { index: 3, from: 121, to: 156 },
    ]);
  });
  it('handles empty and small galleries', () => {
    expect(planEmailParts(0)).toEqual([]);
    expect(planEmailParts(5)).toEqual([{ index: 0, from: 1, to: 5 }]);
  });
});

describe('packBySize', () => {
  it('keeps each group under the byte limit', () => {
    const items = [5, 5, 5, 5].map((bytes) => ({ bytes }));
    expect(packBySize(items, 10, 40).map((g) => g.length)).toEqual([2, 2]);
  });
  it('respects the photo count limit', () => {
    const items = Array.from({ length: 5 }, () => ({ bytes: 1 }));
    expect(packBySize(items, 100, 2).map((g) => g.length)).toEqual([2, 2, 1]);
  });
  it('a single oversized photo still goes in its own email', () => {
    expect(packBySize([{ bytes: 50 }, { bytes: 1 }], 10, 40).map((g) => g.length)).toEqual([1, 1]);
  });
});

describe('photoFilename', () => {
  it('pads to at least 3 digits', () => {
    expect(photoFilename(7, 156)).toBe('007.jpg');
    expect(photoFilename(42, 1200)).toBe('0042.jpg');
  });
});
