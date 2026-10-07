export type GalleryArchiveFilter = 'all' | 'active' | 'archived';

export interface ArchiveState {
  archived_at?: string | null;
}

export function isGalleryArchived(gallery: ArchiveState): boolean {
  return !!gallery.archived_at;
}

export function matchesArchiveFilter(gallery: ArchiveState, filter: GalleryArchiveFilter): boolean {
  if (filter === 'all') return true;
  return isGalleryArchived(gallery) === (filter === 'archived');
}
