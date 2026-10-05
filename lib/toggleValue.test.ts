import { describe, expect, it } from 'vitest';
import { nextToggleTimestamp, parseToggleValue, readToggleValue } from './toggleValue';

const NOW = '2026-10-05T10:00:00.000Z';
const OLD = '2026-09-01T10:00:00.000Z';

describe('parseToggleValue', () => {
  it('reads a boolean value only', () => {
    expect(parseToggleValue({ value: true })).toBe(true);
    expect(parseToggleValue({ value: false })).toBe(false);
    expect(parseToggleValue({ value: 'true' })).toBeUndefined();
    expect(parseToggleValue({})).toBeUndefined();
    expect(parseToggleValue(null)).toBeUndefined();
  });
});

describe('nextToggleTimestamp', () => {
  it('sets explicitly, keeping an existing timestamp', () => {
    expect(nextToggleTimestamp(null, true, NOW)).toBe(NOW);
    expect(nextToggleTimestamp(OLD, true, NOW)).toBe(OLD);
    expect(nextToggleTimestamp(OLD, false, NOW)).toBeNull();
    expect(nextToggleTimestamp(null, false, NOW)).toBeNull();
  });
  it('flips when no value is given (backward compatible)', () => {
    expect(nextToggleTimestamp(null, undefined, NOW)).toBe(NOW);
    expect(nextToggleTimestamp(OLD, undefined, NOW)).toBeNull();
  });
});

describe('readToggleValue', () => {
  it('handles a missing/invalid body', async () => {
    expect(await readToggleValue(new Request('http://x', { method: 'POST' }))).toBeUndefined();
    expect(await readToggleValue(new Request('http://x', { method: 'POST', body: 'not json' }))).toBeUndefined();
  });
  it('reads { value }', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ value: false }) });
    expect(await readToggleValue(req)).toBe(false);
  });
});
