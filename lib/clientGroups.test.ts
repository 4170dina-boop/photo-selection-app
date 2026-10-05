import { describe, it, expect } from 'vitest';
import {
  clientGroupKey,
  groupClients,
  latestTimestamp,
  buildClientSummaries,
  sortByLastActivity,
  filterClients,
} from './clientGroups';

describe('clientGroupKey', () => {
  it('groups by email case-insensitively and ignores surrounding spaces', () => {
    expect(clientGroupKey({ full_name: 'דנה', email: ' Dana@Example.com ' })).toBe('email:dana@example.com');
    expect(clientGroupKey({ full_name: 'שם אחר', email: 'dana@example.com' })).toBe('email:dana@example.com');
  });

  it('falls back to the name when there is no email', () => {
    expect(clientGroupKey({ full_name: '  רחל   כהן ', email: '' })).toBe('name:רחל כהן');
    expect(clientGroupKey({ full_name: 'Rachel', email: null })).toBe('name:rachel');
  });
});

describe('groupClients', () => {
  it('merges rows of the same person and keeps the newest name/email', () => {
    const groups = groupClients([
      { id: 'a', full_name: 'דנה', email: 'dana@x.com', created_at: '2026-01-01T00:00:00Z' },
      { id: 'b', full_name: 'דנה לוי', email: 'DANA@x.com', created_at: '2026-03-01T00:00:00Z' },
      { id: 'c', full_name: 'מיכל', email: 'michal@x.com', created_at: '2026-02-01T00:00:00Z' },
      { id: 'd', full_name: 'ללא מייל', email: '', created_at: '2026-02-01T00:00:00Z' },
      { id: 'e', full_name: 'ללא  מייל', email: null, created_at: '2026-02-02T00:00:00Z' },
    ]);
    expect(groups).toHaveLength(3);
    const dana = groups.find((g) => g.key === 'email:dana@x.com')!;
    expect(dana.clientIds).toEqual(['a', 'b']);
    expect(dana.name).toBe('דנה לוי');
    expect(dana.email).toBe('DANA@x.com');
    expect(groups.find((g) => g.key === 'name:ללא מייל')!.clientIds).toEqual(['d', 'e']);
  });

  it('does not let an older row overwrite the newest name', () => {
    const [g] = groupClients([
      { id: 'b', full_name: 'חדש', email: 'a@x.com', created_at: '2026-03-01T00:00:00Z' },
      { id: 'a', full_name: 'ישן', email: 'a@x.com', created_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(g.name).toBe('חדש');
  });
});

describe('latestTimestamp', () => {
  it('returns the latest valid value, or null', () => {
    expect(latestTimestamp([null, '2026-01-01T00:00:00Z', undefined, '2026-02-01', 'garbage'])).toBe('2026-02-01');
    expect(latestTimestamp([null, undefined])).toBeNull();
    expect(latestTimestamp([])).toBeNull();
  });
});

describe('buildClientSummaries', () => {
  const clients = [
    { id: 'a1', full_name: 'דנה', email: 'dana@x.com', created_at: '2026-01-01T00:00:00Z' },
    { id: 'a2', full_name: 'דנה', email: 'Dana@x.com', created_at: '2026-02-01T00:00:00Z' },
    { id: 'b1', full_name: 'מיכל', email: 'michal@x.com', created_at: '2026-01-05T00:00:00Z' },
  ];

  it('aggregates galleries, shoots and money across all rows of a client', () => {
    const result = buildClientSummaries({
      clients,
      galleries: [
        { id: 'g1', client_id: 'a1', created_at: '2026-01-01T00:00:00Z', last_activity_at: '2026-01-10T00:00:00Z', paid: 100.1, outstanding: 50.2 },
        { id: 'g2', client_id: 'a2', created_at: '2026-02-01T00:00:00Z', paid: 0.2, outstanding: 0 },
        { id: 'g3', client_id: 'b1', created_at: '2026-01-05T00:00:00Z', paid: 0, outstanding: 300 },
      ],
      shoots: [
        { id: 's1', client_id: 'a1', shoot_date: '2026-02-15', created_at: '2026-01-20T00:00:00Z' },
        { id: 's2', client_id: 'b1', shoot_date: '2026-09-01', created_at: '2026-03-01T00:00:00Z' },
      ],
      todayDate: '2026-04-01',
    });

    expect(result).toHaveLength(2);
    const dana = result.find((c) => c.key === 'email:dana@x.com')!;
    expect(dana.galleryCount).toBe(2);
    expect(dana.shootCount).toBe(1);
    expect(dana.galleryIds).toEqual(['g1', 'g2']);
    expect(dana.totalPaid).toBe(100.3);
    expect(dana.balanceDue).toBe(50.2);
    expect(dana.lastActivity).toBe('2026-02-15');

    const michal = result.find((c) => c.key === 'email:michal@x.com')!;
    // צילום עתידי לא נחשב לפי תאריך הצילום, רק לפי מתי נקבע
    expect(michal.lastActivity).toBe('2026-03-01T00:00:00Z');
    expect(michal.balanceDue).toBe(300);
  });

  it('sorts by last activity, newest first', () => {
    const result = buildClientSummaries({
      clients,
      galleries: [{ id: 'g3', client_id: 'b1', created_at: '2026-03-05T00:00:00Z', paid: 0, outstanding: 0 }],
      shoots: [],
      todayDate: '2026-04-01',
    });
    expect(result.map((c) => c.name)).toEqual(['מיכל', 'דנה']);
  });

  it('keeps clients without galleries or shoots, and ignores orphan rows', () => {
    const result = buildClientSummaries({
      clients: [{ id: 'x', full_name: 'רק לקוחה', email: 'only@x.com', created_at: null }],
      galleries: [{ id: 'g9', client_id: 'unknown', created_at: null, paid: 10, outstanding: 10 }],
      shoots: [],
      todayDate: '2026-04-01',
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ galleryCount: 0, shootCount: 0, totalPaid: 0, balanceDue: 0, lastActivity: null });
  });
});

describe('sortByLastActivity', () => {
  it('puts items without activity last, ties by name', () => {
    const sorted = sortByLastActivity([
      { name: 'ב', lastActivity: null },
      { name: 'א', lastActivity: null },
      { name: 'ג', lastActivity: '2026-01-01T00:00:00Z' },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['ג', 'א', 'ב']);
  });
});

describe('filterClients', () => {
  const items = [
    { name: 'דנה לוי', email: 'Dana@x.com' },
    { name: 'מיכל', email: 'michal@y.com' },
  ];
  it('matches name or email case-insensitively', () => {
    expect(filterClients(items, 'לוי')).toHaveLength(1);
    expect(filterClients(items, 'DANA')).toEqual([items[0]]);
    expect(filterClients(items, 'y.com')).toEqual([items[1]]);
    expect(filterClients(items, '  ')).toEqual(items);
  });
});
