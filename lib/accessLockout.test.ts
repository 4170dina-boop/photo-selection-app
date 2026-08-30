import { describe, it, expect } from 'vitest';
import { isLockedOut, afterFailedAttempt, clearedLockoutState, MAX_ATTEMPTS, LOCKOUT_MINUTES } from './accessLockout';

describe('isLockedOut', () => {
  it('is not locked when locked_until is null', () => {
    expect(isLockedOut({ failed_access_attempts: 0, locked_until: null })).toBe(false);
  });

  it('is not locked when locked_until is undefined (no lockout row set yet)', () => {
    expect(isLockedOut(null)).toBe(false);
    expect(isLockedOut(undefined)).toBe(false);
  });

  it('is not locked once locked_until is in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isLockedOut({ failed_access_attempts: MAX_ATTEMPTS, locked_until: past })).toBe(false);
  });

  it('is locked while locked_until is in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isLockedOut({ failed_access_attempts: MAX_ATTEMPTS, locked_until: future })).toBe(true);
  });
});

describe('afterFailedAttempt', () => {
  it('increments attempts from zero/missing without locking', () => {
    const result = afterFailedAttempt(null);
    expect(result).toEqual({ failed_access_attempts: 1, locked_until: null });
  });

  it('keeps locked_until null while under MAX_ATTEMPTS', () => {
    const result = afterFailedAttempt({ failed_access_attempts: MAX_ATTEMPTS - 2, locked_until: null });
    expect(result.failed_access_attempts).toBe(MAX_ATTEMPTS - 1);
    expect(result.locked_until).toBeNull();
  });

  it('locks for LOCKOUT_MINUTES on reaching MAX_ATTEMPTS', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const result = afterFailedAttempt({ failed_access_attempts: MAX_ATTEMPTS - 1, locked_until: null }, now);
    expect(result.failed_access_attempts).toBe(MAX_ATTEMPTS);
    expect(result.locked_until).toBe(new Date(now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString());
  });

  it('keeps locking (does not reset) on further failures past MAX_ATTEMPTS', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const result = afterFailedAttempt({ failed_access_attempts: MAX_ATTEMPTS + 3, locked_until: null }, now);
    expect(result.failed_access_attempts).toBe(MAX_ATTEMPTS + 4);
    expect(result.locked_until).toBe(new Date(now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString());
  });
});

describe('clearedLockoutState', () => {
  it('resets attempts and lockout together', () => {
    expect(clearedLockoutState).toEqual({ failed_access_attempts: 0, locked_until: null });
  });
});
