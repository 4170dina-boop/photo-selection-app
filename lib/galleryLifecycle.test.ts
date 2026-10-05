import { describe, it, expect } from 'vitest';
import {
  canDeliverFinals,
  canStartEditing,
  expiresAtChanged,
  isReminderEligible,
  isSelectionFinal,
  originalsUploadBlockReason,
  statusAfterExpiryChange,
} from './galleryLifecycle';

const now = new Date('2026-10-05T08:00:00Z');
const future = '2026-10-20T20:59:59.999Z';
const past = '2026-10-01T20:59:59.999Z';
const reopened = '2026-10-04T10:00:00Z';

describe('isSelectionFinal / canDeliverFinals', () => {
  it('requires completed and not reopened', () => {
    expect(isSelectionFinal({ status: 'completed', reopened_for_selection_at: null })).toBe(true);
    expect(canDeliverFinals({ status: 'completed' })).toBe(true);
    expect(canDeliverFinals({ status: 'completed', reopened_for_selection_at: reopened })).toBe(false);
    for (const status of ['draft', 'sent', 'in_progress', 'expired', null]) {
      expect(canDeliverFinals({ status, reopened_for_selection_at: null })).toBe(false);
    }
  });
});

describe('canStartEditing', () => {
  it('only for completed galleries', () => {
    expect(canStartEditing({ status: 'completed' })).toBe(true);
    expect(canStartEditing({ status: 'completed', reopened_for_selection_at: reopened })).toBe(true);
    expect(canStartEditing({ status: 'in_progress' })).toBe(false);
    expect(canStartEditing({ status: 'expired' })).toBe(false);
  });
});

describe('statusAfterExpiryChange', () => {
  const base = { status: 'expired', oldExpiresAt: past, ownerHasSelections: false, now };

  it('reactivates an expired gallery when the new expiry is in the future or removed', () => {
    expect(statusAfterExpiryChange({ ...base, newExpiresAt: future })).toBe('sent');
    expect(statusAfterExpiryChange({ ...base, newExpiresAt: null })).toBe('sent');
    expect(statusAfterExpiryChange({ ...base, newExpiresAt: future, ownerHasSelections: true })).toBe('in_progress');
  });

  it('keeps it expired when the new expiry is still in the past (or invalid)', () => {
    expect(statusAfterExpiryChange({ ...base, newExpiresAt: past })).toBeNull();
    expect(statusAfterExpiryChange({ ...base, newExpiresAt: now.toISOString() })).toBeNull();
    expect(statusAfterExpiryChange({ ...base, newExpiresAt: 'not a date' })).toBeNull();
  });

  it('never touches non-expired galleries', () => {
    for (const status of ['draft', 'sent', 'in_progress', 'completed']) {
      expect(statusAfterExpiryChange({ ...base, status, newExpiresAt: future })).toBeNull();
    }
  });
});

describe('expiresAtChanged', () => {
  it('compares instants, not strings', () => {
    expect(expiresAtChanged('2026-10-20T20:59:59.999Z', '2026-10-20T23:59:59.999+03:00')).toBe(false);
    expect(expiresAtChanged(past, future)).toBe(true);
    expect(expiresAtChanged(null, future)).toBe(true);
    expect(expiresAtChanged(future, null)).toBe(true);
    expect(expiresAtChanged(null, undefined)).toBe(false);
  });
});

describe('isReminderEligible', () => {
  it('includes only galleries still in selection with a future expiry', () => {
    expect(isReminderEligible({ status: 'sent', expires_at: future }, now)).toBe(true);
    expect(isReminderEligible({ status: 'in_progress', expires_at: future }, now)).toBe(true);
    expect(isReminderEligible({ status: 'completed', reopened_for_selection_at: reopened, expires_at: future }, now)).toBe(true);
  });

  it('excludes completed, expired, draft, past or missing expiry', () => {
    expect(isReminderEligible({ status: 'completed', reopened_for_selection_at: null, expires_at: future }, now)).toBe(false);
    expect(isReminderEligible({ status: 'expired', expires_at: future }, now)).toBe(false);
    expect(isReminderEligible({ status: 'draft', expires_at: future }, now)).toBe(false);
    expect(isReminderEligible({ status: 'in_progress', expires_at: past }, now)).toBe(false);
    expect(isReminderEligible({ status: 'sent', expires_at: null }, now)).toBe(false);
  });
});

describe('originalsUploadBlockReason', () => {
  it('allows uploads while the client is selecting', () => {
    expect(originalsUploadBlockReason({ status: 'sent', expires_at: future }, now)).toBeNull();
    expect(originalsUploadBlockReason({ status: 'in_progress', expires_at: null }, now)).toBeNull();
    expect(originalsUploadBlockReason({ status: 'draft' }, now)).toBeNull();
    expect(originalsUploadBlockReason({ status: 'completed', reopened_for_selection_at: reopened }, now)).toBeNull();
  });

  it('blocks completed (not reopened), expired, and cleaned-up galleries', () => {
    expect(originalsUploadBlockReason({ status: 'completed', reopened_for_selection_at: null }, now)).toMatch(/סיימה לבחור/);
    expect(originalsUploadBlockReason({ status: 'expired', expires_at: future }, now)).toMatch(/תוקף/);
    expect(originalsUploadBlockReason({ status: 'in_progress', expires_at: past }, now)).toMatch(/תוקף/);
    expect(
      originalsUploadBlockReason({ status: 'completed', reopened_for_selection_at: reopened, originals_cleaned_up_at: past }, now)
    ).toMatch(/נמחקו/);
  });
});
