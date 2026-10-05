import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkGalleryWritable,
  decideIdentify,
  evaluateGalleryWritable,
  isGalleryExpired,
  resolveGalleryViewAccess,
} from './galleryAccess';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const PAST = '2026-05-01T00:00:00.000Z';
const FUTURE = '2026-07-01T00:00:00.000Z';

describe('isGalleryExpired', () => {
  it('treats null/undefined expiry as never expiring', () => {
    expect(isGalleryExpired(null, NOW)).toBe(false);
    expect(isGalleryExpired(undefined, NOW)).toBe(false);
  });
  it('compares against now', () => {
    expect(isGalleryExpired(PAST, NOW)).toBe(true);
    expect(isGalleryExpired(FUTURE, NOW)).toBe(false);
  });
});

describe('resolveGalleryViewAccess', () => {
  it('allows normal (writable-looking) access before expiry, regardless of status', () => {
    expect(resolveGalleryViewAccess({ status: 'in_progress', expires_at: FUTURE }, false, NOW)).toEqual({ ok: true, readOnly: false });
    expect(resolveGalleryViewAccess({ status: 'completed', expires_at: null }, false, NOW)).toEqual({ ok: true, readOnly: false });
  });

  it('blocks an expired gallery that was never completed or delivered', () => {
    expect(resolveGalleryViewAccess({ status: 'expired', expires_at: PAST }, false, NOW)).toEqual({ ok: false });
    expect(resolveGalleryViewAccess({ status: 'in_progress', expires_at: PAST, delivered_at: null }, false, NOW)).toEqual({ ok: false });
  });

  it('keeps an expired but completed gallery open read-only', () => {
    expect(resolveGalleryViewAccess({ status: 'completed', expires_at: PAST }, false, NOW)).toEqual({ ok: true, readOnly: true });
  });

  it('keeps an expired gallery with delivered photos open read-only (delivered_at or rows)', () => {
    expect(resolveGalleryViewAccess({ status: 'expired', expires_at: PAST, delivered_at: PAST }, false, NOW)).toEqual({
      ok: true,
      readOnly: true,
    });
    expect(resolveGalleryViewAccess({ status: 'expired', expires_at: PAST }, true, NOW)).toEqual({ ok: true, readOnly: true });
  });
});

describe('evaluateGalleryWritable', () => {
  it('still blocks writes on an expired gallery that is readable read-only', () => {
    const gallery = { status: 'completed', expires_at: PAST, reopened_for_selection_at: null };
    expect(resolveGalleryViewAccess(gallery, true, NOW).ok).toBe(true);
    expect(evaluateGalleryWritable(gallery, NOW)).toMatchObject({ ok: false, status: 410 });
  });
});

describe('decideIdentify', () => {
  it('lets the first visitor (no participant yet) claim the owner ("כן, זאת אני")', () => {
    expect(decideIdentify({ sessionParticipantId: null, ownerParticipantId: 'owner', asOwner: true })).toEqual({ kind: 'owner' });
  });

  it('creates a guest for a first visitor who typed a name', () => {
    expect(decideIdentify({ sessionParticipantId: null, ownerParticipantId: 'owner', asOwner: false })).toEqual({ kind: 'guest' });
  });

  it('rejects a guest session trying to upgrade itself to owner', () => {
    expect(decideIdentify({ sessionParticipantId: 'guest-1', ownerParticipantId: 'owner', asOwner: true })).toMatchObject({
      kind: 'reject',
      status: 403,
    });
  });

  it('reuses the existing participant on repeat calls instead of creating another one', () => {
    expect(decideIdentify({ sessionParticipantId: 'guest-1', ownerParticipantId: 'owner', asOwner: false })).toEqual({
      kind: 'reuse',
      participantId: 'guest-1',
    });
    expect(decideIdentify({ sessionParticipantId: 'owner', ownerParticipantId: 'owner', asOwner: true })).toEqual({
      kind: 'reuse',
      participantId: 'owner',
    });
  });

  it('errors when claiming owner on a gallery without a registered owner', () => {
    expect(decideIdentify({ sessionParticipantId: null, ownerParticipantId: null, asOwner: true })).toMatchObject({
      kind: 'reject',
      status: 500,
    });
  });
});

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
