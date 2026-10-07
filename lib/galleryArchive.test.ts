import { describe, expect, it } from 'vitest';
import { isGalleryArchived, matchesArchiveFilter } from './galleryArchive';

describe('isGalleryArchived', () => {
  it('marks only archived galleries as archived', () => {
    expect(isGalleryArchived({ archived_at: null })).toBe(false);
    expect(isGalleryArchived({ archived_at: '2026-01-01T00:00:00.000Z' })).toBe(true);
    expect(isGalleryArchived({})).toBe(false);
  });
});

describe('matchesArchiveFilter', () => {
  it('filters by active/archived/all modes', () => {
    const row = { archived_at: '2026-01-01T00:00:00.000Z' };
    const active = { archived_at: null };

    expect(matchesArchiveFilter(row, 'archived')).toBe(true);
    expect(matchesArchiveFilter(active, 'archived')).toBe(false);
    expect(matchesArchiveFilter(row, 'active')).toBe(false);
    expect(matchesArchiveFilter(active, 'active')).toBe(true);
    expect(matchesArchiveFilter(row, 'all')).toBe(true);
    expect(matchesArchiveFilter(active, 'all')).toBe(true);
  });
});
