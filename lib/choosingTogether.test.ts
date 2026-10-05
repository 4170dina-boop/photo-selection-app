import { describe, it, expect } from 'vitest';
import {
  computeTogetherFilters,
  photoIdsForTogetherFilter,
  mergeOthersMarks,
  newMarksByOthers,
  newMarksToastText,
  marksPollDelay,
  MARKS_POLL_MS,
  othersWhoSelected,
  buildAllMarks,
  onlyParticipantKey,
  type AllMarks,
} from './choosingTogether';

const mark = (participantId: string, status: string, displayName = participantId) => ({ participantId, displayName, status });

const photos = ['p1', 'p2', 'p3', 'p4', 'p5'];

describe('computeTogetherFilters', () => {
  it('hides the chips when only one participant has marks', () => {
    const f = computeTogetherFilters(photos, 'me', { p1: 'selected' }, { p1: [mark('me', 'selected')] });
    expect(f.show).toBe(false);
  });

  it('shows the chips with two participants and computes everyone/only lists', () => {
    const all: AllMarks = {
      p1: [mark('me', 'selected'), mark('yossi', 'selected')],
      p2: [mark('me', 'selected')],
      p3: [mark('yossi', 'selected')],
      p4: [mark('me', 'maybe'), mark('yossi', 'selected')],
      p5: [mark('yossi', 'maybe')],
    };
    const my = { p1: 'selected', p2: 'selected', p4: 'maybe' };
    const f = computeTogetherFilters(photos, 'me', my, all);
    expect(f.show).toBe(true);
    expect(f.everyone).toEqual(['p1']);
    expect(f.onlyMe).toEqual(['p2']);
    // "אולי" שלי לא נחשב בחירה - p4 עדיין "רק יוסי"
    expect(f.onlyOthers).toEqual([{ participantId: 'yossi', displayName: 'yossi', photoIds: ['p3', 'p4'] }]);
  });

  it('"everyone" requires every active participant to have selected the photo', () => {
    const all: AllMarks = {
      p1: [mark('a', 'selected'), mark('b', 'selected')],
      p2: [mark('a', 'selected')],
      p3: [mark('b', 'maybe')],
    };
    const my = { p1: 'selected', p2: 'selected' };
    const f = computeTogetherFilters(photos, 'me', my, all);
    expect(f.everyone).toEqual(['p1']);
    expect(f.onlyMe).toEqual([]);
  });

  it('uses my local statuses, not my (possibly stale) entry in allMarks', () => {
    const all: AllMarks = { p1: [mark('me', 'maybe'), mark('y', 'selected')] };
    const f = computeTogetherFilters(photos, 'me', { p1: 'selected' }, all);
    expect(f.everyone).toEqual(['p1']);
    expect(f.onlyOthers[0].photoIds).toEqual([]);
  });

  it('ignores marks on photos that are not in the gallery list', () => {
    const all: AllMarks = { gone: [mark('y', 'selected')], p1: [mark('z', 'selected')] };
    const f = computeTogetherFilters(photos, 'me', {}, all);
    expect(f.onlyOthers.map((o) => o.participantId)).toEqual(['z']);
    expect(f.show).toBe(false);
  });

  it('shows the chips for two other participants even if I have not marked yet', () => {
    const all: AllMarks = { p1: [mark('a', 'selected')], p2: [mark('b', 'maybe')] };
    const f = computeTogetherFilters(photos, 'me', {}, all);
    expect(f.show).toBe(true);
    expect(f.everyone).toEqual([]);
  });
});

describe('photoIdsForTogetherFilter', () => {
  const f = computeTogetherFilters(
    photos,
    'me',
    { p1: 'selected', p2: 'selected' },
    { p1: [mark('y', 'selected')], p3: [mark('y', 'selected')] }
  );
  it('resolves each key', () => {
    expect(photoIdsForTogetherFilter(f, 'together')).toEqual(['p1']);
    expect(photoIdsForTogetherFilter(f, 'onlyMe')).toEqual(['p2']);
    expect(photoIdsForTogetherFilter(f, onlyParticipantKey('y'))).toEqual(['p3']);
  });
  it('returns null for unknown keys', () => {
    expect(photoIdsForTogetherFilter(f, onlyParticipantKey('nobody'))).toBeNull();
    expect(photoIdsForTogetherFilter(f, 'all')).toBeNull();
  });
});

