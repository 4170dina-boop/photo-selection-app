import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isResizableType,
  MAX_WORKER_FAILURES,
  resizeImageToJpeg,
  shouldUseResized,
  targetDimensions,
  UPLOAD_MAX_EDGE,
  workersExhausted,
} from './uploadResize';

describe('workersExhausted', () => {
  it('keeps using workers after one or two crashes, gives up at MAX_WORKER_FAILURES', () => {
    expect(MAX_WORKER_FAILURES).toBe(3);
    expect(workersExhausted(0)).toBe(false);
    expect(workersExhausted(1)).toBe(false);
    expect(workersExhausted(2)).toBe(false);
    expect(workersExhausted(3)).toBe(true);
    expect(workersExhausted(4)).toBe(true);
  });
});

describe('resizeImageToJpeg', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubBitmap(width: number, height: number) {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close })));
    return close;
  }

  it('returns null (upload the original untouched) when the image is already small enough', async () => {
    const close = stubBitmap(2000, 1500);
    const createCanvas = vi.fn();
    const result = await resizeImageToJpeg(new Blob(['x'], { type: 'image/png' }), 3000, 0.85, createCanvas);
    expect(result).toBeNull();
    // בלי קנבס ובלי קידוד מחדש בכלל
    expect(createCanvas).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('re-encodes to JPEG at the target size when the image is larger than maxEdge', async () => {
    stubBitmap(6000, 4000);
    const out = new Blob(['jpeg'], { type: 'image/jpeg' });
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: 'low' };
    const createCanvas = vi.fn((w: number, h: number) => ({
      width: w,
      height: h,
      getContext: () => ctx,
      convertToBlob: vi.fn(async () => out),
    }));
    const result = await resizeImageToJpeg(new Blob(['x'], { type: 'image/jpeg' }), 3000, 0.85, createCanvas as never);
    expect(result).toBe(out);
    expect(createCanvas).toHaveBeenCalledWith(3000, 2000);
  });
});

describe('targetDimensions', () => {
  it('scales a landscape camera photo so the long edge is maxEdge', () => {
    expect(targetDimensions(6000, 4000, 3000)).toEqual({ width: 3000, height: 2000, scaled: true });
  });

  it('scales a portrait photo by its height', () => {
    expect(targetDimensions(4000, 6000, 3000)).toEqual({ width: 2000, height: 3000, scaled: true });
  });

  it('keeps the aspect ratio and rounds to whole pixels', () => {
    // 45MP (8256x5504) -> 3000x2000
    const t = targetDimensions(8256, 5504, 3000);
    expect(t).toEqual({ width: 3000, height: 2000, scaled: true });
    // phone 4032x3024 -> 3000x2250
    expect(targetDimensions(4032, 3024, 3000)).toEqual({ width: 3000, height: 2250, scaled: true });
  });

  it('never enlarges a small image', () => {
    expect(targetDimensions(2000, 1500, 3000)).toEqual({ width: 2000, height: 1500, scaled: false });
    expect(targetDimensions(3000, 3000, 3000)).toEqual({ width: 3000, height: 3000, scaled: false });
  });

  it('keeps at least 1px on very thin panoramas', () => {
    expect(targetDimensions(30000, 2, 3000)).toEqual({ width: 3000, height: 1, scaled: true });
  });

  it('leaves invalid input untouched', () => {
    expect(targetDimensions(0, 100, 3000).scaled).toBe(false);
    expect(targetDimensions(NaN, 100, 3000).scaled).toBe(false);
    expect(targetDimensions(6000, 4000, 0).scaled).toBe(false);
  });

  it('defaults to UPLOAD_MAX_EDGE', () => {
    const t = targetDimensions(9000, 6000);
    expect(Math.max(t.width, t.height)).toBe(UPLOAD_MAX_EDGE);
  });
});

describe('shouldUseResized', () => {
  it('uses the resized file only when it is actually smaller', () => {
    expect(shouldUseResized(10_000_000, 1_500_000)).toBe(true);
    expect(shouldUseResized(500_000, 600_000)).toBe(false);
    expect(shouldUseResized(500_000, 500_000)).toBe(false);
  });

  it('falls back to the original when resizing failed', () => {
    expect(shouldUseResized(10_000_000, null)).toBe(false);
    expect(shouldUseResized(10_000_000, 0)).toBe(false);
  });
});

describe('isResizableType', () => {
  it('resizes only formats every browser can decode', () => {
    expect(isResizableType('image/jpeg')).toBe(true);
    expect(isResizableType('image/png')).toBe(true);
    expect(isResizableType('image/webp')).toBe(true);
    expect(isResizableType('image/tiff')).toBe(false);
    expect(isResizableType('image/avif')).toBe(false);
    expect(isResizableType('')).toBe(false);
  });
});
