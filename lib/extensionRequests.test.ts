import { describe, it, expect } from 'vitest';
import {
  EXTENSION_LIMIT_REACHED_MESSAGE,
  EXTENSION_MAX_REQUESTS,
  EXTENSION_PENDING_MESSAGE,
  computeExtendedDeadline,
  daysLeftInIsrael,
  deadlineWarning,
  deadlineWarningText,
  decideNewExtensionRequest,
  extensionButtonMode,
  isMissingTableError,
  parseRequestedDays,
  planExtensionApproval,
  summarizeExtensionRequests,
} from './extensionRequests';

// 2026-10-05 11:00 בישראל (שעון קיץ, +3)
const now = new Date('2026-10-05T08:00:00Z');
// סוף היום בישראל
const endOfDay = (d: string) => `${d}T20:59:59.000Z`;

describe('parseRequestedDays', () => {
  it('accepts integers 1..7', () => {
    expect(parseRequestedDays(2)).toEqual({ ok: true, days: 2 });
    expect(parseRequestedDays(7)).toEqual({ ok: true, days: 7 });
    expect(parseRequestedDays(1)).toEqual({ ok: true, days: 1 });
    expect(parseRequestedDays('4')).toEqual({ ok: true, days: 4 });
  });
  it('rejects anything else', () => {
    for (const v of [0, 8, 30, -1, 2.5, NaN, null, undefined, '', 'abc', {}]) {
      expect(parseRequestedDays(v).ok).toBe(false);
    }
  });
});

describe('summarizeExtensionRequests', () => {
  it('counts every request, finds pending and the last decision', () => {
    const s = summarizeExtensionRequests([
      { id: 'a', requested_days: 4, status: 'declined', created_at: '2026-10-01T10:00:00Z', decided_at: '2026-10-01T12:00:00Z' },
      { id: 'b', requested_days: 7, status: 'pending', created_at: '2026-10-04T10:00:00Z' },
    ]);
    expect(s.requestsUsed).toBe(2);
    expect(s.maxRequests).toBe(EXTENSION_MAX_REQUESTS);
    expect(s.pending).toEqual({ id: 'b', days: 7, createdAt: '2026-10-04T10:00:00Z' });
    expect(s.lastDecision).toEqual({ status: 'declined', days: 4, decidedAt: '2026-10-01T12:00:00Z' });
  });
  it('empty', () => {
    expect(summarizeExtensionRequests([])).toEqual({ requestsUsed: 0, maxRequests: 2, pending: null, lastDecision: null });
  });
  it('latest decision wins', () => {
    const s = summarizeExtensionRequests([
      { id: 'a', requested_days: 2, status: 'approved', created_at: '2026-10-01T10:00:00Z', decided_at: '2026-10-03T12:00:00Z' },
      { id: 'b', requested_days: 7, status: 'declined', created_at: '2026-10-01T09:00:00Z', decided_at: '2026-10-02T12:00:00Z' },
    ]);
    expect(s.lastDecision?.status).toBe('approved');
  });
});

describe('decideNewExtensionRequest', () => {
  const open = { status: 'in_progress', expires_at: endOfDay('2026-10-07') };
  it('allows the owner while selection is open', () => {
    expect(decideNewExtensionRequest({ gallery: open, isOwner: true, requestsUsed: 0, hasPending: false })).toEqual({ ok: true });
    expect(decideNewExtensionRequest({ gallery: open, isOwner: true, requestsUsed: 1, hasPending: false })).toEqual({ ok: true });
  });
  it('blocks guests', () => {
    const d = decideNewExtensionRequest({ gallery: open, isOwner: false, requestsUsed: 0, hasPending: false });
    expect(d).toMatchObject({ ok: false, httpStatus: 403 });
  });
  it('blocks after 2 requests in total', () => {
    const d = decideNewExtensionRequest({ gallery: open, isOwner: true, requestsUsed: 2, hasPending: false });
    expect(d).toEqual({ ok: false, httpStatus: 409, error: EXTENSION_LIMIT_REACHED_MESSAGE });
  });
  it('blocks while one is pending', () => {
    const d = decideNewExtensionRequest({ gallery: open, isOwner: true, requestsUsed: 1, hasPending: true });
    expect(d).toEqual({ ok: false, httpStatus: 409, error: EXTENSION_PENDING_MESSAGE });
  });
  it('blocks a finished selection, delivered gallery, or no deadline', () => {
    expect(decideNewExtensionRequest({ gallery: { status: 'completed', expires_at: open.expires_at }, isOwner: true, requestsUsed: 0, hasPending: false }).ok).toBe(false);
    expect(decideNewExtensionRequest({ gallery: { ...open, delivered_at: '2026-10-01T00:00:00Z' }, isOwner: true, requestsUsed: 0, hasPending: false }).ok).toBe(false);
    expect(decideNewExtensionRequest({ gallery: { status: 'sent', expires_at: null }, isOwner: true, requestsUsed: 0, hasPending: false }).ok).toBe(false);
  });
  it('allows a reopened completed selection', () => {
    const g = { status: 'completed', expires_at: open.expires_at, reopened_for_selection_at: '2026-10-04T00:00:00Z' };
    expect(decideNewExtensionRequest({ gallery: g, isOwner: true, requestsUsed: 0, hasPending: false })).toEqual({ ok: true });
  });
});

