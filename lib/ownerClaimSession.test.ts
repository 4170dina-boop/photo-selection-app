import { describe, it, expect } from 'vitest';
import {
  browserStateAfterFailure,
  isBrowserOwnerClaimLocked,
  OWNER_CLAIM_GLOBAL_MAX_ATTEMPTS,
  parseAccessCodeDbResult,
  parseOwnerClaimBrowserState,
  parseOwnerClaimDbResult,
} from './ownerClaimSession';
import { MAX_ATTEMPTS } from './accessLockout';
import { isMissingFunctionError } from './rpcErrors';

const now = new Date('2026-10-06T10:00:00Z');

describe('parseOwnerClaimBrowserState', () => {
  it('fresh state for missing / malformed / other client cookies', () => {
    const fresh = { clientId: 'c1', failed_access_attempts: 0, locked_until: null };
    expect(parseOwnerClaimBrowserState(null, 'c1')).toEqual(fresh);
    expect(parseOwnerClaimBrowserState('x', 'c1')).toEqual(fresh);
    expect(parseOwnerClaimBrowserState({ clientId: 'c2', failed_access_attempts: 4, locked_until: null }, 'c1')).toEqual(fresh);
    expect(parseOwnerClaimBrowserState({ clientId: 'c1', failed_access_attempts: 'many', locked_until: 'nope' }, 'c1')).toEqual(fresh);
  });

  it('keeps a valid state', () => {
    const st = { clientId: 'c1', failed_access_attempts: 3, locked_until: null };
    expect(parseOwnerClaimBrowserState(st, 'c1')).toEqual(st);
  });
});

describe('browser owner-claim counter', () => {
  it('locks this browser after MAX_ATTEMPTS failures, with the same rules as the access code', () => {
    let st = parseOwnerClaimBrowserState(null, 'c1');
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) st = browserStateAfterFailure(st, now);
    expect(isBrowserOwnerClaimLocked(st, now)).toBe(false);
    st = browserStateAfterFailure(st, now);
    expect(st.clientId).toBe('c1');
    expect(isBrowserOwnerClaimLocked(st, now)).toBe(true);
    // אחרי שהנעילה פגה - הטעות הבאה נספרת מ-1
    const later = new Date(now.getTime() + 16 * 60_000);
    expect(isBrowserOwnerClaimLocked(st, later)).toBe(false);
    expect(browserStateAfterFailure(st, later).failed_access_attempts).toBe(1);
  });

  it('the global (per-client) threshold is higher than the per-browser one', () => {
    expect(OWNER_CLAIM_GLOBAL_MAX_ATTEMPTS).toBeGreaterThan(MAX_ATTEMPTS);
  });
});

describe('DB result parsing', () => {
  it('try_owner_claim rows', () => {
    expect(parseOwnerClaimDbResult([{ result: 'ok' }])).toBe('ok');
    expect(parseOwnerClaimDbResult([{ result: 'mismatch' }])).toBe('mismatch');
    expect(parseOwnerClaimDbResult({ result: 'locked' })).toBe('locked');
    expect(parseOwnerClaimDbResult([])).toBeNull();
    expect(parseOwnerClaimDbResult([{ result: 'weird' }])).toBeNull();
  });

  it('try_access_code rows', () => {
    expect(parseAccessCodeDbResult([{ ok: true, locked_out: false }])).toEqual({ ok: true, lockedOut: false });
    expect(parseAccessCodeDbResult([{ ok: false, locked_out: true }])).toEqual({ ok: false, lockedOut: true });
    expect(parseAccessCodeDbResult([])).toBeNull();
    expect(parseAccessCodeDbResult([{ ok: 'yes' }])).toBeNull();
  });
});

describe('isMissingFunctionError', () => {
  it('detects a missing RPC only', () => {
    expect(isMissingFunctionError({ code: 'PGRST202', message: 'Could not find the function public.try_access_code' })).toBe(true);
    expect(isMissingFunctionError({ code: '42883', message: 'function try_access_code(uuid, text) does not exist' })).toBe(true);
    expect(isMissingFunctionError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });
});
