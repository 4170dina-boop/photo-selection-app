import { describe, expect, it } from 'vitest';
import { isAdminLockedToUserId, isAdminUser, once } from './adminCheck';

describe('isAdminLockedToUserId', () => {
  it('is true only when ADMIN_USER_ID has a non-blank value', () => {
    expect(isAdminLockedToUserId({ ADMIN_USER_ID: 'u1' })).toBe(true);
    expect(isAdminLockedToUserId({ ADMIN_USER_ID: ' u1 ' })).toBe(true);
    expect(isAdminLockedToUserId({ ADMIN_USER_ID: '   ' })).toBe(false);
    expect(isAdminLockedToUserId({ ADMIN_USER_ID: '' })).toBe(false);
    expect(isAdminLockedToUserId({ ADMIN_EMAIL: 'admin@example.com' })).toBe(false);
  });

  it('without ADMIN_USER_ID the confirmed ADMIN_EMAIL user is still admin (no hard lock)', () => {
    const user = { id: 'u1', email: 'admin@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
    const env = { ADMIN_EMAIL: 'admin@example.com' };
    expect(isAdminUser(user, env)).toBe(true);
    expect(isAdminLockedToUserId(env)).toBe(false);
  });

  it('with ADMIN_USER_ID set, another account registered with ADMIN_EMAIL is rejected', () => {
    const impostor = { id: 'attacker', email: 'admin@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
    expect(isAdminUser(impostor, { ADMIN_EMAIL: 'admin@example.com', ADMIN_USER_ID: 'u1' })).toBe(false);
  });
});

describe('once', () => {
  it('calls the wrapped function only on the first invocation', () => {
    const calls: string[] = [];
    const warn = once((id: string) => calls.push(id));
    warn('a');
    warn('b');
    warn('c');
    expect(calls).toEqual(['a']);
  });
});

const confirmed = { id: 'u1', email: 'Admin@Example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };

describe('isAdminUser', () => {
  it('accepts a confirmed matching email, case/whitespace-insensitive on both sides', () => {
    expect(isAdminUser(confirmed, { ADMIN_EMAIL: '  admin@example.COM ' })).toBe(true);
  });

  it('rejects when the email is not confirmed', () => {
    expect(isAdminUser({ ...confirmed, email_confirmed_at: null }, { ADMIN_EMAIL: 'admin@example.com' })).toBe(false);
    expect(isAdminUser({ id: 'u1', email: 'admin@example.com' }, { ADMIN_EMAIL: 'admin@example.com' })).toBe(false);
  });

  it('rejects other emails, missing user, or missing/blank ADMIN_EMAIL', () => {
    expect(isAdminUser(confirmed, { ADMIN_EMAIL: 'other@example.com' })).toBe(false);
    expect(isAdminUser(null, { ADMIN_EMAIL: 'admin@example.com' })).toBe(false);
    expect(isAdminUser(confirmed, {})).toBe(false);
    expect(isAdminUser(confirmed, { ADMIN_EMAIL: '   ' })).toBe(false);
    expect(isAdminUser({ ...confirmed, email: null }, { ADMIN_EMAIL: 'admin@example.com' })).toBe(false);
  });

  it('enforces ADMIN_USER_ID when set', () => {
    expect(isAdminUser(confirmed, { ADMIN_EMAIL: 'admin@example.com', ADMIN_USER_ID: 'u1' })).toBe(true);
    expect(isAdminUser(confirmed, { ADMIN_EMAIL: 'admin@example.com', ADMIN_USER_ID: ' u1 ' })).toBe(true);
    expect(isAdminUser(confirmed, { ADMIN_EMAIL: 'admin@example.com', ADMIN_USER_ID: 'u2' })).toBe(false);
    expect(isAdminUser(confirmed, { ADMIN_EMAIL: 'admin@example.com', ADMIN_USER_ID: '' })).toBe(true);
  });
});
