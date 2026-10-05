import { describe, it, expect } from 'vitest';
import {
  isOriginalsCleanupDue,
  originalsCleanupClaimGuard,
  shouldReleaseCleanupClaim,
  type OriginalsCleanupCandidate,
} from './cronTick';
import {
  decideReopenToggle,
  REOPEN_NOT_COMPLETED_MESSAGE,
  REOPEN_ORIGINALS_DELETED_MESSAGE,
  statusAfterExpiryChange,
  statusGuard,
} from './galleryLifecycle';
import type { RowGuard } from './rowGuard';

// סימולציה של UPDATE מותנה על שורה אחת: חל רק אם כל תנאי ה-guard מתקיימים
// (כמו ב-Postgres, שבודק את ה-WHERE מחדש אחרי נעילת השורה).
type Row = Record<string, string | null> & { status: string | null };
function conditionalUpdate(row: Row, guard: RowGuard, patch: Record<string, string | null>): boolean {
  for (const [k, v] of Object.entries(guard)) {
    if ((row[k] ?? null) !== v) return false;
  }
  Object.assign(row, patch);
  return true;
}

const now = new Date('2026-10-05T08:00:00Z');

function eligibleGallery(): OriginalsCleanupCandidate {
  return {
    status: 'completed',
    reopened_for_selection_at: null,
    delivered_at: '2026-08-01T10:00:00Z',
    originals_cleaned_up_at: null,
    originals_deletion_warning_sent_at: '2026-09-20T08:00:00Z',
  };
}

describe('originalsCleanupClaimGuard', () => {
  it('pins exactly the state that isOriginalsCleanupDue approved', () => {
    const g = eligibleGallery();
    expect(isOriginalsCleanupDue(g, now)).toBe(true);
    expect(originalsCleanupClaimGuard(g)).toEqual({
      status: 'completed',
      reopened_for_selection_at: null,
      originals_cleaned_up_at: null,
      delivered_at: g.delivered_at,
      originals_deletion_warning_sent_at: g.originals_deletion_warning_sent_at,
    });
  });

  it('race: photographer reopens after cron read -> claim fails, nothing deleted', () => {
    const row: Row = { ...eligibleGallery() };
    const cronSnapshot = { ...eligibleGallery() }; // ה-cron קרא את השורה כזכאית
    expect(isOriginalsCleanupDue(cronSnapshot, now)).toBe(true);

    const reopen = decideReopenToggle(row, now);
    expect(reopen.ok).toBe(true);
    if (!reopen.ok) return;
    expect(conditionalUpdate(row, reopen.guard, { reopened_for_selection_at: reopen.newReopenedForSelectionAt })).toBe(true);

    const claimed = conditionalUpdate(row, originalsCleanupClaimGuard(cronSnapshot), { originals_cleaned_up_at: now.toISOString() });
    expect(claimed).toBe(false);
    expect(row.originals_cleaned_up_at).toBeNull();
  });

  it('race: cron claims first -> reopen read before the claim fails', () => {
    const row: Row = { ...eligibleGallery() };
    const reopen = decideReopenToggle(row, now); // הצלמת קראה לפני התפיסה
    expect(reopen.ok).toBe(true);
    if (!reopen.ok) return;

    expect(conditionalUpdate(row, originalsCleanupClaimGuard(eligibleGallery()), { originals_cleaned_up_at: now.toISOString() })).toBe(true);
    expect(conditionalUpdate(row, reopen.guard, { reopened_for_selection_at: reopen.newReopenedForSelectionAt })).toBe(false);
    expect(row.reopened_for_selection_at).toBeNull();
  });

  it('race: delivery un-marked/re-marked after read -> claim fails', () => {
    const row: Row = { ...eligibleGallery(), delivered_at: '2026-10-04T10:00:00Z' };
    expect(conditionalUpdate(row, originalsCleanupClaimGuard(eligibleGallery()), { originals_cleaned_up_at: 'x' })).toBe(false);
  });

  it('a second concurrent cron run cannot claim the same gallery twice', () => {
    const row: Row = { ...eligibleGallery() };
    const guard = originalsCleanupClaimGuard(eligibleGallery());
    expect(conditionalUpdate(row, guard, { originals_cleaned_up_at: 'a' })).toBe(true);
    expect(conditionalUpdate(row, guard, { originals_cleaned_up_at: 'b' })).toBe(false);
  });
});