describe('deadline banner', () => {
  it('days left by Israel calendar day', () => {
    expect(daysLeftInIsrael(endOfDay('2026-10-05'), now)).toBe(0);
    expect(daysLeftInIsrael(endOfDay('2026-10-06'), now)).toBe(1);
    expect(daysLeftInIsrael(endOfDay('2026-10-08'), now)).toBe(3);
    expect(daysLeftInIsrael(null, now)).toBeNull();
  });
  it('late evening UTC is already the next day in Israel', () => {
    // 22:30 UTC on Oct 5 = Oct 6 01:30 in Israel -> deadline at end of Oct 6 is "today"
    expect(daysLeftInIsrael(endOfDay('2026-10-06'), new Date('2026-10-05T22:30:00Z'))).toBe(0);
  });
  it('wording', () => {
    expect(deadlineWarningText(0)).toBe('⏳ היום הוא היום האחרון לבחירה');
    expect(deadlineWarningText(1)).toBe('⏳ נשאר יום אחד לבחירה');
    expect(deadlineWarningText(3)).toBe('⏳ נשארו 3 ימים לבחירה');
  });
  it('shows only within 3 days and before expiry', () => {
    expect(deadlineWarning(endOfDay('2026-10-08'), now)).toEqual({ daysLeft: 3, text: '⏳ נשארו 3 ימים לבחירה' });
    expect(deadlineWarning(endOfDay('2026-10-05'), now)?.daysLeft).toBe(0);
    expect(deadlineWarning(endOfDay('2026-10-09'), now)).toBeNull();
    expect(deadlineWarning('2026-10-05T07:00:00Z', now)).toBeNull();
    expect(deadlineWarning(null, now)).toBeNull();
    expect(deadlineWarning('garbage', now)).toBeNull();
  });
});

describe('extensionButtonMode', () => {
  const base = { available: true, isOwner: true, selectionOpen: true, requestsUsed: 0, hasPending: false };
  it('button for the owner', () => expect(extensionButtonMode(base)).toBe('button'));
  it('hidden for guests / closed / missing table', () => {
    expect(extensionButtonMode({ ...base, isOwner: false })).toBe('hidden');
    expect(extensionButtonMode({ ...base, selectionOpen: false })).toBe('hidden');
    expect(extensionButtonMode({ ...base, available: false })).toBe('hidden');
  });
  it('pending and limit', () => {
    expect(extensionButtonMode({ ...base, requestsUsed: 1, hasPending: true })).toBe('pending');
    expect(extensionButtonMode({ ...base, requestsUsed: 2 })).toBe('limit_reached');
    expect(extensionButtonMode({ ...base, requestsUsed: 2, hasPending: true })).toBe('pending');
  });
});

describe('computeExtendedDeadline', () => {
  it('extends from the current future deadline', () => {
    expect(computeExtendedDeadline(endOfDay('2026-10-07'), 4, now)).toBe(endOfDay('2026-10-11'));
  });
  it('extends from today when already expired', () => {
    expect(computeExtendedDeadline(endOfDay('2026-10-01'), 2, now)).toBe(endOfDay('2026-10-07'));
    expect(computeExtendedDeadline(null, 7, now)).toBe(endOfDay('2026-10-12'));
  });
  it('handles the switch to winter time (+2)', () => {
    // 2026-10-25 שעון חורף בישראל -> סוף היום ב-21:59:59 UTC
    expect(computeExtendedDeadline(endOfDay('2026-10-22'), 7, now)).toBe('2026-10-29T21:59:59.000Z');
  });
});

describe('planExtensionApproval', () => {
  it('active gallery: extends, no status change, guards status + expires_at', () => {
    const p = planExtensionApproval({ status: 'in_progress', expiresAt: endOfDay('2026-10-07'), days: 2, ownerHasSelections: true, now });
    expect(p).toEqual({
      newExpiresAt: endOfDay('2026-10-09'),
      reactivatedStatus: null,
      guard: { status: 'in_progress', expires_at: endOfDay('2026-10-07') },
    });
  });
  it('expired gallery is reactivated (sent / in_progress by owner selections)', () => {
    const base = { status: 'expired', expiresAt: endOfDay('2026-10-01'), days: 7, now };
    expect(planExtensionApproval({ ...base, ownerHasSelections: true }).reactivatedStatus).toBe('in_progress');
    expect(planExtensionApproval({ ...base, ownerHasSelections: false }).reactivatedStatus).toBe('sent');
    expect(planExtensionApproval({ ...base, ownerHasSelections: false }).newExpiresAt).toBe(endOfDay('2026-10-12'));
  });
  it('null expiry guards with null', () => {
    expect(planExtensionApproval({ status: 'sent', expiresAt: null, days: 2, ownerHasSelections: false, now }).guard).toEqual({ status: 'sent', expires_at: null });
  });
});

describe('isMissingTableError', () => {
  it('detects undefined table', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTableError({ message: "Could not find the table 'public.gallery_extension_requests' in the schema cache" })).toBe(true);
    expect(isMissingTableError({ code: '23505', message: 'duplicate' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
