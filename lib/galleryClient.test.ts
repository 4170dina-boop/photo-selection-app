import { describe, it, expect } from 'vitest';
import {
  enqueueAction,
  dropActionsAfterDirectSuccess,
  reconcileQueueAfterFlush,
  applyPendingToMarks,
  planSwipeTap,
  uniqueFileName,
  normalizeAccessCode,
  errorMessageFromBody,
  accessCodeFallbackError,
  hebrewDateInIsrael,
  rtlArrowDelta,
  isGalleryDataStale,
  zipDownloadSummary,
  queueHasPhoto,
  toggleStatusTo,
  shouldAutoAdvance,
  swipeNavDelta,
  enlargedShortcutStatus,
  tapHintKey,
  type PendingAction,
} from './galleryClient';

const s = (photoId: string, status: 'maybe' | 'selected' | null): PendingAction => ({ type: 'status', photoId, status });
const n = (photoId: string, note: string): PendingAction => ({ type: 'note', photoId, note });

describe('enqueueAction', () => {
  it('replaces an earlier action of the same type for the same photo', () => {
    expect(enqueueAction([s('a', 'maybe'), s('b', 'maybe')], s('a', 'selected'))).toEqual([s('b', 'maybe'), s('a', 'selected')]);
  });

  it('keeps the status action before a note for the same photo', () => {
    const q = enqueueAction([s('a', 'maybe'), n('a', 'bw'), s('b', 'maybe')], s('a', 'selected'));
    expect(q).toEqual([s('a', 'selected'), n('a', 'bw'), s('b', 'maybe')]);
  });

  it('appends a note after the status of the same photo', () => {
    expect(enqueueAction([s('a', 'maybe')], n('a', 'x'))).toEqual([s('a', 'maybe'), n('a', 'x')]);
  });

  it('does not mutate the input', () => {
    const q = [s('a', 'maybe')];
    enqueueAction(q, s('a', null));
    expect(q).toEqual([s('a', 'maybe')]);
  });
});

describe('dropActionsAfterDirectSuccess', () => {
  it('drops stale same-type entries for that photo only', () => {
    const q = [s('a', 'maybe'), n('a', 'x'), s('b', 'maybe')];
    expect(dropActionsAfterDirectSuccess(q, s('a', 'selected'))).toEqual([n('a', 'x'), s('b', 'maybe')]);
    expect(dropActionsAfterDirectSuccess(q, n('a', 'y'))).toEqual([s('a', 'maybe'), s('b', 'maybe')]);
  });

  it('drops notes too when the mark was removed', () => {
    expect(dropActionsAfterDirectSuccess([s('a', 'maybe'), n('a', 'x')], s('a', null))).toEqual([]);
  });
});

describe('reconcileQueueAfterFlush', () => {
  it('keeps actions added while the flush was running', () => {
    const processed = [s('a', 'maybe')];
    const stored = [s('a', 'maybe'), s('c', 'selected')];
    expect(reconcileQueueAfterFlush(stored, processed)).toEqual([s('c', 'selected')]);
  });

  it('keeps an action that was replaced by a newer version during the flush', () => {
    expect(reconcileQueueAfterFlush([s('a', 'selected')], [s('a', 'maybe')])).toEqual([s('a', 'selected')]);
  });

  it('removes each processed entry once', () => {
    expect(reconcileQueueAfterFlush([n('a', 'x'), n('a', 'x')], [n('a', 'x')])).toEqual([n('a', 'x')]);
  });
});

describe('queueHasPhoto', () => {
  it('detects entries for a photo', () => {
    expect(queueHasPhoto([n('a', 'x')], 'a')).toBe(true);
    expect(queueHasPhoto([n('a', 'x')], 'b')).toBe(false);
  });
});

describe('applyPendingToMarks', () => {
  it('re-applies queued changes on top of server marks and computes selected delta', () => {
    const server = { a: { status: 'maybe' as const, note: 'old', photographerReply: null } };
    const { marks, selectedDelta } = applyPendingToMarks(server, [s('a', 'selected'), n('a', ' new '), s('b', 'maybe'), s('g', 'selected')], (id) => id === 'g');
    expect(marks.a).toEqual({ status: 'selected', note: 'new', photographerReply: null });
    expect(marks.b.status).toBe('maybe');
    expect(selectedDelta).toBe(1); // g היא מתנה - לא נספרת
  });

  it('removes a mark that was cleared offline', () => {
    const server = { a: { status: 'selected' as const, note: null, photographerReply: null } };
    const { marks, selectedDelta } = applyPendingToMarks(server, [s('a', null)]);
    expect(marks).toEqual({});
    expect(selectedDelta).toBe(-1);
  });
});

