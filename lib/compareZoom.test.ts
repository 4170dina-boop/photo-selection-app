import { describe, expect, it } from 'vitest';
import { clampComparePan, clampCompareScale } from './compareZoom';

describe('compareZoom helpers', () => {
  it('clamps scale to the supported range', () => {
    expect(clampCompareScale(0.5)).toBe(1);
    expect(clampCompareScale(2.5)).toBe(2.5);
    expect(clampCompareScale(10)).toBe(4);
  });

  it('keeps pan centered at scale 1', () => {
    expect(clampComparePan(25, 1)).toBe(0);
    expect(clampComparePan(-80, 1)).toBe(0);
  });

  it('limits panning when zoomed in', () => {
    expect(clampComparePan(600, 2)).toBe(180);
    expect(clampComparePan(-600, 2)).toBe(-180);
  });
});
