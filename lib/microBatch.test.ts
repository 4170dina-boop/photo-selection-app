import { describe, expect, it, vi } from 'vitest';
import { createMicroBatcher } from './microBatch';

describe('createMicroBatcher', () => {
  it('groups calls that arrive within the delay into one request', async () => {
    const run = vi.fn(async (items: number[]) => items.map((n) => n * 2));
    const add = createMicroBatcher({ maxSize: 10, delayMs: 10, run });
    const results = await Promise.all([add(1), add(2), add(3)]);
    expect(results).toEqual([2, 4, 6]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('flushes immediately at maxSize', async () => {
    const run = vi.fn(async (items: string[]) => items.map((s) => s.toUpperCase()));
    const add = createMicroBatcher({ maxSize: 2, delayMs: 10_000, run });
    const results = await Promise.all([add('a'), add('b')]);
    expect(results).toEqual(['A', 'B']);
    expect(run).toHaveBeenCalledTimes(1);

    const more = await Promise.all([add('c'), add('d'), add('e'), add('f')]);
    expect(more).toEqual(['C', 'D', 'E', 'F']);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('sends later calls in a new batch', async () => {
    const run = vi.fn(async (items: number[]) => items);
    const add = createMicroBatcher({ maxSize: 10, delayMs: 5, run });
    await add(1);
    await add(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rejects every caller in the batch when the request fails', async () => {
    const add = createMicroBatcher<number, number>({
      maxSize: 10,
      delayMs: 5,
      run: async () => {
        throw new Error('network');
      },
    });
    const results = await Promise.allSettled([add(1), add(2)]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('rejects when the server returns the wrong number of results', async () => {
    const add = createMicroBatcher<number, number>({ maxSize: 10, delayMs: 5, run: async () => [1] });
    const results = await Promise.allSettled([add(1), add(2)]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });
});
