import { describe, it, expect } from 'vitest';
import { signSession, verifySession, safeCompare } from './session';

const GALLERY_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_GALLERY_ID = '22222222-2222-2222-2222-222222222222';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('signSession + verifySession', () => {
  it('round-trips a freshly signed token', () => {
    const token = signSession({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: null, iat: Date.now() });
    const payload = verifySession(token, GALLERY_ID, DAY_MS);

    expect(payload).not.toBeNull();
    expect(payload?.galleryId).toBe(GALLERY_ID);
    expect(payload?.clientId).toBe('client-1');
  });

  it('rejects a token checked against a different galleryId (no cross-gallery reuse)', () => {
    const token = signSession({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: null, iat: Date.now() });
    expect(verifySession(token, OTHER_GALLERY_ID, DAY_MS)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSession({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: null, iat: Date.now() - 2 * DAY_MS });
    expect(verifySession(token, GALLERY_ID, DAY_MS)).toBeNull();
  });

  it('accepts a token right at the edge of maxAge, rejects just past it', () => {
    const iat = Date.now() - DAY_MS + 1000; // רגע לפני התפוגה
    const token = signSession({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: null, iat });
    expect(verifySession(token, GALLERY_ID, DAY_MS)).not.toBeNull();

    const expiredToken = signSession({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: null, iat: iat - 2000 });
    expect(verifySession(expiredToken, GALLERY_ID, DAY_MS)).toBeNull();
  });

  it('rejects a token with a tampered signature', () => {
    const token = signSession({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: null, iat: Date.now() });
    const [body, sig] = token.split('.');
    const tamperedSig = sig.slice(0, -1) + (sig.at(-1) === 'A' ? 'B' : 'A');
    expect(verifySession(`${body}.${tamperedSig}`, GALLERY_ID, DAY_MS)).toBeNull();
  });

  it('rejects a token with a tampered payload (e.g. trying to swap galleryId without re-signing)', () => {
    const token = signSession({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: null, iat: Date.now() });
    const [, sig] = token.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ galleryId: OTHER_GALLERY_ID, clientId: 'client-1', participantId: null, iat: Date.now() })
    ).toString('base64url');
    expect(verifySession(`${forgedBody}.${sig}`, OTHER_GALLERY_ID, DAY_MS)).toBeNull();
  });

  it('rejects malformed or missing tokens', () => {
    expect(verifySession(undefined, GALLERY_ID, DAY_MS)).toBeNull();
    expect(verifySession('', GALLERY_ID, DAY_MS)).toBeNull();
    expect(verifySession('not-a-real-token', GALLERY_ID, DAY_MS)).toBeNull();
    expect(verifySession('missing-signature.', GALLERY_ID, DAY_MS)).toBeNull();
  });

  it('round-trips a signed participantId', () => {
    const token = signSession({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: 'participant-1', iat: Date.now() });
    const payload = verifySession(token, GALLERY_ID, DAY_MS);
    expect(payload?.participantId).toBe('participant-1');
  });

  it('normalizes a pre-family-sharing token (no participantId field at all) to null instead of undefined', async () => {
    // מדמה session שנחתם לפני שיתוף גלריה משפחתי - השדה חסר לגמרי מה-payload,
    // לא רק null. ראו lib/session.ts: verifySession מנרמלת עם ?? null.
    const crypto = await import('crypto');
    const body = Buffer.from(JSON.stringify({ galleryId: GALLERY_ID, clientId: 'client-1', iat: Date.now() })).toString(
      'base64url'
    );
    const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET as string).update(body).digest('base64url');
    const payload = verifySession(`${body}.${sig}`, GALLERY_ID, DAY_MS);
    expect(payload?.participantId).toBeNull();
  });

  it('rejects a token signed for a different secret (simulates SESSION_SECRET mismatch/rotation)', async () => {
    // בונים טוקן "ביד" עם סוד אחר, כדי לוודא שאימות מול הסוד האמיתי נכשל
    const crypto = await import('crypto');
    const body = Buffer.from(JSON.stringify({ galleryId: GALLERY_ID, clientId: 'client-1', participantId: null, iat: Date.now() })).toString(
      'base64url'
    );
    const wrongSig = crypto.createHmac('sha256', 'a-completely-different-secret').update(body).digest('base64url');
    expect(verifySession(`${body}.${wrongSig}`, GALLERY_ID, DAY_MS)).toBeNull();
  });
});

describe('safeCompare', () => {
  it('returns true for identical strings', () => {
    expect(safeCompare('ABCD1234', 'ABCD1234')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(safeCompare('ABCD1234', 'ABCD1235')).toBe(false);
  });

  it('returns false for strings of different length (no early-exit information leak)', () => {
    expect(safeCompare('SHORT', 'MUCHLONGERSTRING')).toBe(false);
  });

  it('returns false comparing against an empty string', () => {
    expect(safeCompare('SOMECODE', '')).toBe(false);
  });
});
