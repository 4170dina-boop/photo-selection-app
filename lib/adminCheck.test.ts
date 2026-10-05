import { describe, expect, it } from 'vitest';
import { isAdminUser } from './adminCheck';

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
