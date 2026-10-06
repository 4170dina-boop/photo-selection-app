import { describe, it, expect } from 'vitest';
import { buildContactRows } from './contactsExport';

const client = (id: string, created_at: string) => ({ id, full_name: `name-${id}`, email: `${id}@x.com`, created_at });
const gallery = (client_id: string, created_at: string, status = 'sent') => ({
  client_id,
  status,
  expires_at: null,
  created_at,
});

describe('buildContactRows', () => {
  it('returns one row per client with gallery count and latest gallery', () => {
    const rows = buildContactRows(
      [client('a', '2026-01-01T00:00:00Z')],
      [gallery('a', '2026-02-01T00:00:00Z', 'completed'), gallery('a', '2026-03-01T00:00:00Z', 'in_progress')]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].galleryCount).toBe(2);
    expect(rows[0].lastGallery?.status).toBe('in_progress');
  });

  it('includes clients without galleries (e.g. created from the calendar)', () => {
    const rows = buildContactRows([client('a', '2026-01-01T00:00:00Z'), client('b', '2026-01-02T00:00:00Z')], [
      gallery('a', '2026-01-05T00:00:00Z'),
    ]);
    const b = rows.find((r) => r.client.id === 'b');
    expect(b).toBeDefined();
    expect(b?.galleryCount).toBe(0);
    expect(b?.lastGallery).toBeNull();
  });

  it('dedupes repeated client rows and ignores galleries of unknown clients', () => {
    const rows = buildContactRows([client('a', '2026-01-01T00:00:00Z'), client('a', '2026-01-01T00:00:00Z')], [
      gallery('zzz', '2026-01-05T00:00:00Z'),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].galleryCount).toBe(0);
  });

  it('sorts by most recent activity first', () => {
    const rows = buildContactRows(
      [client('old', '2025-01-01T00:00:00Z'), client('new', '2026-05-01T00:00:00Z'), client('mid', '2025-06-01T00:00:00Z')],
      [gallery('old', '2026-06-01T00:00:00Z')]
    );
    expect(rows.map((r) => r.client.id)).toEqual(['old', 'new', 'mid']);
  });
});
