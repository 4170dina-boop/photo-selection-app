import { describe, expect, it } from 'vitest';
import {
  canRetryRegisterOnly,
  existingRegistrationResult,
  FREE_PHOTO_LIMIT,
  MAX_UPLOAD_BYTES,
  PROCESS_RETRY_GRACE_MS,
  buildFinalPhotoKey,
  buildPhotoKey,
  gridThumbKey,
  hasWatermarkedThumbnail,
  indicesToUpload,
  needsGridThumbBackfill,
  previewKey,
  isAllowedLogoUrl,
  isFreshPhotoKey,
  isKeyInGallery,
  mapWithConcurrency,
  photosNeedingProcessRetry,
  remainingPhotoQuota,
  thumbnailKey,
  validateUploadRequest,
  MAX_UPLOAD_BATCH,
  parseUploadBatch,
  quotaGrantCount,
} from './uploadPolicy';

describe('existingRegistrationResult', () => {
  it('returns null when the key is not registered yet', () => {
    expect(existingRegistrationResult(null, 'g1')).toBeNull();
    expect(existingRegistrationResult(undefined, 'g1')).toBeNull();
  });

  it('is idempotent for a key already registered in the same gallery (lost response retry)', () => {
    expect(existingRegistrationResult({ id: 'p1', gallery_id: 'g1' }, 'g1')).toEqual({ id: 'p1' });
  });

  it('rejects a key registered in another gallery', () => {
    expect(existingRegistrationResult({ id: 'p1', gallery_id: 'g2' }, 'g1')).toEqual({ error: 'התמונה כבר רשומה', status: 409 });
  });
});

describe('canRetryRegisterOnly', () => {
  it('retries only the register when the PUT already succeeded', () => {
    expect(canRetryRegisterOnly({ status: 'error', uploadedPath: 'g1/a.jpg' })).toBe(true);
    expect(canRetryRegisterOnly({ status: 'pending', uploadedPath: 'g1/a.jpg' })).toBe(true);
  });

  it('does a full upload when nothing reached storage, or the item is not retryable', () => {
    expect(canRetryRegisterOnly({ status: 'error' })).toBe(false);
    expect(canRetryRegisterOnly({ status: 'error', uploadedPath: '' })).toBe(false);
    expect(canRetryRegisterOnly({ status: 'done', uploadedPath: 'g1/a.jpg' })).toBe(false);
    expect(canRetryRegisterOnly({ status: 'uploading', uploadedPath: 'g1/a.jpg' })).toBe(false);
  });
});

describe('parseUploadBatch', () => {
  it('accepts a batch of files', () => {
    expect(parseUploadBatch({ files: [{ a: 1 }, { a: 2 }] })).toEqual({ ok: true, isBatch: true, items: [{ a: 1 }, { a: 2 }] });
  });

  it('keeps the legacy single-object body working', () => {
    expect(parseUploadBatch({ contentType: 'image/jpeg', size: 5 })).toEqual({
      ok: true,
      isBatch: false,
      items: [{ contentType: 'image/jpeg', size: 5 }],
    });
  });

  it('rejects empty, oversized and malformed bodies', () => {
    expect(parseUploadBatch({ files: [] }).ok).toBe(false);
    expect(parseUploadBatch({ files: 'x' }).ok).toBe(false);
    expect(parseUploadBatch({ files: Array.from({ length: MAX_UPLOAD_BATCH + 1 }, () => ({})) }).ok).toBe(false);
    expect(parseUploadBatch({ files: Array.from({ length: MAX_UPLOAD_BATCH }, () => ({})) }).ok).toBe(true);
    expect(parseUploadBatch(null).ok).toBe(false);
    expect(parseUploadBatch([{}]).ok).toBe(false);
    expect(parseUploadBatch('str').ok).toBe(false);
  });
});

describe('quotaGrantCount', () => {
  it('grants everything when unlimited', () => {
    expect(quotaGrantCount(15, null)).toBe(15);
  });

  it('grants only what is left of the free quota', () => {
    expect(quotaGrantCount(10, 3)).toBe(3);
    expect(quotaGrantCount(2, 3)).toBe(2);
    expect(quotaGrantCount(5, 0)).toBe(0);
    expect(quotaGrantCount(5, -1)).toBe(0);
  });
});