describe('planSwipeTap', () => {
  const queue = ['p1', 'p2', 'p3'];

  it('skip only advances the cursor and never posts', () => {
    expect(planSwipeTap(0, queue, new Set(), 'skip', 'maybe')).toEqual({ nextCursor: 1, photoId: 'p1', post: null });
  });

  it('posts the chosen status and advances', () => {
    expect(planSwipeTap(1, queue, new Set(), 'selected')).toEqual({ nextCursor: 2, photoId: 'p2', post: 'selected' });
  });

  it('does not re-post the same status', () => {
    expect(planSwipeTap(1, queue, new Set(), 'maybe', 'maybe')?.post).toBeNull();
  });

  it('ignores taps while that photo is in flight, and past the end', () => {
    expect(planSwipeTap(0, queue, new Set(['p1']), 'selected')).toBeNull();
    expect(planSwipeTap(3, queue, new Set(), 'selected')).toBeNull();
  });
});

describe('uniqueFileName', () => {
  it('appends (2), (3) for duplicates, case-insensitively', () => {
    const used = new Set<string>();
    expect(uniqueFileName('a.jpg', used)).toBe('a.jpg');
    expect(uniqueFileName('A.jpg', used)).toBe('A (2).jpg');
    expect(uniqueFileName('a.jpg', used)).toBe('a (3).jpg');
    expect(uniqueFileName('noext', used)).toBe('noext');
    expect(uniqueFileName('noext', used)).toBe('noext (2)');
    expect(uniqueFileName('', used)).toBe('photo');
  });
});

describe('access code helpers', () => {
  it('normalizes the code', () => {
    expect(normalizeAccessCode('  ab12cd ')).toBe('AB12CD');
  });

  it('reads the server error or falls back', () => {
    expect(errorMessageFromBody({ error: 'יותר מדי' }, 'x')).toBe('יותר מדי');
    expect(errorMessageFromBody(null, 'x')).toBe('x');
    expect(errorMessageFromBody({ error: 5 }, 'x')).toBe('x');
    expect(accessCodeFallbackError(429)).toContain('נסי שוב');
    expect(accessCodeFallbackError(503)).toContain('לא זמין');
  });
});

describe('hebrewDateInIsrael', () => {
  it('uses the Israel calendar day, not UTC', () => {
    // 22:30Z ב-15.10.2026 = 01:30 ב-16.10 בישראל (UTC+3) => ה' בחשון תשפ"ז (16.10.2026)
    expect(hebrewDateInIsrael(new Date('2026-10-15T22:30:00Z'))).toBe(hebrewDateInIsrael(new Date('2026-10-16T09:00:00Z')));
    expect(hebrewDateInIsrael(new Date('2026-10-15T22:30:00Z'))).not.toBe(hebrewDateInIsrael(new Date('2026-10-15T09:00:00Z')));
  });
});

describe('misc', () => {
  it('maps arrows for RTL', () => {
    expect(rtlArrowDelta('ArrowLeft')).toBe(1);
    expect(rtlArrowDelta('ArrowRight')).toBe(-1);
    expect(rtlArrowDelta('Enter')).toBe(0);
  });

  it('detects stale data', () => {
    expect(isGalleryDataStale(null, 1e9)).toBe(false);
    expect(isGalleryDataStale(0, 49 * 60 * 1000)).toBe(false);
    expect(isGalleryDataStale(0, 50 * 60 * 1000)).toBe(true);
  });

  it('formats the zip summary', () => {
    expect(zipDownloadSummary(3, 5)).toBe('הורדו 3 מתוך 5 תמונות');
  });
});

describe('enlarged view selection', () => {
  it('toggles to a target status or clears it', () => {
    expect(toggleStatusTo(undefined, 'selected')).toBe('selected');
    expect(toggleStatusTo('maybe', 'selected')).toBe('selected');
    expect(toggleStatusTo('selected', 'selected')).toBeNull();
    expect(toggleStatusTo('selected', 'maybe')).toBe('maybe');
    expect(toggleStatusTo('maybe', 'maybe')).toBeNull();
  });

  it('auto-advances only after selecting, and not from the last photo', () => {
    expect(shouldAutoAdvance('selected', 0, 3)).toBe(true);
    expect(shouldAutoAdvance('selected', 2, 3)).toBe(false);
    expect(shouldAutoAdvance(null, 0, 3)).toBe(false);
    expect(shouldAutoAdvance('maybe', 0, 3)).toBe(false);
    expect(shouldAutoAdvance('selected', -1, 3)).toBe(false);
  });

  it('maps horizontal swipes with RTL semantics', () => {
    expect(swipeNavDelta(80, 10, false)).toBe(1);
    expect(swipeNavDelta(-80, 10, false)).toBe(-1);
    expect(swipeNavDelta(40, 0, false)).toBe(0);
    expect(swipeNavDelta(80, 90, false)).toBe(0);
    expect(swipeNavDelta(200, 0, true)).toBe(0);
  });

  it('maps S/M shortcuts by physical key, ignoring modifiers', () => {
    expect(enlargedShortcutStatus({ code: 'KeyS' })).toBe('selected');
    expect(enlargedShortcutStatus({ code: 'KeyM' })).toBe('maybe');
    expect(enlargedShortcutStatus({ code: 'KeyS', ctrlKey: true })).toBeNull();
    expect(enlargedShortcutStatus({ code: 'KeyX' })).toBeNull();
  });

  it('builds the hint key per gallery', () => {
    expect(tapHintKey('g1')).toBe('gallery_tap_hint_v2_g1');
  });
});
