import { describe, it, expect } from 'vitest';
import { israelEndOfDayIso, israelDateString, daysBetweenDateStrings } from './israelTime';

describe('israelEndOfDayIso', () => {
  it('uses +03:00 (IDT) for a summer date', () => {
    // מאומת עצמאית: ב-15 ביולי ישראל בשעון קיץ (UTC+3), אז 23:59:59 מקומי = 20:59:59Z.
    expect(israelEndOfDayIso('2026-07-15')).toBe('2026-07-15T20:59:59.000Z');
  });

  it('uses +02:00 (IST) for a winter date', () => {
    // מאומת עצמאית: ב-15 בדצמבר ישראל בשעון חורף (UTC+2), אז 23:59:59 מקומי = 21:59:59Z.
    expect(israelEndOfDayIso('2026-12-15')).toBe('2026-12-15T21:59:59.000Z');
  });

  it('round-trips back to 23:59:59 on the same Israel calendar date, both seasons', () => {
    for (const dateStr of ['2026-07-15', '2026-12-15', '2026-03-27', '2026-10-25']) {
      const iso = israelEndOfDayIso(dateStr);
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(iso));
      expect(fmt).toBe(`${dateStr}, 23:59:59`);
    }
  });
});

describe('israelDateString', () => {
  it('reports the Israel calendar date for a UTC morning instant (IDT, summer)', () => {
    // 08:00Z ביולי = 11:00 בישראל (UTC+3) - עדיין אותו יום אזרחי.
    expect(israelDateString(new Date('2026-07-15T08:00:00Z'))).toBe('2026-07-15');
  });

  it('reports the Israel calendar date for a UTC morning instant (IST, winter)', () => {
    // 08:00Z בינואר = 10:00 בישראל (UTC+2) - עדיין אותו יום אזרחי.
    expect(israelDateString(new Date('2026-01-01T08:00:00Z'))).toBe('2026-01-01');
  });
});

describe('daysBetweenDateStrings', () => {
  it('computes whole calendar days between two date strings', () => {
    expect(daysBetweenDateStrings('2026-07-15', '2026-07-20')).toBe(5);
    expect(daysBetweenDateStrings('2026-07-20', '2026-07-15')).toBe(-5);
    expect(daysBetweenDateStrings('2026-07-15', '2026-07-15')).toBe(0);
  });

  it('handles a span crossing the DST boundary the same as any other 5-day span', () => {
    // 25.10.2026 הוא יום המעבר משעון קיץ לשעון חורף בישראל - ההפרש הלוחני
    // עדיין 5 ימים "רגילים", למרות שבפועל יש שם שעה נוספת בפועל.
    expect(daysBetweenDateStrings('2026-10-22', '2026-10-27')).toBe(5);
  });
});
