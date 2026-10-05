import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkGalleryWritable } from './galleryAccess';

// בונה מוק מינימלי ל-Supabase שתומך רק בשרשרת המדויקת שגם checkGalleryWritable
// משתמשת בה: from().select().eq().single(). המוק בודק גם את הטבלה, את מחרוזת
// העמודות ואת ה-id - אחרת הסרת reopened_for_selection_at מה-select (או סינון
// לפי עמודה/ערך שגוי) הייתה עוברת בשקט, כי המוק מחזיר את השדה בכל מקרה.
const EXPECTED_COLUMNS = ['status', 'expires_at', 'reopened_for_selection_at'];

function mockSupabase(
  gallery: { status: string; expires_at: string | null; reopened_for_selection_at?: string | null } | null,
  expectedId = 'gallery-1'
): SupabaseClient {
  return {
    from: (table: string) => {
      expect(table).toBe('galleries');
      return {
        select: (columns: string) => {
          const requested = columns.split(',').map((c) => c.trim());
          expect(requested).toEqual(expect.arrayContaining(EXPECTED_COLUMNS));
          return {
            eq: (column: string, value: string) => {
              expect(column).toBe('id');
              expect(value).toBe(expectedId);
              return {
                single: async () => ({ data: gallery, error: gallery ? null : { message: 'not found' } }),
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('checkGalleryWritable', () => {
  it('allows writes to an in-progress gallery with no expiry', async () => {
    const supabase = mockSupabase({ status: 'in_progress', expires_at: null });
    const result = await checkGalleryWritable(supabase, 'gallery-1');
    expect(result).toEqual({ ok: true });
  });

  it('allows writes to a gallery that expires in the future', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const supabase = mockSupabase({ status: 'sent', expires_at: future });
    const result = await checkGalleryWritable(supabase, 'gallery-1');
    expect(result).toEqual({ ok: true });
  });

  it('rejects with 404 when the gallery does not exist', async () => {
    const supabase = mockSupabase(null, 'missing-gallery');
    const result = await checkGalleryWritable(supabase, 'missing-gallery');
    expect(result).toEqual({ ok: false, status: 404, error: 'גלריה לא נמצאה' });
  });

  it('rejects with 410 when the gallery has expired, even if status looks writable', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const supabase = mockSupabase({ status: 'in_progress', expires_at: past });
    const result = await checkGalleryWritable(supabase, 'gallery-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(410);
  });

  it('rejects with 403 when the gallery is already completed', async () => {
    const supabase = mockSupabase({ status: 'completed', expires_at: null });
    const result = await checkGalleryWritable(supabase, 'gallery-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('checks expiry before completion status (both true -> reports expired)', async () => {
    // מקרה קצה: גלריה שגם הושלמה וגם פג תוקפה - הקוד בודק תוקף קודם
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const supabase = mockSupabase({ status: 'completed', expires_at: past });
    const result = await checkGalleryWritable(supabase, 'gallery-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(410);
  });

  it('allows writes to a completed gallery that the photographer reopened for selection', async () => {
    const supabase = mockSupabase({
      status: 'completed',
      expires_at: null,
      reopened_for_selection_at: new Date().toISOString(),
    });
    const result = await checkGalleryWritable(supabase, 'gallery-1');
    expect(result).toEqual({ ok: true });
  });

  it('still rejects an expired gallery even if it was reopened for selection', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const supabase = mockSupabase({
      status: 'completed',
      expires_at: past,
      reopened_for_selection_at: new Date().toISOString(),
    });
    const result = await checkGalleryWritable(supabase, 'gallery-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(410);
  });
});
