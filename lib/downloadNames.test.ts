import { describe, it, expect } from 'vitest';
import { makeUniqueFilenames, resolveStatusByFilename, downloadSummaryMessage, isKeyInGallery } from './downloadNames';

describe('makeUniqueFilenames', () => {
  it('keeps unique names as they are', () => {
    expect(makeUniqueFilenames(['a.jpg', 'b.jpg', 'Gift/c.jpg'])).toEqual(['a.jpg', 'b.jpg', 'Gift/c.jpg']);
  });

  it('suffixes duplicates with (2), (3)...', () => {
    expect(makeUniqueFilenames(['a.jpg', 'a.jpg', 'a.jpg'])).toEqual(['a.jpg', 'a (2).jpg', 'a (3).jpg']);
  });

  it('is case-insensitive', () => {
    expect(makeUniqueFilenames(['IMG.JPG', 'img.jpg'])).toEqual(['IMG.JPG', 'img (2).jpg']);
  });

  it('does not collide with an existing "(2)" name', () => {
    expect(makeUniqueFilenames(['a (2).jpg', 'a.jpg', 'a.jpg'])).toEqual(['a (2).jpg', 'a.jpg', 'a (3).jpg']);
  });

  it('treats the same name in different folders as distinct and keeps the folder', () => {
    expect(makeUniqueFilenames(['a.jpg', 'Gift/a.jpg', 'Gift/a.jpg'])).toEqual(['a.jpg', 'Gift/a.jpg', 'Gift/a (2).jpg']);
  });

  it('handles names without an extension and dotfiles', () => {
    expect(makeUniqueFilenames(['raw', 'raw', '.hidden', '.hidden'])).toEqual(['raw', 'raw (2)', '.hidden', '.hidden (2)']);
  });
});

describe('resolveStatusByFilename', () => {
  it('maps each filename to its status, null -> extras', () => {
    const { statusByFilename, duplicateFilenames } = resolveStatusByFilename([
      { id: '1', filename: 'a.jpg', status: 'selected' },
      { id: '2', filename: 'b.jpg', status: null },
    ]);
    expect(statusByFilename.get('a.jpg')).toBe('selected');
    expect(statusByFilename.get('b.jpg')).toBe('extras');
    expect(duplicateFilenames).toEqual([]);
  });

  it('picks the strongest status for duplicate filenames regardless of order', () => {
    const { statusByFilename, duplicateFilenames } = resolveStatusByFilename([
      { id: '1', filename: 'a.jpg', status: 'selected' },
      { id: '2', filename: 'a.jpg', status: null },
      { id: '3', filename: 'b.jpg', status: 'maybe' },
      { id: '4', filename: 'b.jpg', status: 'gift' },
    ]);
    expect(statusByFilename.get('a.jpg')).toBe('selected');
    expect(statusByFilename.get('b.jpg')).toBe('gift');
    expect(duplicateFilenames.sort()).toEqual(['a.jpg', 'b.jpg']);
  });
});

describe('downloadSummaryMessage', () => {
  it('reports a simple count when everything succeeded', () => {
    expect(downloadSummaryMessage(5, 0, 0)).toBe('הורדו 5 תמונות!');
  });

  it('reports X out of Y with failures and missing originals', () => {
    expect(downloadSummaryMessage(3, 1, 2)).toBe('הורדו 3 מתוך 6 תמונות · 1 נכשלו בהורדה · 2 כבר לא קיימות באחסון (המקור נמחק)');
    expect(downloadSummaryMessage(4, 1, 0)).toBe('הורדו 4 מתוך 5 תמונות · 1 נכשלו בהורדה');
  });
});

describe('isKeyInGallery', () => {
  it('accepts keys under the gallery prefix', () => {
    expect(isKeyInGallery('g1/final/abc-a.jpg', 'g1')).toBe(true);
  });

  it('rejects keys of other galleries, prefix look-alikes and traversal', () => {
    expect(isKeyInGallery('g2/final/a.jpg', 'g1')).toBe(false);
    expect(isKeyInGallery('g10/final/a.jpg', 'g1')).toBe(false);
    expect(isKeyInGallery('g1', 'g1')).toBe(false);
    expect(isKeyInGallery('g1/../g2/a.jpg', 'g1')).toBe(false);
    expect(isKeyInGallery(null, 'g1')).toBe(false);
    expect(isKeyInGallery('/a.jpg', '')).toBe(false);
  });
});
