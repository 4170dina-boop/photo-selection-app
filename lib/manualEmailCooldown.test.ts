import { describe, it, expect } from 'vitest';
import {
  checkManualEmailCooldown,
  formatCooldownLeft,
  MANUAL_EMAIL_COOLDOWN_SECONDS,
  MANUAL_EMAIL_DAILY_CAP,
  SHOOT_CONFIRMATION_COOLDOWN_SECONDS,
  SHOOT_CONFIRMATION_DAILY_CAP,
  priorSendTimes,
} from './manualEmailCooldown';

const now = new Date('2026-10-05T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const SEC = 1000;
const HOUR = 60 * 60 * SEC;

describe('checkManualEmailCooldown', () => {
  it('uses 60s cooldown and daily cap of 10 by default', () => {
    expect(MANUAL_EMAIL_COOLDOWN_SECONDS).toBe(60);
    expect(MANUAL_EMAIL_DAILY_CAP).toBe(10);
  });

  it('allows when nothing was sent', () => {
    expect(checkManualEmailCooldown([], now)).toEqual({ allowed: true });
  });

  it('ignores null/undefined/invalid timestamps (e.g. missing fallback column)', () => {
    expect(checkManualEmailCooldown([null, undefined, 'not-a-date'], now)).toEqual({ allowed: true });
  });

  it('blocks within the cooldown and reports remaining seconds in Hebrew', () => {
    const result = checkManualEmailCooldown([ago(15 * SEC)], now);
    expect(result).toEqual({
      allowed: false,
      reason: 'cooldown',
      retryAfterSeconds: 45,
      message: 'המייל נשלח לפני רגע - אפשר לשלוח שוב בעוד 45 שניות',
    });
  });

  it('rounds remaining seconds up', () => {
    const result = checkManualEmailCooldown([ago(59_500)], now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfterSeconds).toBe(1);
  });

  it('allows exactly when the cooldown has passed', () => {
    expect(checkManualEmailCooldown([ago(60 * SEC)], now)).toEqual({ allowed: true });
  });

  it('uses the most recent send regardless of input order', () => {
    const result = checkManualEmailCooldown([ago(10 * HOUR), ago(5 * SEC), ago(2 * HOUR)], now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfterSeconds).toBe(55);
  });

  it('treats future timestamps (clock skew) as sent now', () => {
    const future = new Date(now.getTime() + 10 * 60 * SEC).toISOString();
    const result = checkManualEmailCooldown([future], now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfterSeconds).toBe(60);
  });

  it('allows below the daily cap', () => {
    const sends = Array.from({ length: 9 }, (_, i) => ago((i + 1) * HOUR));
    expect(checkManualEmailCooldown(sends, now)).toEqual({ allowed: true });
  });

  it('blocks at the daily cap until the oldest send in the window expires', () => {
    // 10 שליחות: הוותיקה לפני 20 שעות -> מתפנה בעוד 4 שעות
    const sends = [ago(20 * HOUR), ...Array.from({ length: 9 }, (_, i) => ago((i + 1) * HOUR))];
    const result = checkManualEmailCooldown(sends, now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('daily_cap');
      expect(result.retryAfterSeconds).toBe(4 * 3600);
      expect(result.message).toContain('4 שעות');
      expect(result.message).toContain('10 פעמים');
    }
  });

  it('with more sends than the cap, waits for enough of them to expire', () => {
    // 12 שליחות (למשל אחרי הורדת המגבלה) - צריך ש-3 יצאו מהחלון; השלישית הוותיקה לפני 21 שעות
    const sends = [ago(23 * HOUR), ago(22 * HOUR), ago(21 * HOUR), ...Array.from({ length: 9 }, (_, i) => ago((i + 1) * HOUR))];
    const result = checkManualEmailCooldown(sends, now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfterSeconds).toBe(3 * 3600);
  });

  it('says "שעה" when under an hour remains on the daily cap', () => {
    const sends = [ago(23.5 * HOUR), ...Array.from({ length: 9 }, (_, i) => ago((i + 1) * HOUR))];
    const result = checkManualEmailCooldown(sends, now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain('בעוד שעה');
  });

  it('ignores sends older than 24 hours for the cap', () => {
    const sends = [...Array.from({ length: 10 }, (_, i) => ago(25 * HOUR + i * SEC))];
    expect(checkManualEmailCooldown(sends, now)).toEqual({ allowed: true });
  });

  it('cooldown takes precedence over the daily cap', () => {
    const sends = [ago(10 * SEC), ...Array.from({ length: 9 }, (_, i) => ago((i + 1) * HOUR))];
    const result = checkManualEmailCooldown(sends, now);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('cooldown');
  });

  it('respects custom cooldown and cap', () => {
    expect(checkManualEmailCooldown([ago(20 * SEC)], now, 10, 5)).toEqual({ allowed: true });
    const result = checkManualEmailCooldown([ago(HOUR), ago(2 * HOUR)], now, 10, 2);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('daily_cap');
  });
});

describe('formatCooldownLeft', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatCooldownLeft(42)).toBe('42 שנ׳');
    expect(formatCooldownLeft(0)).toBe('0 שנ׳');
    expect(formatCooldownLeft(61)).toBe('2 דק׳');
    expect(formatCooldownLeft(3600)).toBe('1 שע׳');
    expect(formatCooldownLeft(4 * 3600 - 5)).toBe('4 שע׳');
  });
});

