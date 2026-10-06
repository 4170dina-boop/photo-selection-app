import { describe, it, expect } from 'vitest';
import { FREE_DELIVERED_PHOTO_LIMIT, remainingDeliveredQuota } from './deliveredPhotoLimit';
import { FREE_PHOTO_LIMIT } from './uploadPolicy';

describe('remainingDeliveredQuota', () => {
  it('is the free photo limit plus a small margin', () => {
    expect(FREE_DELIVERED_PHOTO_LIMIT).toBe(FREE_PHOTO_LIMIT + 5);
  });

  it('returns null for unlimited photographers', () => {
    expect(remainingDeliveredQuota(1000, true)).toBeNull();
  });

  it('counts down and never goes negative', () => {
    expect(remainingDeliveredQuota(0, false)).toBe(FREE_DELIVERED_PHOTO_LIMIT);
    expect(remainingDeliveredQuota(FREE_DELIVERED_PHOTO_LIMIT - 1, false)).toBe(1);
    expect(remainingDeliveredQuota(FREE_DELIVERED_PHOTO_LIMIT, false)).toBe(0);
    expect(remainingDeliveredQuota(FREE_DELIVERED_PHOTO_LIMIT + 3, false)).toBe(0);
  });
});