const GID = '11111111-2222-3333-4444-555555555555';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('validateUploadRequest', () => {
  it('accepts an allowed image type and size, deriving the extension from the type', () => {
    expect(validateUploadRequest({ contentType: 'image/jpeg', size: 1000 })).toEqual({
      ok: true,
      contentType: 'image/jpeg',
      size: 1000,
      ext: 'jpg',
    });
    expect(validateUploadRequest({ contentType: 'IMAGE/PNG', size: 5 })).toMatchObject({ ok: true, ext: 'png' });
  });

  it('rejects types outside the allow-list', () => {
    for (const contentType of ['text/html', 'image/svg+xml', 'application/octet-stream', '', undefined]) {
      expect(validateUploadRequest({ contentType, size: 10 }).ok).toBe(false);
    }
  });

  it('rejects missing, non-integer, zero, negative and oversized sizes', () => {
    for (const size of [undefined, '100', 1.5, 0, -1, MAX_UPLOAD_BYTES + 1, Infinity, NaN]) {
      expect(validateUploadRequest({ contentType: 'image/jpeg', size }).ok).toBe(false);
    }
    expect(validateUploadRequest({ contentType: 'image/jpeg', size: MAX_UPLOAD_BYTES }).ok).toBe(true);
  });

  it('handles a null/garbage body', () => {
    expect(validateUploadRequest(null).ok).toBe(false);
    expect(validateUploadRequest('x').ok).toBe(false);
  });
});

describe('keys', () => {
  it('builds keys from uuid + safe extension only', () => {
    expect(buildPhotoKey(GID, UUID, 'jpg')).toBe(`${GID}/${UUID}.jpg`);
    expect(buildFinalPhotoKey(GID, UUID, 'png')).toBe(`${GID}/final/${UUID}.png`);
    expect(thumbnailKey(GID, 'p1')).toBe(`${GID}/thumbs/p1.jpg`);
  });

  it('isKeyInGallery requires the gallery prefix with a slash', () => {
    expect(isKeyInGallery(GID, `${GID}/x.jpg`)).toBe(true);
    expect(isKeyInGallery(GID, `${GID}x/a.jpg`)).toBe(false);
    expect(isKeyInGallery(GID, `other/${GID}/a.jpg`)).toBe(false);
    expect(isKeyInGallery(GID, null)).toBe(false);
    expect(isKeyInGallery('', '/a.jpg')).toBe(false);
  });

  it('isFreshPhotoKey only accepts keys exactly as presign-upload builds them', () => {
    expect(isFreshPhotoKey(GID, buildPhotoKey(GID, UUID, 'webp'))).toBe(true);
    expect(isFreshPhotoKey(GID, thumbnailKey(GID, UUID))).toBe(false);
    expect(isFreshPhotoKey(GID, buildFinalPhotoKey(GID, UUID, 'jpg'))).toBe(false);
    expect(isFreshPhotoKey(GID, `${GID}/${UUID}.exe`)).toBe(false);
    expect(isFreshPhotoKey(GID, `${GID}/${UUID}-name.jpg`)).toBe(false);
    expect(isFreshPhotoKey(GID, `99999999-2222-3333-4444-555555555555/${UUID}.jpg`)).toBe(false);
  });
});

describe('remainingPhotoQuota', () => {
  it('matches the DB limit for free accounts and is unlimited otherwise', () => {
    expect(remainingPhotoQuota(0, false)).toBe(FREE_PHOTO_LIMIT);
    expect(remainingPhotoQuota(FREE_PHOTO_LIMIT - 1, false)).toBe(1);
    expect(remainingPhotoQuota(FREE_PHOTO_LIMIT, false)).toBe(0);
    expect(remainingPhotoQuota(FREE_PHOTO_LIMIT + 3, false)).toBe(0);
    expect(remainingPhotoQuota(1000, true)).toBeNull();
  });
});

describe('grid thumbnail keys', () => {
  it('previewKey lives in the gallery thumbs folder with the .hd.jpg marker', () => {
    expect(previewKey(GID, UUID)).toBe(`${GID}/thumbs/${UUID}.hd.jpg`);
    expect(isKeyInGallery(GID, previewKey(GID, UUID))).toBe(true);
    expect(isFreshPhotoKey(GID, previewKey(GID, UUID))).toBe(false);
  });

  it('gridThumbKey is derived deterministically from a new-format thumbnail_path', () => {
    const grid = gridThumbKey(previewKey(GID, UUID));
    expect(grid).toBe(`${GID}/thumbs/${UUID}.sm.jpg`);
    expect(isKeyInGallery(GID, grid)).toBe(true);
    expect(isFreshPhotoKey(GID, grid)).toBe(false);
    expect(grid).not.toBe(previewKey(GID, UUID));
  });

  it('gridThumbKey is null for legacy / missing / original paths (fallback to the big preview)', () => {
    expect(gridThumbKey(thumbnailKey(GID, UUID))).toBeNull();
    expect(gridThumbKey(`${GID}/thumbs/random-uuid.jpg`)).toBeNull();
    expect(gridThumbKey(buildPhotoKey(GID, UUID, 'jpg'))).toBeNull();
    expect(gridThumbKey(`${GID}/${UUID}.hd.jpg`)).toBeNull(); // לא בתיקיית thumbs
    expect(gridThumbKey(`${GID}/thumbs/.hd.jpg`)).toBeNull();
    expect(gridThumbKey(null)).toBeNull();
    expect(gridThumbKey(undefined)).toBeNull();
    expect(gridThumbKey('')).toBeNull();
  });

  it('needsGridThumbBackfill only for processed photos still in the legacy format', () => {
    const file_path = buildPhotoKey(GID, UUID, 'jpg');
    expect(needsGridThumbBackfill({ file_path, thumbnail_path: thumbnailKey(GID, UUID) })).toBe(true);
    expect(needsGridThumbBackfill({ file_path, thumbnail_path: previewKey(GID, UUID) })).toBe(false);
    expect(needsGridThumbBackfill({ file_path, thumbnail_path: null })).toBe(false);
    expect(needsGridThumbBackfill({ file_path, thumbnail_path: file_path })).toBe(false);
  });
});

