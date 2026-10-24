/**
 * How far a range input is from its minimum to its maximum, as a percentage.
 * The themed slider paints its filled track from `--range-fill`.
 */
export function rangeFillPercent(min: string, max: string, value: string): number {
  const lo = min.trim() === "" ? 0 : Number(min);
  const hi = max.trim() === "" ? 100 : Number(max);
  const current = Number(value);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(current) || hi === lo) {
    return 0;
  }
  return ((current - lo) / (hi - lo)) * 100;
}