describe('mergeOthersMarks', () => {
  it('takes others from the server and keeps my local marks', () => {
    const local: AllMarks = { p1: [mark('me', 'selected'), mark('y', 'maybe')], p2: [mark('me', 'maybe')] };
    const server: AllMarks = { p1: [mark('me', 'maybe'), mark('y', 'selected')], p3: [mark('y', 'selected'), mark('me', 'selected')] };
    expect(mergeOthersMarks(local, server, 'me')).toEqual({
      p1: [mark('y', 'selected'), mark('me', 'selected')],
      p2: [mark('me', 'maybe')],
      p3: [mark('y', 'selected')],
    });
  });
  it('drops photos with no marks left', () => {
    expect(mergeOthersMarks({ p1: [mark('y', 'selected')] }, {}, 'me')).toEqual({});
  });
});

describe('newMarksByOthers', () => {
  it('counts new and changed marks of others, ignoring mine and removals', () => {
    const prev: AllMarks = { p1: [mark('y', 'maybe', 'יוסי')], p2: [mark('y', 'selected', 'יוסי')] };
    const next: AllMarks = {
      p1: [mark('y', 'selected', 'יוסי')],
      p3: [mark('y', 'selected', 'יוסי'), mark('me', 'selected')],
      p4: [mark('r', 'maybe', 'רותי')],
    };
    expect(newMarksByOthers(prev, next, 'me')).toEqual([
      { participantId: 'y', displayName: 'יוסי', count: 2 },
      { participantId: 'r', displayName: 'רותי', count: 1 },
    ]);
  });
  it('returns nothing when nothing changed', () => {
    const m: AllMarks = { p1: [mark('y', 'selected')] };
    expect(newMarksByOthers(m, m, 'me')).toEqual([]);
  });
});

describe('newMarksToastText', () => {
  it('formats singular and plural', () => {
    expect(newMarksToastText([{ displayName: 'יוסי', count: 3 }])).toBe('🔔 יוסי סימן/ה 3 תמונות חדשות');
    expect(newMarksToastText([{ displayName: 'רותי', count: 1 }])).toBe('🔔 רותי סימן/ה תמונה חדשה');
  });
  it('returns null for an empty list', () => {
    expect(newMarksToastText([])).toBeNull();
  });
});

describe('marksPollDelay', () => {
  it('backs off exponentially up to 5 minutes', () => {
    expect(marksPollDelay(0)).toBe(MARKS_POLL_MS);
    expect(marksPollDelay(1)).toBe(MARKS_POLL_MS * 2);
    expect(marksPollDelay(2)).toBe(MARKS_POLL_MS * 4);
    expect(marksPollDelay(50)).toBe(5 * 60_000);
  });
});

describe('othersWhoSelected', () => {
  it('lists only other participants who selected', () => {
    expect(othersWhoSelected([mark('me', 'selected'), mark('y', 'selected', 'יוסי'), mark('r', 'maybe')], 'me')).toEqual(['יוסי']);
    expect(othersWhoSelected(undefined, 'me')).toEqual([]);
  });
});

describe('buildAllMarks', () => {
  it('groups by photo and skips unknown participants', () => {
    expect(
      buildAllMarks(
        [
          { photo_id: 'p1', participant_id: 'a', status: 'selected' },
          { photo_id: 'p1', participant_id: 'ghost', status: 'selected' },
          { photo_id: 'p2', participant_id: 'a', status: 'maybe' },
        ],
        [{ id: 'a', displayName: 'אמא' }]
      )
    ).toEqual({ p1: [mark('a', 'selected', 'אמא')], p2: [mark('a', 'maybe', 'אמא')] });
  });
});