describe('checkManualEmailCooldown with several recipients (requested)', () => {
  const hoursAgo = (n: number) => Array.from({ length: n }, (_, i) => ago((i + 2) * HOUR));

  it('allows when the whole batch fits in the daily cap', () => {
    expect(checkManualEmailCooldown(hoursAgo(7), now, 60, 10, 3)).toEqual({ allowed: true });
  });

  it('blocks when the batch would exceed the cap and reports when enough frees up', () => {
    const result = checkManualEmailCooldown(hoursAgo(8), now, 60, 10, 3);
    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toBe('daily_cap');
    // צריך שתתפנה שליחה אחת (8 + 3 - 10) - הוותיקה ביותר (לפני 9 שעות) יוצאת מהחלון בעוד 15 שעות
    expect(result.retryAfterSeconds).toBe(15 * 3600);
    expect(result.message).toContain('3 הנמענים');
  });

  it('clamps a batch larger than the cap so it is not blocked forever', () => {
    expect(checkManualEmailCooldown([], now, 60, 10, 25)).toEqual({ allowed: true });
  });

  it('default requested=1 keeps the old behaviour', () => {
    expect(checkManualEmailCooldown(hoursAgo(9), now).allowed).toBe(true);
    expect(checkManualEmailCooldown(hoursAgo(10), now).allowed).toBe(false);
  });

  it('shoot confirmations: no cooldown, per-photographer cap of 30', () => {
    expect(SHOOT_CONFIRMATION_COOLDOWN_SECONDS).toBe(0);
    expect(SHOOT_CONFIRMATION_DAILY_CAP).toBe(30);
    expect(
      checkManualEmailCooldown([ago(1 * SEC)], now, SHOOT_CONFIRMATION_COOLDOWN_SECONDS, SHOOT_CONFIRMATION_DAILY_CAP)
    ).toEqual({ allowed: true });
  });
});

describe('priorSendTimes', () => {
  it('counts only other rows reserved no later than our own', () => {
    const rows = [
      { id: 'old', sent_at: '2026-10-05T11:00:00.000Z' },
      { id: 'mine1', sent_at: '2026-10-05T11:59:00.000Z' },
      { id: 'mine2', sent_at: '2026-10-05T11:59:00.000Z' },
      { id: 'later', sent_at: '2026-10-05T11:59:30.000Z' },
    ];
    expect(priorSendTimes(rows, ['mine1', 'mine2'])).toEqual(['2026-10-05T11:00:00.000Z']);
  });

  it('treats an exact tie as prior (both parallel requests back off rather than both sending)', () => {
    const rows = [
      { id: 'a', sent_at: '2026-10-05T11:59:00.000Z' },
      { id: 'b', sent_at: '2026-10-05T11:59:00.000Z' },
    ];
    expect(priorSendTimes(rows, ['a'])).toEqual(['2026-10-05T11:59:00.000Z']);
    expect(priorSendTimes(rows, ['b'])).toEqual(['2026-10-05T11:59:00.000Z']);
  });

  it('the second of two parallel clicks sees the first reservation and hits the cooldown', () => {
    const rows = [
      { id: 'first', sent_at: ago(2 * SEC) },
      { id: 'second', sent_at: ago(1 * SEC) },
    ];
    expect(checkManualEmailCooldown(priorSendTimes(rows, ['first']), now)).toEqual({ allowed: true });
    expect(checkManualEmailCooldown(priorSendTimes(rows, ['second']), now).allowed).toBe(false);
  });
});
