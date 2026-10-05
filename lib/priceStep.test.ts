import { describe, expect, it } from 'vitest';
import { priceStepBase } from './priceStep';

describe('priceStepBase', () => {
  it('uses the ones digit so any typed amount stays valid', () => {
    expect(priceStepBase('355')).toBe('5');
    expect(priceStepBase('350')).toBe('0');
    expect(priceStepBase('7')).toBe('7');
    expect(priceStepBase('1200')).toBe('0');
  });
  it('keeps the fractional part as typed', () => {
    expect(priceStepBase('355.5')).toBe('5.5');
    expect(priceStepBase('12.75')).toBe('2.75');
    expect(priceStepBase('40.')).toBe('0');
  });
  it('falls back to 0 for empty / negative / odd input', () => {
    expect(priceStepBase('')).toBe('0');
    expect(priceStepBase('-5')).toBe('0');
    expect(priceStepBase('abc')).toBe('0');
  });
});