describe('hasWatermarkedThumbnail', () => {
  it('is false for a missing thumbnail or one equal to the original', () => {
    expect(hasWatermarkedThumbnail({ file_path: 'g/a.jpg', thumbnail_path: null })).toBe(false);
    expect(hasWatermarkedThumbnail({ file_path: 'g/a.jpg', thumbnail_path: '' })).toBe(false);
    expect(hasWatermarkedThumbnail({ file_path: 'g/a.jpg', thumbnail_path: 'g/a.jpg' })).toBe(false);
    expect(hasWatermarkedThumbnail({ file_path: 'g/a.jpg', thumbnail_path: 'g/thumbs/a.jpg' })).toBe(true);
  });
});

describe('photosNeedingProcessRetry', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const old = new Date(now - PROCESS_RETRY_GRACE_MS - 1).toISOString();
  const fresh = new Date(now - 1000).toISOString();

  it('returns only unprocessed, old-enough, not-yet-attempted photos', () => {
    const photos = [
      { id: 'a', needsProcessing: true, createdAt: old },
      { id: 'b', needsProcessing: true, createdAt: fresh },
      { id: 'c', needsProcessing: false, createdAt: old },
      { id: 'd', needsProcessing: true, createdAt: old },
      { id: 'e', needsProcessing: true, createdAt: null },
    ];
    const result = photosNeedingProcessRetry(photos, now, new Set(['d']));
    expect(result.map((p) => p.id)).toEqual(['a', 'e']);
  });
});

describe('isAllowedLogoUrl', () => {
  const base = 'https://abc.supabase.co';
  it('allows only the photographer-logos public bucket on our Supabase origin', () => {
    expect(isAllowedLogoUrl(`${base}/storage/v1/object/public/photographer-logos/p1/logo?t=1`, base)).toBe(true);
    expect(isAllowedLogoUrl(`${base}/storage/v1/object/public/gallery-photos/p1/logo`, base)).toBe(false);
    expect(isAllowedLogoUrl(`https://evil.com/storage/v1/object/public/photographer-logos/x`, base)).toBe(false);
    expect(isAllowedLogoUrl(`https://abc.supabase.co.evil.com/storage/v1/object/public/photographer-logos/x`, base)).toBe(false);
    expect(isAllowedLogoUrl(`http://abc.supabase.co/storage/v1/object/public/photographer-logos/x`, base)).toBe(false);
    expect(isAllowedLogoUrl(`${base}/storage/v1/object/public/photographer-logos/../../../auth/v1/x`, base)).toBe(false);
    expect(isAllowedLogoUrl(`https://u:p@abc.supabase.co/storage/v1/object/public/photographer-logos/x`, base)).toBe(false);
    expect(isAllowedLogoUrl('http://169.254.169.254/latest/meta-data', base)).toBe(false);
    expect(isAllowedLogoUrl('not a url', base)).toBe(false);
    expect(isAllowedLogoUrl(null, base)).toBe(false);
    expect(isAllowedLogoUrl(`${base}/storage/v1/object/public/photographer-logos/x`, undefined)).toBe(false);
  });
});

describe('indicesToUpload', () => {
  it('never re-queues done or in-flight items', () => {
    const items = [
      { status: 'done' as const },
      { status: 'error' as const },
      { status: 'pending' as const },
      { status: 'uploading' as const },
      { status: 'done' as const },
    ];
    expect(indicesToUpload(items)).toEqual([1, 2]);
    expect(indicesToUpload([{ status: 'done' }, { status: 'done' }])).toEqual([]);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves order and never exceeds the limit', async () => {
    let active = 0;
    let maxActive = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      active--;
      return n * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(maxActive).toBe(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 5, async (x) => x)).toEqual([]);
  });
});
