import { describe, it, expect } from 'vitest';
import { fetchAllPages } from './fetchAllPages';

function fakeTable(total: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { fetchPage, calls };
}

describe('fetchAllPages', () => {
  it('reads past the 1000-row cap', async () => {
    const { fetchPage, calls } = fakeTable(2500);
    const all = await fetchAllPages(fetchPage);
    expect(all).toHaveLength(2500);
    expect(all[2499]).toBe(2499);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('makes one extra call when the total is an exact multiple of the page size', async () => {
    const { fetchPage, calls } = fakeTable(4);
    expect(await fetchAllPages(fetchPage, 2)).toEqual([0, 1, 2, 3]);
    expect(calls).toHaveLength(3);
  });

  it('handles empty and null results', async () => {
    expect(await fetchAllPages(async () => ({ data: null, error: null }))).toEqual([]);
  });

  it('throws the query error', async () => {
    const err = new Error('boom');
    await expect(fetchAllPages(async () => ({ data: null, error: err }))).rejects.toBe(err);
  });
});
