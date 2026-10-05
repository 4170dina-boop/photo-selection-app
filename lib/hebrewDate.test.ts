import { describe, it, expect } from 'vitest';
import { numberToHebrewLetters, toHebrewDateString } from './hebrewDate';

// תאריכים בצהריים UTC - כדי שאזור הזמן המקומי של המכונה (Intl משתמש בו) לא
// יזיז את התאריך ליום הקודם/הבא
const noonUtc = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`);

describe('numberToHebrewLetters', () => {
  it('writes single letters with geresh', () => {
    expect(numberToHebrewLetters(1)).toBe('א׳');
    expect(numberToHebrewLetters(9)).toBe('ט׳');
    expect(numberToHebrewLetters(10)).toBe('י׳');
    expect(numberToHebrewLetters(30)).toBe('ל׳');
  });

  it('writes multi-letter numbers with gershayim before the last letter', () => {
    expect(numberToHebrewLetters(11)).toBe('י״א');
    expect(numberToHebrewLetters(14)).toBe('י״ד');
    expect(numberToHebrewLetters(26)).toBe('כ״ו');
    expect(numberToHebrewLetters(29)).toBe('כ״ט');
  });

  it('writes 15 as ט״ו and 16 as ט״ז (not י״ה / י״ו)', () => {
    expect(numberToHebrewLetters(15)).toBe('ט״ו');
    expect(numberToHebrewLetters(16)).toBe('ט״ז');
  });

  it('writes year numbers (year % 1000)', () => {
    expect(numberToHebrewLetters(784)).toBe('תשפ״ד');
    expect(numberToHebrewLetters(785)).toBe('תשפ״ה');
    expect(numberToHebrewLetters(786)).toBe('תשפ״ו');
    expect(numberToHebrewLetters(787)).toBe('תשפ״ז');
    expect(numberToHebrewLetters(800)).toBe('ת״ת');
  });

  // באג ידוע ב-lib/hebrewDate.ts: הטיפול ב-15/16 מוסיף "טו"/"טז" *לפני* המאות,
  // אז 715 יוצא "טות״ש" במקום "תשט״ו". לא משפיע על ימים (1-30) ולא על השנים
  // הנוכחיות (תשפ״x), רק על שנים כמו תשט״ו/תשט״ז. it.fails יתהפך ויכשיל את
  // הסוויטה ברגע שהבאג יתוקן - אז להחליף ל-it רגיל.
  it('handles 15/16 combined with hundreds (e.g. 715 -> תשט״ו)', () => {
    expect(numberToHebrewLetters(715)).toBe('תשט״ו');
    expect(numberToHebrewLetters(716)).toBe('תשט״ז');
  });
});

describe('toHebrewDateString', () => {
  it('formats Rosh Hashana 5786', () => {
    expect(toHebrewDateString(noonUtc('2025-09-23'))).toBe('א׳ בתשרי תשפ״ו');
  });

  it('formats Rosh Hashana 5787', () => {
    expect(toHebrewDateString(noonUtc('2026-09-12'))).toBe('א׳ בתשרי תשפ״ז');
  });

  it('formats 15 and 16 Nisan with ט״ו / ט״ז', () => {
    expect(toHebrewDateString(noonUtc('2024-04-23'))).toBe('ט״ו בניסן תשפ״ד');
    expect(toHebrewDateString(noonUtc('2024-04-24'))).toBe('ט״ז בניסן תשפ״ד');
  });

  it('distinguishes Adar I / Adar II in a leap year (5784)', () => {
    expect(toHebrewDateString(noonUtc('2024-02-23'))).toBe('י״ד באדר א׳ תשפ״ד');
    expect(toHebrewDateString(noonUtc('2024-03-24'))).toBe('י״ד באדר ב׳ תשפ״ד');
  });

  it('uses plain Adar in a non-leap year (5785)', () => {
    expect(toHebrewDateString(noonUtc('2025-03-14'))).toBe('י״ד באדר תשפ״ה');
  });
});
