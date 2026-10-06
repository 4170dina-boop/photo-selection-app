import { describe, it, expect } from 'vitest';
import {
  parseClientDateInput,
  isClientDateOn,
  nextClientDateOccurrence,
  clientDatesDueIn,
  describeClientDateRule,
  familyLabel,
  greetingSuggestion,
} from './clientDates';

const greg = (date_greg: string) => ({ date_greg, hebrew_month: null, hebrew_day: null });
const heb = (hebrew_month: number, hebrew_day: number) => ({ date_greg: null, hebrew_month, hebrew_day });

describe('parseClientDateInput', () => {
  it('accepts a Gregorian date', () => {
    expect(parseClientDateInput({ label: '  יום  ההולדת של יוסי ', dateGreg: '2015-03-12' })).toEqual({
      ok: true,
      value: { label: 'יום ההולדת של יוסי', date_greg: '2015-03-12', hebrew_month: null, hebrew_day: null },
    });
  });

  it('accepts a Hebrew date (numbers as strings from <select>)', () => {
    expect(parseClientDateInput({ label: 'יום נישואין', hebrewMonth: '8', hebrewDay: '15' })).toEqual({
      ok: true,
      value: { label: 'יום נישואין', date_greg: null, hebrew_month: 8, hebrew_day: 15 },
    });
  });

  it('rejects missing label / both kinds / none / out of range', () => {
    expect(parseClientDateInput({ label: '', dateGreg: '2015-03-12' }).ok).toBe(false);
    expect(parseClientDateInput({ label: 'x', dateGreg: '2015-03-12', hebrewMonth: 1, hebrewDay: 1 }).ok).toBe(false);
    expect(parseClientDateInput({ label: 'x' }).ok).toBe(false);
    expect(parseClientDateInput({ label: 'x', dateGreg: '2015-02-30' }).ok).toBe(false);
    expect(parseClientDateInput({ label: 'x', hebrewMonth: 14, hebrewDay: 1 }).ok).toBe(false);
    expect(parseClientDateInput({ label: 'x', hebrewMonth: 1, hebrewDay: 31 }).ok).toBe(false);
    expect(parseClientDateInput({ label: 'x'.repeat(81), dateGreg: '2015-03-12' }).ok).toBe(false);
  });
});

describe('isClientDateOn / nextClientDateOccurrence - Gregorian', () => {
  it('recurs every year on the same day and month', () => {
    expect(isClientDateOn(greg('2015-03-12'), '2027-03-12')).toBe(true);
    expect(isClientDateOn(greg('2015-03-12'), '2027-03-13')).toBe(false);
    expect(nextClientDateOccurrence(greg('2015-03-12'), '2026-10-06')).toBe('2027-03-12');
    expect(nextClientDateOccurrence(greg('2015-10-06'), '2026-10-06')).toBe('2026-10-06');
  });

  it('Feb 29 falls on Feb 28 in a non-leap year', () => {
    expect(nextClientDateOccurrence(greg('2024-02-29'), '2026-10-06')).toBe('2027-02-28');
    expect(nextClientDateOccurrence(greg('2024-02-29'), '2027-10-06')).toBe('2028-02-29');
  });
});

describe('isClientDateOn / nextClientDateOccurrence - Hebrew', () => {
  it('ט״ו בשבט', () => {
    expect(nextClientDateOccurrence(heb(5, 15), '2026-10-06')).toBe('2027-01-23');
  });

  it('אדר (7): Adar in a regular year, Adar II in a leap year', () => {
    expect(nextClientDateOccurrence(heb(7, 14), '2026-01-01')).toBe('2026-03-03'); // תשפ״ו רגילה
    expect(nextClientDateOccurrence(heb(7, 14), '2026-10-06')).toBe('2027-03-23'); // תשפ״ז מעוברת - אדר ב׳
  });

  it('אדר א׳ (6): Adar I in a leap year, Adar in a regular year', () => {
    expect(nextClientDateOccurrence(heb(6, 14), '2026-10-06')).toBe('2027-02-21');
    expect(nextClientDateOccurrence(heb(6, 14), '2027-04-01')).toBe('2028-03-12'); // תשפ״ח רגילה
  });

  it('day 30 that does not exist this year falls on the 29th', () => {
    // ל׳ אדר א׳ -> בשנה רגילה אין ל׳ באדר -> כ״ט אדר
    expect(nextClientDateOccurrence(heb(6, 30), '2026-01-01')).toBe('2026-03-18');
    expect(nextClientDateOccurrence(heb(6, 30), '2026-10-06')).toBe('2027-03-09'); // ל׳ אדר א׳ תשפ״ז קיים
    // ל׳ חשון קיים בתשפ״ז - לא נופלים לכ״ט
    expect(isClientDateOn(heb(2, 30), '2026-11-10')).toBe(true);
    expect(isClientDateOn(heb(2, 30), '2026-11-09')).toBe(false);
  });
});

describe('clientDatesDueIn', () => {
  it('returns only dates exactly 30 days ahead', () => {
    const rows = [
      { id: 'a', ...greg('2010-11-05') },
      { id: 'b', ...greg('2010-11-06') },
      { id: 'c', ...heb(2, 25) }, // כ״ה חשון תשפ״ז = 5.11.2026
    ];
    expect(clientDatesDueIn(rows, '2026-10-06').map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('labels', () => {
  it('describes rules', () => {
    expect(describeClientDateRule(greg('2015-03-12'))).toBe('12.3 (לועזי, כל שנה)');
    expect(describeClientDateRule(heb(5, 15))).toBe('ט״ו בשבט (עברי, כל שנה)');
  });

  it('family label and greeting suggestion', () => {
    expect(familyLabel('יוסי כהן')).toBe('משפחת כהן');
    expect(familyLabel('דינה')).toBe('דינה');
    expect(greetingSuggestion('יום ההולדת של יוסי')).toContain('יום הולדת');
    expect(greetingSuggestion('יום נישואין')).toContain('נישואין');
    expect(greetingSuggestion('משהו אחר')).toBeTruthy();
  });
});
