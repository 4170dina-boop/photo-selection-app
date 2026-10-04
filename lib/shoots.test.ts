import { describe, it, expect } from 'vitest';
import {
  isShootReminderDue,
  selectShootsNeedingReminder,
  resolveShootReminderDays,
  israelTomorrowDateString,
  shouldSendDailySummary,
  isValidDateString,
  isValidTimeString,
  formatShootTime,
  formatShootDateLabel,
  daysUntilLabel,
  buildMonthGrid,
  monthRange,
  compareShoots,
  validateShootFields,
} from './shoots';
import { israelLocalToUtcIso, addDaysToDateString } from './israelTime';

// ה-cron היומי רץ ב-08:00 UTC (vercel.json) = 11:00 בישראל בקיץ, 10:00 בחורף.
const CRON_SUMMER = new Date('2026-07-15T08:00:00Z');
const CRON_WINTER = new Date('2026-12-15T08:00:00Z');

const shoot = (shoot_date: string, start_time = '17:00:00', reminder_sent_at: string | null = null) => ({
  shoot_date,
  start_time,
  reminder_sent_at,
});

describe('israelLocalToUtcIso', () => {
  it('converts Israel local summer time (UTC+3)', () => {
    expect(israelLocalToUtcIso('2026-07-15', '17:30')).toBe('2026-07-15T14:30:00.000Z');
  });

  it('converts Israel local winter time (UTC+2), accepting HH:MM:SS from Postgres', () => {
    expect(israelLocalToUtcIso('2026-12-15', '09:05:00')).toBe('2026-12-15T07:05:00.000Z');
  });
});