describe('shouldReleaseCleanupClaim', () => {
  it('releases only while the originals are still intact', () => {
    expect(shouldReleaseCleanupClaim(0)).toBe(true);
    expect(shouldReleaseCleanupClaim(1)).toBe(false);
    expect(shouldReleaseCleanupClaim(250)).toBe(false);
  });
});

describe('decideReopenToggle', () => {
  it('opens a completed gallery, guarded on not cleaned / not reopened', () => {
    const d = decideReopenToggle({ status: 'completed', reopened_for_selection_at: null, originals_cleaned_up_at: null }, now);
    expect(d).toEqual({
      ok: true,
      newReopenedForSelectionAt: now.toISOString(),
      guard: { status: 'completed', reopened_for_selection_at: null, originals_cleaned_up_at: null },
    });
  });

  it('closing is always allowed, guarded on the current marker', () => {
    const d = decideReopenToggle({ status: 'completed', reopened_for_selection_at: '2026-10-01T00:00:00Z', originals_cleaned_up_at: null }, now);
    expect(d).toEqual({ ok: true, newReopenedForSelectionAt: null, guard: { reopened_for_selection_at: '2026-10-01T00:00:00Z' } });
  });

  it('refuses a gallery still in selection', () => {
    expect(decideReopenToggle({ status: 'in_progress', reopened_for_selection_at: null }, now)).toEqual({
      ok: false,
      httpStatus: 400,
      error: REOPEN_NOT_COMPLETED_MESSAGE,
    });
  });

  it('refuses when originals were already cleaned up', () => {
    expect(
      decideReopenToggle({ status: 'completed', reopened_for_selection_at: null, originals_cleaned_up_at: '2026-09-01T00:00:00Z' }, now)
    ).toEqual({ ok: false, httpStatus: 409, error: REOPEN_ORIGINALS_DELETED_MESSAGE });
  });
});

describe('statusGuard (gallery edit vs cron expire)', () => {
  it('maps status to an equality guard, null to IS NULL', () => {
    expect(statusGuard('in_progress')).toEqual({ status: 'in_progress' });
    expect(statusGuard(null)).toEqual({ status: null });
    expect(statusGuard(undefined)).toEqual({ status: null });
  });

  it('race: cron expires between read and write -> first write misses, retry reactivates', () => {
    const row: Row = { status: 'in_progress', expires_at: '2026-10-04T20:59:59.999Z' };
    const newExpiresAt = '2026-10-30T20:59:59.999Z';

    // הצלמת קראה in_progress -> אין שינוי סטטוס
    const firstRead = row.status;
    const firstStatus = statusAfterExpiryChange({ status: firstRead, oldExpiresAt: row.expires_at, newExpiresAt, ownerHasSelections: true, now });
    expect(firstStatus).toBeNull();

    // ה-cron מסמן expired בינתיים
    expect(conditionalUpdate(row, { status: 'in_progress' }, { status: 'expired' })).toBe(true);

    // הכתיבה המותנית נכשלת (הייתה משאירה expired עם תוקף עתידי)
    expect(conditionalUpdate(row, statusGuard(firstRead), { expires_at: newExpiresAt })).toBe(false);

    // ניסיון חוזר על המצב העדכני מחזיר את הגלריה לפעילה
    const retryStatus = statusAfterExpiryChange({ status: row.status, oldExpiresAt: row.expires_at, newExpiresAt, ownerHasSelections: true, now });
    expect(retryStatus).toBe('in_progress');
    expect(conditionalUpdate(row, statusGuard(row.status), { expires_at: newExpiresAt, status: retryStatus })).toBe(true);
    expect(row).toEqual({ status: 'in_progress', expires_at: newExpiresAt });
  });
});
