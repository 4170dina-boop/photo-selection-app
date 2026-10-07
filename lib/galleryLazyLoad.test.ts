import { describe, expect, it } from 'vitest';
import { makeInitialVisiblePhotoIds, mergeVisiblePhotoIds, syncVisiblePhotoIds } from './galleryLazyLoad';

describe('galleryLazyLoad', () => {
  it('keeps an initial viewport batch before the observer fires', () => {
    expect(makeInitialVisiblePhotoIds(['a', 'b', 'c', 'd'], 2)).toEqual(new Set(['a', 'b']));
  });

  it('merges new visible IDs without dropping the current set', () => {
    expect(mergeVisiblePhotoIds(new Set(['a']), ['b', 'c'])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('drops stale IDs that are no longer in the current filtered gallery', () => {
    expect(syncVisiblePhotoIds(new Set(['a', 'z']), ['a', 'b'], ['b'])).toEqual(new Set(['a', 'b']));
  });
});
