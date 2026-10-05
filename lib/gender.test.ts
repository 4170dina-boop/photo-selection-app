import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CLIENT_GENDER,
  fetchClientGender,
  fetchParticipantGenders,
  g,
  gt,
  isMissingColumnError,
  normalizeGender,
  parseGenderInput,
  resolveViewerGender,
  saveClientGender,
  slashForm,
} from './gender';

describe('normalizeGender', () => {
  it('accepts only f/m', () => {
    expect(normalizeGender('f')).toBe('f');
    expect(normalizeGender('m')).toBe('m');
    expect(normalizeGender('F')).toBeNull();
    expect(normalizeGender('')).toBeNull();
    expect(normalizeGender(null)).toBeNull();
    expect(normalizeGender(1)).toBeNull();
  });
});

describe('parseGenderInput', () => {
  it('missing is ok (null) unless required', () => {
    expect(parseGenderInput(undefined)).toEqual({ ok: true, value: null });
    expect(parseGenderInput(null)).toEqual({ ok: true, value: null });
    expect(parseGenderInput(undefined, { required: true }).ok).toBe(false);
  });
  it('valid and invalid values', () => {
    expect(parseGenderInput('m')).toEqual({ ok: true, value: 'm' });
    expect(parseGenderInput('f', { required: true })).toEqual({ ok: true, value: 'f' });
    expect(parseGenderInput('x').ok).toBe(false);
    expect(parseGenderInput(['f']).ok).toBe(false);
  });
});

describe('slashForm', () => {
  it('suffix forms', () => {
    expect(slashForm('בחרי', 'בחר')).toBe('בחר/י');
    expect(slashForm('מחוברת', 'מחובר')).toBe('מחובר/ת');
    expect(slashForm('תקבלי', 'תקבל')).toBe('תקבל/י');
  });
  it('word by word', () => {
    expect(slashForm('ברוכה הבאה', 'ברוך הבא')).toBe('ברוך/ה הבא/ה');
    expect(slashForm('נסי שוב', 'נסה שוב')).toBe('נסה/נסי שוב');
  });
  it('identical / different word counts', () => {
    expect(slashForm('סיימת', 'סיימת')).toBe('סיימת');
    expect(slashForm('כן, זאת אני', 'כן, זה')).toBe('כן, זה/כן, זאת אני');
  });
});

describe('g / gt', () => {
  it('picks by gender', () => {
    expect(gt('f', 'בחרי', 'בחר')).toBe('בחרי');
    expect(gt('m', 'בחרי', 'בחר')).toBe('בחר');
  });
  it('unknown -> explicit neutral or slash form', () => {
    expect(gt(null, 'בחרי', 'בחר')).toBe('בחר/י');
    expect(gt(undefined, 'בואי', 'בוא', 'בואו')).toBe('בואו');
  });
  it('non-string forms fall back to feminine when unknown', () => {
    expect(g(null, { f: 1, m: 2 })).toBe(1);
    expect(g(null, { f: 1, m: 2, n: 3 })).toBe(3);
    expect(g('m', { f: 1, m: 2 })).toBe(2);
  });
});

describe('resolveViewerGender', () => {
  it('owner uses client gender, default f', () => {
    expect(resolveViewerGender({ isOwner: true, clientGender: 'm', participantGender: null })).toBe('m');
    expect(resolveViewerGender({ isOwner: true, clientGender: null, participantGender: 'm' })).toBe(DEFAULT_CLIENT_GENDER);
  });
  it('guest uses participant gender, unknown -> null', () => {
    expect(resolveViewerGender({ isOwner: false, clientGender: 'f', participantGender: 'm' })).toBe('m');
    expect(resolveViewerGender({ isOwner: false, clientGender: 'm', participantGender: undefined })).toBeNull();
  });
});

describe('isMissingColumnError', () => {
  it('detects codes and messages', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true);
    expect(isMissingColumnError({ message: 'column galleries.client_gender does not exist' })).toBe(true);
    expect(isMissingColumnError({ message: "Could not find the 'gender' column of 'gallery_participants'" })).toBe(true);
    expect(isMissingColumnError({ code: '23505', message: 'duplicate' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

// לקוח supabase מזויף: כל שרשרת (.select/.eq/.update) מחזירה את עצמה, ו-await
// עליה (או maybeSingle) מחזיר את התוצאה שהוגדרה.
function fakeSupabase(result: { data?: unknown; error?: unknown } | (() => never)) {
  const resolve = () => {
    if (typeof result === 'function') return result();
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    maybeSingle: () => resolve(),
    then: (onFulfilled: any, onRejected: any) => resolve().then(onFulfilled, onRejected),
  };
  return { from: () => chain };
}

describe('DB helpers (best-effort)', () => {
  it('fetchClientGender: value / missing column / throw', async () => {
    expect(await fetchClientGender(fakeSupabase({ data: { client_gender: 'm' } }), 'g1')).toBe('m');
    expect(await fetchClientGender(fakeSupabase({ error: { code: '42703' } }), 'g1')).toBe('f');
    expect(await fetchClientGender(fakeSupabase({ data: { client_gender: 'x' } }), 'g1')).toBe('f');
    expect(
      await fetchClientGender(
        fakeSupabase(() => {
          throw new Error('boom');
        }),
        'g1'
      )
    ).toBe('f');
  });

  it('fetchParticipantGenders: only valid values, error -> empty', async () => {
    const map = await fetchParticipantGenders(
      fakeSupabase({ data: [{ id: 'a', gender: 'm' }, { id: 'b', gender: null }, { id: 'c', gender: 'f' }] }),
      'g1'
    );
    expect(Array.from(map.entries())).toEqual([['a', 'm'], ['c', 'f']]);
    expect((await fetchParticipantGenders(fakeSupabase({ error: { code: '42703' } }), 'g1')).size).toBe(0);
  });

  it('saveClientGender: ok / missing column / other error', async () => {
    expect(await saveClientGender(fakeSupabase({}), 'g1', 'm')).toBe('ok');
    expect(await saveClientGender(fakeSupabase({ error: { code: 'PGRST204' } }), 'g1', 'm')).toBe('missing-column');
    expect(await saveClientGender(fakeSupabase({ error: { code: '500' } }), 'g1', 'm')).toBe('error');
  });
});
