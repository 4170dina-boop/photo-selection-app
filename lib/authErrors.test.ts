import { describe, expect, it } from 'vitest';
import {
  callbackErrorMessage,
  callbackParamsError,
  classifySignInError,
  isExistingUserSignup,
  isRateLimitError,
} from './authErrors';

describe('isExistingUserSignup', () => {
  it('detects the obfuscated user Supabase returns for an already-registered email', () => {
    expect(isExistingUserSignup({ identities: [] }, false)).toBe(true);
  });

  it('is false for a real new signup, a session, or missing data', () => {
    expect(isExistingUserSignup({ identities: [{ id: 'x' }] }, false)).toBe(false);
    expect(isExistingUserSignup({ identities: [] }, true)).toBe(false);
    expect(isExistingUserSignup({}, false)).toBe(false);
    expect(isExistingUserSignup({ identities: null }, false)).toBe(false);
    expect(isExistingUserSignup(null, false)).toBe(false);
  });
});

describe('classifySignInError', () => {
  it('maps known codes', () => {
    expect(classifySignInError({ code: 'email_not_confirmed', status: 400 })).toBe('email_not_confirmed');
    expect(classifySignInError({ code: 'invalid_credentials', status: 400 })).toBe('invalid_credentials');
    expect(classifySignInError({ code: 'over_request_rate_limit', status: 429 })).toBe('rate_limited');
  });

  it('treats any 429 as rate limited', () => {
    expect(classifySignInError({ status: 429 })).toBe('rate_limited');
  });

  it('falls back to message text when code is missing', () => {
    expect(classifySignInError({ message: 'Email not confirmed' })).toBe('email_not_confirmed');
    expect(classifySignInError({ message: 'Invalid login credentials' })).toBe('invalid_credentials');
  });

  it('returns generic otherwise', () => {
    expect(classifySignInError({ code: 'unexpected_failure', status: 500 })).toBe('generic');
    expect(classifySignInError({})).toBe('generic');
  });
});

describe('isRateLimitError', () => {
  it('detects rate limits', () => {
    expect(isRateLimitError({ code: 'over_email_send_rate_limit' })).toBe(true);
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ status: 400, code: 'validation_failed' })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe('callbackParamsError', () => {
  it('returns null when a code is present and no error', () => {
    expect(callbackParamsError(new URLSearchParams('code=abc&next=/x'))).toBeNull();
  });

  it('flags Supabase error params as expired', () => {
    expect(
      callbackParamsError(
        new URLSearchParams('error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')
      )
    ).toBe('link_expired');
    expect(callbackParamsError(new URLSearchParams('code=abc&error=server_error'))).toBe('link_expired');
  });

  it('flags a missing code as invalid', () => {
    expect(callbackParamsError(new URLSearchParams(''))).toBe('link_invalid');
    expect(callbackParamsError(new URLSearchParams('next=/dashboard'))).toBe('link_invalid');
  });
});

describe('callbackErrorMessage', () => {
  it('only returns messages for known codes', () => {
    expect(callbackErrorMessage('link_expired')).toContain('פג תוקף');
    expect(callbackErrorMessage('link_invalid')).toBeTruthy();
    expect(callbackErrorMessage('<script>')).toBeNull();
    expect(callbackErrorMessage(null)).toBeNull();
  });
});
