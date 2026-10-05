import { describe, it, expect } from 'vitest';
import { computeClientProgress } from './clientProgress';

describe('computeClientProgress', () => {
  it('returns null while the selection is still open', () => {
    expect(computeClientProgress({ status: 'sent', editingStarted: false, delivered: false })).toBeNull();
    expect(computeClientProgress({ status: 'in_progress', editingStarted: false, delivered: false })).toBeNull();
    expect(computeClientProgress({ status: null, editingStarted: false, delivered: false })).toBeNull();
  });

  it('returns null for a gallery reopened for selection', () => {
    expect(
      computeClientProgress({ status: 'completed', reopenedForSelection: true, editingStarted: true, delivered: false })
    ).toBeNull();
  });

  it('highlights "selected" right after finishing', () => {
    const p = computeClientProgress({ status: 'completed', editingStarted: false, delivered: false });
    expect(p?.current).toBe('selected');
    expect(p?.steps.map((s) => [s.key, s.done, s.current])).toEqual([
      ['selected', false, true],
      ['editing', false, false],
      ['ready', false, false],
    ]);
  });

  it('moves to "editing" once the photographer started editing', () => {
    const p = computeClientProgress({ status: 'completed', editingStarted: true, delivered: false });
    expect(p?.current).toBe('editing');
    expect(p?.steps[0].done).toBe(true);
    expect(p?.steps[1]).toEqual({ key: 'editing', done: false, current: true });
  });

  it('delivery wins over everything, all steps done', () => {
    for (const status of ['completed', 'in_progress', 'expired']) {
      const p = computeClientProgress({ status, editingStarted: false, delivered: true });
      expect(p?.current).toBe('ready');
      expect(p?.steps.every((s) => s.done)).toBe(true);
    }
    expect(
      computeClientProgress({ status: 'completed', reopenedForSelection: true, editingStarted: false, delivered: true })?.current
    ).toBe('ready');
  });
});