describe('addDaysToDateString', () => {
  it('crosses month and year boundaries', () => {
    expect(addDaysToDateString('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateString('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('isShootReminderDue', () => {
  it('is due one calendar day before with the default of 1 day', () => {
    expect(isShootReminderDue(shoot('2026-07-16'), 1, CRON_SUMMER)).toBe(true);
  });

  it('is not due yet when the shoot is further away than reminderDays', () => {
    expect(isShootReminderDue(shoot('2026-07-17'), 1, CRON_SUMMER)).toBe(false);
    expect(isShootReminderDue(shoot('2026-07-17'), 2, CRON_SUMMER)).toBe(true);
  });

  it('is idempotent - never due once reminder_sent_at is set', () => {
    expect(isShootReminderDue(shoot('2026-07-16', '17:00:00', '2026-07-15T08:00:00Z'), 1, CRON_SUMMER)).toBe(false);
  });

  it('is never due when reminders are disabled (0 days)', () => {
    expect(isShootReminderDue(shoot('2026-07-16'), 0, CRON_SUMMER)).toBe(false);
  });

  it('still reminds about a shoot later today that was missed (e.g. created after yesterday\'s run)', () => {
    expect(isShootReminderDue(shoot('2026-07-15', '18:00:00'), 1, CRON_SUMMER)).toBe(true);
  });

  it('does not remind about a shoot that already started today', () => {
    // 11:00 בישראל - צילום שהתחיל ב-09:00 כבר מאחורינו
    expect(isShootReminderDue(shoot('2026-07-15', '09:00:00'), 1, CRON_SUMMER)).toBe(false);
  });

  it('does not remind about past shoots', () => {
    expect(isShootReminderDue(shoot('2026-07-10'), 5, CRON_SUMMER)).toBe(false);
  });

  it('uses the Israel calendar date, not UTC - late-night UTC is already tomorrow in Israel', () => {
    // 22:30Z ב-15/7 = 01:30 ב-16/7 בישראל, אז צילום ב-17/7 הוא "מחר"
    const lateNight = new Date('2026-07-15T22:30:00Z');
    expect(isShootReminderDue(shoot('2026-07-17'), 1, lateNight)).toBe(true);
  });

  it('works in winter time too', () => {
    expect(isShootReminderDue(shoot('2026-12-16', '08:00:00'), 1, CRON_WINTER)).toBe(true);
    // ה-cron רץ ב-10:00 בישראל בחורף - צילום ב-09:30 כבר התחיל, ב-10:30 עוד לא
    expect(isShootReminderDue(shoot('2026-12-15', '09:30:00'), 1, CRON_WINTER)).toBe(false);
    expect(isShootReminderDue(shoot('2026-12-15', '10:30:00'), 1, CRON_WINTER)).toBe(true);
  });
});

describe('selectShootsNeedingReminder', () => {
  it('resolves reminder days per shoot (photographer setting) and filters', () => {
    const shoots = [
      { id: 'a', days: 1, ...shoot('2026-07-16') },
      { id: 'b', days: 3, ...shoot('2026-07-18') },
      { id: 'c', days: 1, ...shoot('2026-07-18') },
      { id: 'd', days: null, ...shoot('2026-07-16') }, // ברירת מחדל = 1
      { id: 'e', days: 0, ...shoot('2026-07-16') },
    ];
    const due = selectShootsNeedingReminder(shoots, (s) => s.days, CRON_SUMMER).map((s) => s.id);
    expect(due).toEqual(['a', 'b', 'd']);
  });
});

describe('resolveShootReminderDays', () => {
  it('defaults to 1 and clamps to the allowed range', () => {
    expect(resolveShootReminderDays(null)).toBe(1);
    expect(resolveShootReminderDays(undefined)).toBe(1);
    expect(resolveShootReminderDays(-4)).toBe(0);
    expect(resolveShootReminderDays(99)).toBe(30);
    expect(resolveShootReminderDays(2)).toBe(2);
  });
});

describe('daily summary', () => {
  it('computes tomorrow in Israel time', () => {
    expect(israelTomorrowDateString(CRON_SUMMER)).toBe('2026-07-16');
    expect(israelTomorrowDateString(new Date('2026-12-31T08:00:00Z'))).toBe('2027-01-01');
    // 22:30Z = כבר 16/7 בישראל, אז "מחר" = 17/7
    expect(israelTomorrowDateString(new Date('2026-07-15T22:30:00Z'))).toBe('2026-07-17');
  });

  it('is idempotent per Israel calendar day', () => {
    expect(shouldSendDailySummary(true, null, CRON_SUMMER)).toBe(true);
    expect(shouldSendDailySummary(true, '2026-07-14', CRON_SUMMER)).toBe(true);
    expect(shouldSendDailySummary(true, '2026-07-15', CRON_SUMMER)).toBe(false);
  });

  it('respects the disable setting', () => {
    expect(shouldSendDailySummary(false, null, CRON_SUMMER)).toBe(false);
  });
});

describe('validation and formatting', () => {
  it('validates date and time strings', () => {
    expect(isValidDateString('2026-02-28')).toBe(true);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('15/07/2026')).toBe(false);
    expect(isValidTimeString('09:30')).toBe(true);
    expect(isValidTimeString('23:59:00')).toBe(true);
    expect(isValidTimeString('24:00')).toBe(false);
    expect(isValidTimeString('9:30')).toBe(false);
  });

  it('formats time and Hebrew date labels', () => {
    expect(formatShootTime('14:30:00')).toBe('14:30');
    expect(formatShootDateLabel('2026-10-11')).toBe('יום ראשון, 11.10.2026');
    expect(formatShootDateLabel('2026-10-17')).toBe('יום שבת, 17.10.2026');
    expect(daysUntilLabel(0)).toBe('היום');
    expect(daysUntilLabel(1)).toBe('מחר');
    expect(daysUntilLabel(5)).toBe('בעוד 5 ימים');
  });

  it('sorts shoots by date then time', () => {
    const list = [
      { shoot_date: '2026-07-16', start_time: '10:00:00' },
      { shoot_date: '2026-07-15', start_time: '18:00:00' },
      { shoot_date: '2026-07-15', start_time: '09:00' },
    ];
    expect([...list].sort(compareShoots).map((s) => `${s.shoot_date} ${s.start_time}`)).toEqual([
      '2026-07-15 09:00',
      '2026-07-15 18:00:00',
      '2026-07-16 10:00:00',
    ]);
  });
});

describe('validateShootFields', () => {
  it('normalizes valid input', () => {
    expect(validateShootFields({ shootDate: '2026-10-11', startTime: '17:30:00', location: '  פארק  ', notes: '  ' })).toEqual({
      ok: true,
      value: { shoot_date: '2026-10-11', start_time: '17:30', location: 'פארק', notes: null },
    });
  });

  it('rejects missing/invalid fields with a Hebrew message', () => {
    expect(validateShootFields({ shootDate: '2026-13-01', startTime: '10:00', location: 'x' }).ok).toBe(false);
    expect(validateShootFields({ shootDate: '2026-10-11', startTime: '25:00', location: 'x' }).ok).toBe(false);
    const noLocation = validateShootFields({ shootDate: '2026-10-11', startTime: '10:00', location: ' ' });
    expect(noLocation).toEqual({ ok: false, error: 'חסר מיקום לצילום' });
    expect(validateShootFields({ shootDate: '2026-10-11', startTime: '10:00', location: 'x'.repeat(201) }).ok).toBe(false);
  });
});

describe('buildMonthGrid', () => {
  it('starts weeks on Sunday and pads with nulls', () => {
    // 1/10/2026 חל ביום חמישי
    const weeks = buildMonthGrid(2026, 10);
    expect(weeks[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks[weeks.length - 1]).toContain('2026-10-31');
  });

  it('handles February in a non-leap year', () => {
    expect(buildMonthGrid(2026, 2).flat().filter(Boolean)).toHaveLength(28);
    expect(monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
