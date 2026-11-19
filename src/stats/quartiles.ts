// ============================================================
// Quartiles and the Tukey box (#1848)
// ============================================================
//
// Pure functions over plain number arrays; no rendering, no parsing.
// Quartiles use linear interpolation between the two nearest ranks: Excel
// QUARTILE.INC, R type 7, d3.quantile.

/**
 * Quantile `p` (0..1) of an ascending array, by linear interpolation
 * between the two nearest ranks (the R-7 / d3 rule). NaN when empty.
 */
export function quantileSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1 || p <= 0) return sorted[0]!;
  if (p >= 1) return sorted[n - 1]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const a = sorted[lo]!;
  const b = sorted[lo + 1]!;
  return a + (b - a) * (h - lo);
}

/** First quartile, median and third quartile. */
export interface Quartiles {
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
}

export function quartiles(values: readonly number[]): Quartiles {
  const s = [...values].sort((a, b) => a - b);
  return {
    q1: quantileSorted(s, 0.25),
    median: quantileSorted(s, 0.5),
    q3: quantileSorted(s, 0.75),
  };
}

/** One group's Tukey box: quartiles, whisker ends and the values beyond. */
export interface BoxSummary extends Quartiles {
  readonly n: number;
  readonly mean: number;
  /** The lowest and highest values within 1.5 × IQR of the box. */
  readonly whiskerLo: number;
  readonly whiskerHi: number;
  /** Values outside the whiskers, ascending. */
  readonly outliers: number[];
  readonly min: number;
  readonly max: number;
}

/** How far past the box, in IQRs, a whisker may reach (Tukey). */
export const TUKEY_FENCE = 1.5;

/** The Tukey box of a group. Null when the group is empty. */
export function boxSummary(values: readonly number[]): BoxSummary | null {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  const q1 = quantileSorted(s, 0.25);
  const median = quantileSorted(s, 0.5);
  const q3 = quantileSorted(s, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - TUKEY_FENCE * iqr;
  const hiFence = q3 + TUKEY_FENCE * iqr;
  const inside = s.filter((v) => v >= loFence && v <= hiFence);
  return {
    n,
    q1,
    median,
    q3,
    mean: s.reduce((a, b) => a + b, 0) / n,
    whiskerLo: inside[0] ?? q1,
    whiskerHi: inside.at(-1) ?? q3,
    outliers: s.filter((v) => v < loFence || v > hiFence),
    min: s[0]!,
    max: s[n - 1]!,
  };
}
