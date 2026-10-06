import { describe, it, expect } from 'vitest';
import {
  planExpiryActions,
  isAnniversaryEmailDue,
  anniversaryQueryBounds,
  isMissingTableError,
  ANNIVERSARY_MIN_DAYS,
} from './cronTick';
import { israelEndOfDayIso } from './israelTime';

describe('planExpiryActions (Shabbat/Yom Tov aware expiry)', () => {
  const respectAll = () => true;

  it('extends a gallery expiring on Shabbat (even before it passed) and expires weekday ones', () => {
    // שבת 10.10.2026, 11:00 בישראל
    const now = new Date('2026-10-10T08:00:00Z');
    const plan = planExpiryActions(
      [
        { id: 'shabbat', expires_at: israelEndOfDayIso('2026-10-10'), photographer_id: 'p' },
        { id: 'thursday', expires_at: israelEndOfDayIso('2026-10-08'), photographer_id: 'p' },
        { id: 'future-weekday', expires_at: israelEndOfDayIso('2026-10-12'), photographer_id: 'p' },
        { id: 'no-date', expires_at: null, photographer_id: 'p' },
      ],
      respectAll,
      now
    );
    expect(plan.extend).toEqual([
      { id: 'shabbat', from: israelEndOfDayIso('2026-10-10'), to: israelEndOfDayIso('2026-10-11') },
    ]);
    expect(plan.expire).toEqual(['thursday']);
  });

  it('a Shabbat expiry that is already past its effective date just expires', () => {
    const now = new Date('2026-10-12T08:00:00Z'); // שני
    const plan = planExpiryActions([{ id: 'g', expires_at: israelEndOfDayIso('2026-10-10'), photographer_id: 'p' }], respectAll, now);
    expect(plan.extend).toEqual([]);
    expect(plan.expire).toEqual(['g']);
  });

  it('photographer with respect_shabbat=false: no extension', () => {
    const now = new Date('2026-10-11T08:00:00Z');
    const plan = planExpiryActions([{ id: 'g', expires_at: israelEndOfDayIso('2026-10-10'), photographer_id: 'p' }], () => false, now);
    expect(plan.extend).toEqual([]);
    expect(plan.expire).toEqual(['g']);
  });

  it('is idempotent: an already-extended gallery (Sunday expiry) is left alone', () => {
    const now = new Date('2026-10-11T08:00:00Z');
    const plan = planExpiryActions([{ id: 'g', expires_at: israelEndOfDayIso('2026-10-11'), photographer_id: 'p' }], respectAll, now);
    expect(plan).toEqual({ extend: [], expire: [] });
  });
});

describe('isAnniversaryEmailDue', () => {
  const now = new Date('2026-10-06T08:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it('due between ~11 and 12 months after delivery, once', () => {
    expect(isAnniversaryEmailDue(daysAgo(ANNIVERSARY_MIN_DAYS), null, now)).toBe(true);
    expect(isAnniversaryEmailDue(daysAgo(350), null, now)).toBe(true);
    expect(isAnniversaryEmailDue(daysAgo(365), null, now)).toBe(true);
    expect(isAnniversaryEmailDue(daysAgo(ANNIVERSARY_MIN_DAYS - 1), null, now)).toBe(false);
    expect(isAnniversaryEmailDue(daysAgo(400), null, now)).toBe(false);
    expect(isAnniversaryEmailDue(daysAgo(350), now.toISOString(), now)).toBe(false);
    expect(isAnniversaryEmailDue(null, null, now)).toBe(false);
  });

  it('query bounds include the whole window', () => {
    const { from, to } = anniversaryQueryBounds(now);
    expect(from < daysAgo(365)).toBe(true);
    expect(to > daysAgo(ANNIVERSARY_MIN_DAYS)).toBe(true);
  });
});

describe('isMissingTableError', () => {
  it('detects missing tables', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTableError({ code: '23505', message: 'duplicate' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
