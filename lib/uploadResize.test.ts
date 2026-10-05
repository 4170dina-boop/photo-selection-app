import { describe, expect, it } from 'vitest';
import { isResizableType, shouldUseResized, targetDimensions, UPLOAD_MAX_EDGE } from './uploadResize';

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
