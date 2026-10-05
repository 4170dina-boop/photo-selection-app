import { describe, it, expect } from 'vitest';
import { toHebrewDateString } from './hebrewDate';

describe('toHebrewDateString', () => {
  it('uses the Israel civil day regardless of server timezone', () => {
    // 22:30 UTC on Oct 10 is already Oct 11 (01:30) in Israel
    expect(toHebrewDateString(new Date('2026-10-10T22:30:00Z'))).toBe(toHebrewDateString(new Date('2026-10-11T12:00:00Z')));
    expect(toHebrewDateString(new Date('2026-10-10T22:30:00Z'))).not.toBe(toHebrewDateString(new Date('2026-10-10T12:00:00Z')));
  });
});
