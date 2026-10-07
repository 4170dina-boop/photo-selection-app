export function clampCompareScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(4, Math.max(1, scale));
}

export function clampComparePan(value: number, scale: number): number {
  if (scale <= 1) return 0;
  const maxPan = 180 * (scale - 1);
  return Math.max(-maxPan, Math.min(maxPan, value));
}
