import { describe, it, expect } from 'vitest';
import { applyRowGuard, type GuardableQuery } from './rowGuard';

class FakeQuery implements GuardableQuery<FakeQuery> {
  calls: string[] = [];
  eq(column: string, value: string) {
    this.calls.push(`eq ${column}=${value}`);
    return this;
  }
  is(column: string, value: null) {
    this.calls.push(`is ${column}=${value}`);
    return this;
  }
}

describe('applyRowGuard', () => {
  it('uses eq for values and is(null) for nulls', () => {
    const q = applyRowGuard(new FakeQuery(), { status: 'completed', reopened_for_selection_at: null });
    expect(q.calls).toEqual(['eq status=completed', 'is reopened_for_selection_at=null']);
  });

  it('empty guard adds no conditions', () => {
    expect(applyRowGuard(new FakeQuery(), {}).calls).toEqual([]);
  });
});
