import { describe, expect, it } from 'vitest';
import { createSlotLimiter, mapWithConcurrency } from './concurrency';

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

describe('createSlotLimiter', () => {
  it('never runs more than `limit` at once and never shares a slot', async () => {
    const run = createSlotLimiter(2);
    const busy = new Set<number>();
    let maxActive = 0;
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        run(async (slot) => {
          expect(slot === 0 || slot === 1).toBe(true);
          expect(busy.has(slot)).toBe(false);
          busy.add(slot);
          maxActive = Math.max(maxActive, busy.size);
          await new Promise((r) => setTimeout(r, 5));
          busy.delete(slot);
          return n * 10;
        })
      )
    );
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBe(2);
  });

  it('releases the slot when the task throws', async () => {
    const run = createSlotLimiter(1);
    await expect(
      run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await expect(run(async (slot) => slot)).resolves.toBe(0);
  });
});
