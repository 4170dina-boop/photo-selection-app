import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('processes every item, never more than `limit` at once', async () => {
    let active = 0;
    let maxActive = 0;
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      active--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maxActive).toBe(3);
  });

  it('handles an empty list and a bad limit', async () => {
    await mapWithConcurrency([], 8, async () => {
      throw new Error('should not run');
    });
    const seen: string[] = [];
    await mapWithConcurrency(['a', 'b'], 0, async (s) => {
      seen.push(s);
    });
    expect(seen).toEqual(['a', 'b']);
  });
});
