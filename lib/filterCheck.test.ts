import { describe, expect, it } from 'vitest';
import { classifyFilterResult, summarizeFilterStates } from './filterCheck';

describe('classifyFilterResult', () => {
  it('same size -> passed', () => expect(classifyFilterResult(1234, 1234)).toBe('passed'));
  it('different size (filter placeholder) -> held', () => expect(classifyFilterResult(1234, 999)).toBe('held'));
  it('network error -> held', () => expect(classifyFilterResult(1234, null)).toBe('held'));
  it('unknown expected size -> passed', () => expect(classifyFilterResult(null, 50)).toBe('passed'));
});

describe('summarizeFilterStates', () => {
  it('counts states', () => {
    expect(summarizeFilterStates(['passed', 'held', 'checking', 'passed'])).toEqual({
      total: 4, passed: 2, held: 1, checking: 1, allPassed: false,
    });
  });
  it('allPassed only when every photo passed', () => {
    expect(summarizeFilterStates(['passed', 'passed']).allPassed).toBe(true);
    expect(summarizeFilterStates([]).allPassed).toBe(false);
  });
});
