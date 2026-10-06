import { describe, expect, it } from 'vitest';
import { inviteSanityWarnings, type InviteSanityInput } from './inviteSanity';

const now = new Date('2026-10-06T12:00:00');
const ok: InviteSanityInput = {
  photoCount: 100,
  processingCount: 0,
  includedPhotos: 30,
  extraPhotoPrice: 20,
  clientEmail: 'a@b.com',
  expiresAt: '2026-10-30',
  accessCode: 'XY12',
  now,
};
const codes = (input: Partial<InviteSanityInput>) => inviteSanityWarnings({ ...ok, ...input }).map((w) => w.code);

describe('inviteSanityWarnings', () => {
  it('הכל תקין - אין אזהרות', () => {
    expect(codes({})).toEqual([]);
  });

  it('0 תמונות', () => {
    expect(codes({ photoCount: 0 })).toEqual(['no-photos']);
  });

  it('לא ידוע (null) - לא מזהירים', () => {
    expect(codes({ photoCount: null, processingCount: null })).toEqual([]);
  });

  it('תמונות בעיבוד', () => {
    const w = inviteSanityWarnings({ ...ok, processingCount: 7 });
    expect(w.map((x) => x.code)).toEqual(['photos-processing']);
    expect(w[0].message).toContain('7');
  });

  it('מחיר נוסף 0 כשיש יותר תמונות מהכלולות', () => {
    expect(codes({ extraPhotoPrice: 0 })).toEqual(['extra-price-zero']);
    expect(codes({ extraPhotoPrice: 0, photoCount: 30 })).toEqual([]);
  });

  it('בלי מייל', () => {
    expect(codes({ clientEmail: '  ' })).toEqual(['no-client-email']);
    expect(codes({ clientEmail: null })).toEqual(['no-client-email']);
  });

  it('תוקף פחות מ-3 ימים / עבר / ללא תוקף', () => {
    expect(codes({ expiresAt: '2026-10-08' })).toEqual(['expiry-soon']);
    expect(codes({ expiresAt: '2026-10-06' })).toEqual(['expiry-soon']);
    expect(codes({ expiresAt: '2026-10-05' })).toEqual(['expired']);
    expect(codes({ expiresAt: '2026-10-10' })).toEqual([]);
    expect(codes({ expiresAt: '' })).toEqual([]);
    expect(codes({ expiresAt: null })).toEqual([]);
    expect(codes({ expiresAt: 'nope' })).toEqual([]);
  });

  it('תוקף ISO', () => {
    expect(codes({ expiresAt: '2026-10-07T20:59:59.000Z' })).toEqual(['expiry-soon']);
  });

  it('בלי קוד גישה', () => {
    expect(codes({ accessCode: '' })).toEqual(['no-access-code']);
  });

  it('כמה אזהרות יחד', () => {
    expect(codes({ photoCount: 0, clientEmail: '', accessCode: null })).toEqual(['no-photos', 'no-client-email', 'no-access-code']);
  });
});
