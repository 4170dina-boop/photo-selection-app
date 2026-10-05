import { describe, expect, it } from 'vitest';
import { resolveSafeNext, SAFE_DEFAULT_NEXT } from './safeNext';

const ORIGIN = 'https://app.example.com';

describe('resolveSafeNext', () => {
  it('keeps internal paths with query and hash', () => {
    expect(resolveSafeNext('/dashboard/settings', ORIGIN)).toBe('/dashboard/settings');
    expect(resolveSafeNext('/dashboard/galleries/1?tab=photos#top', ORIGIN)).toBe(
      '/dashboard/galleries/1?tab=photos#top'
    );
    expect(resolveSafeNext('/login/reset-password', ORIGIN)).toBe('/login/reset-password');
  });

  it('falls back on empty input', () => {
    expect(resolveSafeNext(null, ORIGIN)).toBe(SAFE_DEFAULT_NEXT);
    expect(resolveSafeNext(undefined, ORIGIN)).toBe(SAFE_DEFAULT_NEXT);
    expect(resolveSafeNext('', ORIGIN)).toBe(SAFE_DEFAULT_NEXT);
  });

  it.each([
    'https://evil.com',
    'http://evil.com/dashboard',
    '//evil.com',
    '//evil.com/dashboard',
    '/\\evil.com',
    '\\\\evil.com',
    '/\t/evil.com', // ?next=/%09/evil.com אחרי פענוח searchParams
    '/\n/evil.com',
    '\t//evil.com',
    'https://app.example.com@evil.com/',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://app.example.com/dashboard', // פרוטוקול שונה = origin שונה
    'https://app.example.com:8443/dashboard',
  ])('rejects external/odd target %j', (next) => {
    expect(resolveSafeNext(next, ORIGIN)).toBe(SAFE_DEFAULT_NEXT);
  });

  it('treats the raw %09 form as a plain internal path (no decoding twice)', () => {
    // אם מישהו מעביר מחרוזת שעדיין מקודדת, היא נשארת נתיב פנימי באותו origin
    expect(resolveSafeNext('/%09/evil.com', ORIGIN)).toBe('/%09/evil.com');
  });

  it.each(['/.//evil.com', '/./\\evil.com', '/x/..//evil.com', '/%2e//evil.com'])(
    'never returns a protocol-relative path for %j',
    (next) => {
      const result = resolveSafeNext(next, ORIGIN);
      expect(result.startsWith('//')).toBe(false);
      expect(new URL(result, ORIGIN).origin).toBe(ORIGIN);
    }
  );

  it('resolves relative paths against the origin', () => {
    expect(resolveSafeNext('dashboard/settings', ORIGIN)).toBe('/dashboard/settings');
    // אותו scheme בלי // - לפי תקן WHATWG זה נתיב יחסי, לא host
    expect(resolveSafeNext('https:evil.com', ORIGIN)).toBe('/evil.com');
    // userinfo trick: נפתר לנתיב באותו origin, וכשמדביקים אותו אחרי origin נשאר פנימי
    expect(resolveSafeNext('@evil.com/x', ORIGIN)).toBe('/@evil.com/x');
    expect(new URL(`${ORIGIN}${resolveSafeNext('@evil.com/x', ORIGIN)}`).host).toBe('app.example.com');
  });

  it('accepts same-origin absolute URLs and returns only the path', () => {
    expect(resolveSafeNext('https://app.example.com/dashboard/calendar?x=1', ORIGIN)).toBe(
      '/dashboard/calendar?x=1'
    );
  });

  it('blocks /login to avoid redirect loops', () => {
    expect(resolveSafeNext('/login', ORIGIN)).toBe(SAFE_DEFAULT_NEXT);
    expect(resolveSafeNext('/login?next=/login', ORIGIN)).toBe(SAFE_DEFAULT_NEXT);
  });

  it('uses a custom fallback', () => {
    expect(resolveSafeNext('//evil.com', ORIGIN, '/login/reset-password')).toBe('/login/reset-password');
  });

  it('falls back when origin is invalid', () => {
    expect(resolveSafeNext('/dashboard', 'not a url')).toBe(SAFE_DEFAULT_NEXT);
  });
});
