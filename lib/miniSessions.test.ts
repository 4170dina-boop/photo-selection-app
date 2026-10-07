import { describe, expect, it } from 'vitest';
import {
  buildMiniSessionSlots,
  getAvailableMiniSessionSlots,
  isMiniSessionDayBlocked,
  validateMiniSessionBookingInput,
  validateMiniSessionInput,
} from './miniSessions';

describe('miniSessions', () => {
  it('blocks weekend and genuinely holy dates for mini-session slots', () => {
    expect(isMiniSessionDayBlocked('2026-10-10')).toBe(true); // שבת
    expect(isMiniSessionDayBlocked('2026-10-07')).toBe(false); // יום חול
    expect(isMiniSessionDayBlocked('2026-09-21')).toBe(true); // יום כיפור
  });

  it('builds evenly spaced slot times within the requested working window', () => {
    expect(buildMiniSessionSlots('2026-10-07', 20, '09:00', '10:00')).toEqual(['09:00', '09:20', '09:40']);
    expect(buildMiniSessionSlots('2026-10-07', 30, '09:00', '09:45')).toEqual(['09:00']);
    expect(buildMiniSessionSlots('2026-10-07', 20, '09:00', '09:15')).toEqual([]);
  });

  it('validates production-ready input and blocks invalid dates', () => {
    expect(validateMiniSessionInput({
      date: '2026-10-07',
      startTime: '09:00',
      endTime: '10:00',
      durationMinutes: 20,
      price: '150',
      deposit: '50',
      notes: 'תזכורת ללקוחות',
    })).toMatchObject({ ok: true });

    expect(validateMiniSessionInput({
      date: '2026-10-10',
      startTime: '09:00',
      endTime: '10:00',
      durationMinutes: 20,
      price: '150',
      deposit: '50',
    }).ok).toBe(false);

    expect(validateMiniSessionInput({
      date: '2026-10-07',
      startTime: '10:00',
      endTime: '09:00',
      durationMinutes: 20,
    }).ok).toBe(false);
  });

  it('excludes booked times from availability and validates booking data', () => {
    expect(getAvailableMiniSessionSlots('2026-10-07', 20, '09:00', '10:00', ['09:20'])).toEqual(['09:00', '09:40']);

    expect(validateMiniSessionBookingInput({
      clientName: 'שרה כהן',
      phone: '050-1234567',
      email: 'sara@example.com',
      notes: 'רוצה את השעה הכי מוקדמת',
    })).toMatchObject({ ok: true });

    expect(validateMiniSessionBookingInput({
      clientName: '',
      phone: '',
      email: 'bad-email',
    }).ok).toBe(false);
  });
});
