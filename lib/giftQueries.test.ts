import { describe, it, expect, vi } from 'vitest';
import { chunkIds, fetchGiftPhotos, GIFT_QUERY_GALLERY_BATCH } from './giftQueries';

// client מזויף מינימלי: from().select().in().eq().order().order().range()
function fakeClient(rowsByGallery: Record<string, number>, failWith?: { code?: string; message: string }) {
  const inCalls: string[][] = [];
  const client = {
    from() {
      let ids: string[] = [];
      const q: any = {
        select: () => q,
        in: (_col: string, values: string[]) => {
          ids = values;
          inCalls.push(values);
          return q;
        },
        eq: () => q,
        order: () => q,
        range: async (from: number, to: number) => {
          if (failWith) return { data: null, error: failWith };
          const rows = ids.flatMap((g) =>
            Array.from({ length: rowsByGallery[g] ?? 0 }, (_, i) => ({
              id: `${g}-${i}`, gallery_id: g, gift_message: null, original_filename: 'a.jpg', file_path: 'p',
            }))
          );
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return q;
    },
  };
  return { client: client as any, inCalls };
}

describe('chunkIds', () => {
  it('splits into fixed-size batches', () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkIds([], 2)).toEqual([]);
  });
});

describe('fetchGiftPhotos', () => {
  it('batches many gallery ids and reads past 1000 rows', async () => {
    const ids = Array.from({ length: GIFT_QUERY_GALLERY_BATCH + 5 }, (_, i) => `g${i}`);
    const { client, inCalls } = fakeClient({ g0: 1500, [`g${GIFT_QUERY_GALLERY_BATCH + 1}`]: 2 });
    const rows = await fetchGiftPhotos(client, ids);
    expect(rows).toHaveLength(1502);
    expect(Math.max(...inCalls.map((c) => c.length))).toBeLessThanOrEqual(GIFT_QUERY_GALLERY_BATCH);
  });

  it('logs and returns [] on error instead of failing silently', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient({}, { code: '57014', message: 'timeout' });
    expect(await fetchGiftPhotos(client, ['g1'])).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a missing is_gift column is only a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient({}, { code: '42703', message: 'column photos.is_gift does not exist' });
    expect(await fetchGiftPhotos(client, ['g1'])).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    warn.mockRestore();
    err.mockRestore();
  });
});
