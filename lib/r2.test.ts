import { describe, it, expect } from 'vitest';
import { summarizeDeleteOutput } from './r2';

describe('summarizeDeleteOutput', () => {
  it('counts everything as deleted when there are no per-key errors', () => {
    expect(summarizeDeleteOutput(['a', 'b'], undefined)).toEqual({ deletedCount: 2, failed: [] });
  });

  it('surfaces per-key Errors returned with HTTP 200', () => {
    const result = summarizeDeleteOutput(['a', 'b', 'c'], [{ Key: 'b', Code: 'AccessDenied', Message: 'nope' }]);
    expect(result.deletedCount).toBe(2);
    expect(result.failed).toEqual([{ key: 'b', code: 'AccessDenied', message: 'nope' }]);
  });
});
