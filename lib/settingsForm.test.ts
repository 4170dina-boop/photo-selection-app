import { describe, it, expect } from 'vitest';
import { numberOrNull, missingNumberFields } from './settingsForm';

describe('numberOrNull', () => {
  it('treats empty / whitespace / missing as null, not 0', () => {
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('   ')).toBeNull();
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
  });

  it('parses numbers including an explicit 0', () => {
    expect(numberOrNull('0')).toBe(0);
    expect(numberOrNull('12')).toBe(12);
    expect(numberOrNull('2.5')).toBe(2.5);
  });

  it('returns null for non-numeric input', () => {
    expect(numberOrNull('abc')).toBeNull();
  });
});

describe('missingNumberFields', () => {
  it('lists only the empty fields', () => {
    expect(
      missingNumberFields([
        { label: 'תמונות', value: '30' },
        { label: 'מחיר', value: '' },
        { label: 'ימים', value: '0' },
      ])
    ).toEqual(['מחיר']);
  });
});
