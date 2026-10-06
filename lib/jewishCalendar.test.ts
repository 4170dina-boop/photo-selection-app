import { describe, it, expect } from 'vitest';
import {
  isShabbat,
  isYomTovIsrael,
  isShabbatOrYomTovIsrael,
  nextWeekdayIsrael,
  canSendClientEmailsToday,
  effectiveExpiryIso,
} from './jewishCalendar';
import { hebrewDateParts, isHebrewLeapYear } from './hebrewDate';
import { israelEndOfDayIso } from './israelTime';

describe('hebrewDateParts', () => {
  it('converts known dates (fixed month numbering)', () => {
    expect(hebrewDateParts('2026-09-12')).toEqual({ day: 1, month: 1, year: 5787, isLeapYear: true });
    expect(hebrewDateParts('2027-03-15')).toMatchObject({ day: 6, month: 7 }); // ו׳ אדר ב׳ תשפ״ז
    expect(hebrewDateParts('2027-02-10')).toMatchObject({ day: 3, month: 6 }); // ג׳ אדר א׳ תשפ״ז
    expect(hebrewDateParts('2026-02-20')).toEqual({ day: 3, month: 7, year: 5786, isLeapYear: false }); // ג׳ אדר תשפ״ו
  });

  it('returns null for invalid input', () => {
    expect(hebrewDateParts('not-a-date')).toBeNull();
  });

  it('knows leap years', () => {
    expect(isHebrewLeapYear(5784)).toBe(true);
    expect(isHebrewLeapYear(5786)).toBe(false);
    expect(isHebrewLeapYear(5787)).toBe(true);
  });
});

describe('isShabbatOrYomTovIsrael', () => {
  it('Rosh Hashana 5787: 12-13 Sep 2026', () => {
    expect(isYomTovIsrael('2026-09-12')).toBe(true);
    expect(isYomTovIsrael('2026-09-13')).toBe(true);
    expect(isYomTovIsrael('2026-09-14')).toBe(false);
    expect(isYomTovIsrael('2026-09-11')).toBe(false); // ערב ראש השנה
  });

  it('Yom Kippur: 21 Sep 2026', () => {
    expect(isShabbatOrYomTovIsrael('2026-09-21')).toBe(true);
    expect(isShabbatOrYomTovIsrael('2026-09-20')).toBe(false);
  });

  it('Sukkot (first day): 26 Sep 2026, but not Chol Hamoed', () => {
    expect(isYomTovIsrael('2026-09-26')).toBe(true);
    expect(isYomTovIsrael('2026-09-27')).toBe(false); // יו״ט שני של גלויות - לא בישראל
    expect(isShabbatOrYomTovIsrael('2026-09-28')).toBe(false);
  });

  it('Shemini Atzeret: 3 Oct 2026 (one day in Israel)', () => {
    expect(isYomTovIsrael('2026-10-03')).toBe(true);
    expect(isYomTovIsrael('2026-10-04')).toBe(false);
  });

  it('Pesach and Shavuot 5787', () => {
    expect(isYomTovIsrael('2027-04-22')).toBe(true); // ט״ו ניסן
    expect(isYomTovIsrael('2027-04-23')).toBe(false);
    expect(isYomTovIsrael('2027-04-28')).toBe(true); // כ״א ניסן
    expect(isYomTovIsrael('2027-06-11')).toBe(true); // ו׳ סיון
    expect(isYomTovIsrael('2027-06-12')).toBe(false);
  });

  it('Shabbat', () => {
    expect(isShabbat('2026-10-10')).toBe(true);
    expect(isShabbat('2026-10-09')).toBe(false);
    expect(isShabbatOrYomTovIsrael('2026-10-06')).toBe(false); // יום שלישי רגיל
  });
});

describe('nextWeekdayIsrael', () => {
  it('skips Shabbat + Yom Tov chains', () => {
    expect(nextWeekdayIsrael('2026-10-06')).toBe('2026-10-06');
    expect(nextWeekdayIsrael('2026-10-10')).toBe('2026-10-11');
    // ראש השנה (שבת-ראשון) -> שני
    expect(nextWeekdayIsrael('2026-09-12')).toBe('2026-09-14');
    // שמיני עצרת בשבת -> ראשון
    expect(nextWeekdayIsrael('2026-10-03')).toBe('2026-10-04');
  });
});

describe('canSendClientEmailsToday', () => {
  // 08:00 UTC = שעת ה-cron
  const at = (d: string) => new Date(`${d}T08:00:00Z`);

  it('blocks on Shabbat / Yom Tov when respecting Shabbat (default)', () => {
    expect(canSendClientEmailsToday(at('2026-10-10'), true)).toBe(false);
    expect(canSendClientEmailsToday(at('2026-09-21'), undefined)).toBe(false);
    expect(canSendClientEmailsToday(at('2026-10-11'), true)).toBe(true);
  });

  it('always allows when the photographer turned it off', () => {
    expect(canSendClientEmailsToday(at('2026-10-10'), false)).toBe(true);
  });
});

describe('effectiveExpiryIso', () => {
  it('keeps a weekday expiry as is', () => {
    const iso = israelEndOfDayIso('2026-10-06');
    expect(effectiveExpiryIso(iso)).toBe(iso);
  });

  it('extends a Shabbat expiry to the end of Sunday (Israel time)', () => {
    expect(effectiveExpiryIso(israelEndOfDayIso('2026-10-10'))).toBe(israelEndOfDayIso('2026-10-11'));
  });

  it('extends a Rosh Hashana expiry past the whole chain', () => {
    expect(effectiveExpiryIso(israelEndOfDayIso('2026-09-12'))).toBe(israelEndOfDayIso('2026-09-14'));
  });

  it('uses the Israel date, not UTC (22:30 UTC Friday = Shabbat in Israel)', () => {
    expect(effectiveExpiryIso('2026-10-09T22:30:00.000Z')).toBe(israelEndOfDayIso('2026-10-11'));
  });

  it('does nothing when respect_shabbat is off, and rejects invalid input', () => {
    const iso = israelEndOfDayIso('2026-10-10');
    expect(effectiveExpiryIso(iso, false)).toBe(iso);
    expect(effectiveExpiryIso('garbage')).toBeNull();
  });
});
