// ============================================================
// Statistics overlays — the numbers (#1954)
// ============================================================
//
// Pure functions over a series' values. A non-finite value is a missing row
// and is skipped, never counted as 0.

const finite = (values: readonly number[]): number[] =>
  values.filter((v) => Number.isFinite(v));

/** Arithmetic mean of the finite values; NaN when there are none. */
export function mean(values: readonly number[]): number {
  const vs = finite(values);
  if (vs.length === 0) return NaN;
  return vs.reduce((a, b) => a + b, 0) / vs.length;
}

/** Median of the finite values (mean of the middle two when even). */
export function median(values: readonly number[]): number {
  const vs = finite(values).sort((a, b) => a - b);
  if (vs.length === 0) return NaN;
  const mid = vs.length >> 1;
  return vs.length % 2 ? vs[mid]! : (vs[mid - 1]! + vs[mid]!) / 2;
}

/** True when `v` reaches `target`: at or over it, or at or under it with `below`. */
export function reachesTarget(
  v: number,
  target: number,
  below = false
): boolean {
  return below ? v <= target : v >= target;
}

/**
 * A number short enough for an overlay label: whole above 100, else three
 * significant figures (441.25 → 441, 56.875 → 56.9, 0.04567 → 0.0457).
 */
export function roundStat(v: number): number {
  if (!Number.isFinite(v) || v === 0) return v;
  if (Math.abs(v) >= 100) return Math.round(v);
  return Number(v.toPrecision(3));
}
