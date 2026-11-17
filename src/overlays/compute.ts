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

/** A least-squares line y = intercept + slope · x, and how well it fits. */
export interface LinearFit {
  readonly slope: number;
  readonly intercept: number;
  /** Coefficient of determination, 0–1. 1 when every y is equal. */
  readonly r2: number;
}

/**
 * Ordinary least squares over the pairs where both x and y are finite.
 * Null when fewer than two such pairs, or every x is the same.
 */
export function linearFit(
  xs: readonly number[],
  ys: readonly number[]
): LinearFit | null {
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++)
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      px.push(xs[i]!);
      py.push(ys[i]!);
    }
  const n = px.length;
  if (n < 2) return null;
  const mx = px.reduce((a, b) => a + b, 0) / n;
  const my = py.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = px[i]! - mx;
    const dy = py[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return {
    slope,
    intercept: my - slope * mx,
    r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy),
  };
}
