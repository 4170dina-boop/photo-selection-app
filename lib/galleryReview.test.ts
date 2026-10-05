import { describe, it, expect } from 'vitest';
import {
  formatShekels,
  extraPriceLabel,
  crossedIncludedQuota,
  extraPriceToastKey,
  computeFinishSummary,
  focusTrapIndex,
  parseResumeState,
  recordPhotoView,
  resumeOffer,
  viewedProgress,
  resumeStateKey,
  emptyResumeState,
} from './galleryReview';

describe('formatShekels / extraPriceLabel', () => {
  it('formats whole and fractional amounts', () => {
    expect(formatShekels(12)).toBe('12');
    expect(formatShekels(12.5)).toBe('12.5');
    expect(formatShekels(9.999)).toBe('10');
    expect(formatShekels(NaN)).toBe('0');
  });

  it('shows the label only when there is an extra price', () => {
    expect(extraPriceLabel(25)).toBe('✨ כל תמונה נוספת: 25 ₪');
    expect(extraPriceLabel(0)).toBeNull();
    expect(extraPriceLabel(-3)).toBeNull();
    expect(extraPriceLabel(null)).toBeNull();
    expect(extraPriceLabel(undefined)).toBeNull();
  });
});

describe('crossedIncludedQuota', () => {
  it('detects crossing from within the quota to above it', () => {
    expect(crossedIncludedQuota(20, 21, 20)).toBe(true);
    expect(crossedIncludedQuota(19, 22, 20)).toBe(true);
  });

  it('ignores the first value (page load) even when already above', () => {
    expect(crossedIncludedQuota(null, 30, 20)).toBe(false);
  });

  it('ignores moves that stay on one side or go down', () => {
    expect(crossedIncludedQuota(21, 22, 20)).toBe(false);
    expect(crossedIncludedQuota(19, 20, 20)).toBe(false);
    expect(crossedIncludedQuota(21, 20, 20)).toBe(false);
  });

  it('has a per gallery + participant key', () => {
    expect(extraPriceToastKey('g1', 'p1')).not.toBe(extraPriceToastKey('g1', 'p2'));
  });
});

describe('computeFinishSummary', () => {
  it('splits included and extra photos with cost', () => {
    expect(computeFinishSummary({ selectedCount: 25, included: 20, extraPrice: 15, maybeCount: 3 })).toEqual({
      selected: 25,
      includedUsed: 20,
      extraCount: 5,
      extraPrice: 15,
      extraCost: 75,
      remainingIncluded: 0,
      undecidedMaybe: 3,
    });
  });

  it('reports remaining photos when under the quota', () => {
    const s = computeFinishSummary({ selectedCount: 12, included: 20, extraPrice: 15, maybeCount: 0 });
    expect(s.includedUsed).toBe(12);
    expect(s.extraCount).toBe(0);
    expect(s.extraCost).toBe(0);
    expect(s.remainingIncluded).toBe(8);
  });

  it('clamps bad input', () => {
    const s = computeFinishSummary({ selectedCount: -1, included: -5, extraPrice: NaN, maybeCount: -2 });
    expect(s).toMatchObject({ selected: 0, includedUsed: 0, extraCount: 0, extraCost: 0, remainingIncluded: 0, undecidedMaybe: 0 });
  });
});

describe('focusTrapIndex', () => {
  it('wraps Tab from the last element to the first', () => {
    expect(focusTrapIndex(2, 3, false)).toBe(0);
    expect(focusTrapIndex(1, 3, false)).toBeNull();
  });

  it('wraps Shift+Tab from the first element (or the dialog itself) to the last', () => {
    expect(focusTrapIndex(0, 3, true)).toBe(2);
    expect(focusTrapIndex(-1, 3, true)).toBe(2);
    expect(focusTrapIndex(2, 3, true)).toBeNull();
  });

  it('moves focus from the dialog container to the first element on Tab', () => {
    expect(focusTrapIndex(-1, 3, false)).toBe(0);
  });

  it('does nothing without focusable elements', () => {
    expect(focusTrapIndex(-1, 0, false)).toBeNull();
  });
});

describe('resume state', () => {
  it('parses garbage safely', () => {
    expect(parseResumeState(null)).toEqual(emptyResumeState());
    expect(parseResumeState('not json')).toEqual(emptyResumeState());
    expect(parseResumeState('42')).toEqual(emptyResumeState());
    expect(parseResumeState(JSON.stringify({ lastPhotoId: 5, viewed: ['a', 3, 'a', '', 'b'] }))).toEqual({
      lastPhotoId: null,
      viewed: ['a', 'b'],
    });
  });

  it('caps the stored list when parsing', () => {
    const raw = JSON.stringify({ lastPhotoId: 'c', viewed: ['a', 'b', 'c'] });
    expect(parseResumeState(raw, 2).viewed).toEqual(['b', 'c']);
  });

  it('records a view as last + most recent, deduped and capped', () => {
    let s = emptyResumeState();
    s = recordPhotoView(s, 'a', 3);
    s = recordPhotoView(s, 'b', 3);
    s = recordPhotoView(s, 'a', 3);
    expect(s).toEqual({ lastPhotoId: 'a', viewed: ['b', 'a'] });
    s = recordPhotoView(s, 'c', 3);
    s = recordPhotoView(s, 'd', 3);
    expect(s.viewed).toEqual(['a', 'c', 'd']);
    expect(s.lastPhotoId).toBe('d');
  });

  it('returns the same object when nothing changed', () => {
    const s = recordPhotoView(emptyResumeState(), 'a');
    expect(recordPhotoView(s, 'a')).toBe(s);
    expect(recordPhotoView(s, '')).toBe(s);
  });

  it('offers to resume only from a photo that still exists and is not the first', () => {
    const ids = ['a', 'b', 'c'];
    expect(resumeOffer({ lastPhotoId: 'c', viewed: [] }, ids)).toEqual({ photoId: 'c', index: 2 });
    expect(resumeOffer({ lastPhotoId: 'a', viewed: [] }, ids)).toBeNull();
    expect(resumeOffer({ lastPhotoId: 'gone', viewed: [] }, ids)).toBeNull();
    expect(resumeOffer(emptyResumeState(), ids)).toBeNull();
  });

  it('counts progress only over photos still in the gallery', () => {
    expect(viewedProgress(new Set(['a', 'x', 'c']), ['a', 'b', 'c', 'd'])).toEqual({ seen: 2, total: 4, pct: 50 });
    expect(viewedProgress(new Set(), [])).toEqual({ seen: 0, total: 0, pct: 0 });
  });

  it('keys per gallery + participant', () => {
    expect(resumeStateKey('g', 'p1')).not.toBe(resumeStateKey('g', 'p2'));
    expect(resumeStateKey('g1', 'p')).not.toBe(resumeStateKey('g2', 'p'));
  });
});
