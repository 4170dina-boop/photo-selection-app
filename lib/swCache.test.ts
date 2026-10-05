import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// public/sw.js הוא JS רגיל (לא עובר דרך bundler) - טוענים אותו ב-vm עם self
// מדומה ובודקים את הפונקציות שהוא חושף ב-self.__galleryImageCache.
function loadSw() {
  const code = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');
  const self: any = { addEventListener: () => {} };
  vm.runInNewContext(code, { self, URL, caches: {}, fetch: () => {} });
  return self.__galleryImageCache as {
    isGalleryImageUrl: (u: URL) => boolean;
    cacheKeyFor: (u: URL) => string;
    trimCache: (cache: any, max: number) => Promise<void>;
    MAX_CACHE_ENTRIES: number;
  };
}

const sw = loadSw();

const r2Virtual =
  'https://gallery-photos.abc123.r2.cloudflarestorage.com/g1/thumb%20a.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=x&X-Amz-Date=20261005T000000Z&X-Amz-Expires=3600&X-Amz-Signature=deadbeef&X-Amz-SignedHeaders=host&x-id=GetObject';

describe('sw.js isGalleryImageUrl', () => {
  it('matches R2 presigned URLs (virtual-hosted and path-style)', () => {
    expect(sw.isGalleryImageUrl(new URL(r2Virtual))).toBe(true);
    expect(sw.isGalleryImageUrl(new URL('https://abc123.r2.cloudflarestorage.com/bucket/g1/a.jpg?X-Amz-Signature=1'))).toBe(true);
  });

  it('matches a signed S3-compatible override endpoint by its signature', () => {
    expect(sw.isGalleryImageUrl(new URL('http://localhost:9000/bucket/g1/a.jpg?X-Amz-Signature=1'))).toBe(true);
  });

  it('still matches old Supabase signed URLs', () => {
    expect(sw.isGalleryImageUrl(new URL('https://x.supabase.co/storage/v1/object/sign/gallery-photos/a.jpg?token=t'))).toBe(true);
  });

  it('ignores unrelated images', () => {
    expect(sw.isGalleryImageUrl(new URL('https://example.com/logo.png'))).toBe(false);
    expect(sw.isGalleryImageUrl(new URL('https://r2.cloudflarestorage.com.example.com/a.jpg'))).toBe(false);
  });
});

describe('sw.js cacheKeyFor', () => {
  it('strips all X-Amz-* params so re-signed URLs share one key', () => {
    const resigned = r2Virtual.replace('deadbeef', 'cafebabe').replace('20261005T000000Z', '20261005T010000Z');
    expect(sw.cacheKeyFor(new URL(r2Virtual))).toBe(sw.cacheKeyFor(new URL(resigned)));
    expect(sw.cacheKeyFor(new URL(r2Virtual))).toBe(
      'https://gallery-photos.abc123.r2.cloudflarestorage.com/g1/thumb%20a.jpg?x-id=GetObject'
    );
  });

  it('keeps different objects distinct', () => {
    const other = r2Virtual.replace('thumb%20a.jpg', 'thumb%20b.jpg');
    expect(sw.cacheKeyFor(new URL(r2Virtual))).not.toBe(sw.cacheKeyFor(new URL(other)));
  });

  it('drops the whole query for Supabase signed URLs', () => {
    expect(sw.cacheKeyFor(new URL('https://x.supabase.co/storage/v1/object/sign/b/a.jpg?token=t'))).toBe(
      'https://x.supabase.co/storage/v1/object/sign/b/a.jpg'
    );
  });
});

describe('sw.js trimCache', () => {
  it('evicts the oldest entries beyond the cap', async () => {
    const keys = Array.from({ length: 305 }, (_, i) => `k${i}`);
    const cache = {
      keys: async () => [...keys],
      delete: async (k: string) => {
        keys.splice(keys.indexOf(k), 1);
        return true;
      },
    };
    await sw.trimCache(cache, sw.MAX_CACHE_ENTRIES);
    expect(sw.MAX_CACHE_ENTRIES).toBe(300);
    expect(keys.length).toBe(300);
    expect(keys[0]).toBe('k5');
  });
});
