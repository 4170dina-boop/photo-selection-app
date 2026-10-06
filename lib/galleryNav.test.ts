import { describe, it, expect } from 'vitest';
import { applyNavFilters, burstMembers } from './galleryNav';

const photos = [
  { id: 'a', chapterId: 'c1', burstId: 'a' },
  { id: 'b', chapterId: 'c1', burstId: 'a' },
  { id: 'c', chapterId: 'c2', burstId: null },
  { id: 'd', chapterId: 'c2', burstId: 'd' },
  { id: 'e', chapterId: null, burstId: 'd' },
  { id: 'f', chapterId: null, burstId: 'lonely' },
];

describe('applyNavFilters', () => {
  it('passes everything through by default', () => {
    expect(applyNavFilters(photos, { chapterFilter: 'all', hideSimilar: false, isSelected: () => false })).toHaveLength(6);
  });
  it('combines chapter filter and hide-similar', () => {
    const r = applyNavFilters(photos, { chapterFilter: 'c1', hideSimilar: true, isSelected: (id) => id === 'b' });
    expect(r.map((p) => p.id)).toEqual(['b']);
  });
});

describe('burstMembers', () => {
  it('groups by burst id and drops single-photo bursts', () => {
    const m = burstMembers(photos);
    expect(Array.from(m.keys())).toEqual(['a', 'd']);
    expect(m.get('d')!.map((p) => p.id)).toEqual(['d', 'e']);
  });
});
