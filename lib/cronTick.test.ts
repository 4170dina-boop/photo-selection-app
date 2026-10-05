import { describe, it, expect } from 'vitest';
import {
  isCronAuthorized,
  resolveExpiryReminderDays,
  isExpiryReminderDue,
  isOriginalsCleanupDue,
  originalsDeletionDate,
  deletableOriginalPaths,
  fetchAllPages,
  MAX_EXPIRY_REMINDER_DAYS,
} from './cronTick';
import { israelEndOfDayIso } from './israelTime';

const DAY = 24 * 60 * 60 * 1000;

describe('isCronAuthorized', () => {
  it('accepts only the exact Bearer header', () => {
    expect(isCronAuthorized('Bearer s3cret', 's3cret')).toBe(true);
    expect(isCronAuthorized('Bearer wrong!', 's3cret')).toBe(false);
    expect(isCronAuthorized('s3cret', 's3cret')).toBe(false);
    expect(isCronAuthorized('Bearer s3cret ', 's3cret')).toBe(false);
  });

  it('rejects when no secret is configured or header missing', () => {
    expect(isCronAuthorized('Bearer ', '')).toBe(false);
    expect(isCronAuthorized('Bearer x', undefined)).toBe(false);
    expect(isCronAuthorized(null, 's3cret')).toBe(false);
  });
});

describe('expiry reminder', () => {
  it('resolves gallery value, then photographer default, then 5, clamped to the max window', () => {
    expect(resolveExpiryReminderDays(3, 7)).toBe(3);
    expect(resolveExpiryReminderDays(null, 7)).toBe(7);
    expect(resolveExpiryReminderDays(null, null)).toBe(5);
    expect(resolveExpiryReminderDays(500, null)).toBe(MAX_EXPIRY_REMINDER_DAYS);
  });

  it('is due within the window by Israel calendar days, and never after expiry', () => {
    const now = new Date('2026-10-05T08:00:00Z');
    expect(isExpiryReminderDue(israelEndOfDayIso('2026-10-10'), 5, now)).toBe(true);
    expect(isExpiryReminderDue(israelEndOfDayIso('2026-10-11'), 5, now)).toBe(false);
    expect(isExpiryReminderDue(israelEndOfDayIso('2026-10-05'), 5, now)).toBe(true);
    expect(isExpiryReminderDue(israelEndOfDayIso('2026-10-04'), 5, now)).toBe(false);
  });
});

describe('originals cleanup', () => {
  const now = new Date('2026-10-05T08:00:00Z');
  const deliveredLongAgo = new Date(now.getTime() - 40 * DAY).toISOString();

  it('refuses when the warning was never sent', () => {
    expect(
      isOriginalsCleanupDue(
        { delivered_at: deliveredLongAgo, originals_cleaned_up_at: null, originals_deletion_warning_sent_at: null },
        now
      )
    ).toBe(false);
  });

  it('refuses when the warning was sent less than 5 calendar days ago', () => {
    const warned = new Date(now.getTime() - 4 * DAY).toISOString();
    expect(
      isOriginalsCleanupDue(
        { delivered_at: deliveredLongAgo, originals_cleaned_up_at: null, originals_deletion_warning_sent_at: warned },
        now
      )
    ).toBe(false);
  });

  it('allows 5 calendar days after the warning even if the cron ran a few seconds earlier in the day', () => {
    const warned = new Date(now.getTime() - 5 * DAY + 30 * 1000).toISOString();
    expect(
      isOriginalsCleanupDue(
        { delivered_at: deliveredLongAgo, originals_cleaned_up_at: null, originals_deletion_warning_sent_at: warned },
        now
      )
    ).toBe(true);
  });

  it('refuses before 30 days from delivery, or if already cleaned', () => {
    const warned = new Date(now.getTime() - 10 * DAY).toISOString();
    expect(
      isOriginalsCleanupDue(
        {
          delivered_at: new Date(now.getTime() - 29 * DAY).toISOString(),
          originals_cleaned_up_at: null,
          originals_deletion_warning_sent_at: warned,
        },
        now
      )
    ).toBe(false);
    expect(
      isOriginalsCleanupDue(
        { delivered_at: deliveredLongAgo, originals_cleaned_up_at: now.toISOString(), originals_deletion_warning_sent_at: warned },
        now
      )
    ).toBe(false);
  });

  it('shows a deletion date no earlier than 5 days from the warning', () => {
    expect(originalsDeletionDate(deliveredLongAgo, now).getTime()).toBe(now.getTime() + 5 * DAY);
    const recent = new Date(now.getTime() - 20 * DAY).toISOString();
    expect(originalsDeletionDate(recent, now).getTime()).toBe(now.getTime() + 10 * DAY);
  });

  it('only deletes originals that have an independent thumbnail', () => {
    expect(
      deletableOriginalPaths([
        { file_path: 'g/a.jpg', thumbnail_path: 'g/thumbs/a.jpg' },
        { file_path: 'g/b.jpg', thumbnail_path: 'g/b.jpg' },
        { file_path: 'g/c.jpg', thumbnail_path: null },
      ])
    ).toEqual(['g/a.jpg']);
  });
});

describe('fetchAllPages', () => {
  it('pages until a short page', async () => {
    const all = Array.from({ length: 23 }, (_, i) => i);
    const calls: [number, number][] = [];
    const { rows, error } = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    }, 10);
    expect(error).toBeNull();
    expect(rows).toEqual(all);
    expect(calls).toEqual([[0, 9], [10, 19], [20, 29]]);
  });

  it('returns the error of a failing page', async () => {
    const { error } = await fetchAllPages(async (from) => (from === 0 ? { data: [1, 2], error: null } : { data: null, error: { message: 'boom' } }), 2);
    expect(error).toEqual({ message: 'boom' });
  });
});
