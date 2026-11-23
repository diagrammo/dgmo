// cspell:ignore Diaconis Sturges
// ============================================================
// Distribution statistics — binning (#1847)
// ============================================================
//
// The histogram's bins (#1847). Quartiles live in ./quartiles, shared with
// the box plot (#1848). Pure functions over plain number arrays.

import { quartiles } from './quartiles';

/** One counted bin: `[x0, x1)`, the last one closed on both sides. */
export interface Bin {
  readonly x0: number;
  readonly x1: number;
  readonly count: number;
}

/** Strip binary floating-point noise from a computed edge (0.30000000000000004 → 0.3). */
export function cleanEdge(v: number): number {
  return v === 0 ? 0 : parseFloat(v.toPrecision(12));
}

const ROUND_STEPS = [1, 2, 2.5, 5] as const;

/**
 * The most bins one histogram draws. A narrower `bin-width` or a larger
 * `bins` is refused by the parser (#2261); the binning helpers below also
 * hold to it, so a direct caller cannot build millions of edges.
 */
export const MAX_HISTOGRAM_BINS = 1000;

/**
 * The smallest round width at or above `w`: 1, 2, 2.5 or 5 × 10ⁿ.
 * `w` ≤ 0 or not finite gives 1.
 */
export function roundWidthUp(w: number): number {
  if (!(w > 0) || !Number.isFinite(w)) return 1;
  const e = Math.floor(Math.log10(w));
  for (let k = e; k <= e + 1; k++) {
    for (const s of ROUND_STEPS) {
      const c = cleanEdge(s * 10 ** k);
      if (c >= w * (1 - 1e-12)) return c;
    }
  }
  return cleanEdge(10 ** (e + 1));
}

/**
 * Freedman–Diaconis bin width, 2 × IQR ÷ ∛n, rounded up to a round width.
 * When the IQR is 0 (most values equal) the data range is split by
 * Sturges' rule instead; a single distinct value gets width 1.
 */
export function freedmanDiaconisWidth(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 1;
  const { q1, q3 } = quartiles(values);
  const iqr = q3 - q1;
  if (iqr > 0) return roundWidthUp((2 * iqr) / Math.cbrt(n));
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) return 1;
  return roundWidthUp((hi - lo) / (Math.ceil(Math.log2(n)) + 1));
}

/**
 * The tick step d3 and Observable Plot use for about `count` intervals over
 * `[lo, hi]`: 1, 2 or 5 × 10ⁿ, whichever lands the count closest.
 */
export function niceStep(lo: number, hi: number, count: number): number {
  const span = hi - lo;
  if (!(span > 0) || !(count >= 1)) return 1;
  const raw = span / count;
  const e = Math.floor(Math.log10(raw));
  const base = 10 ** e;
  const f = raw / base;
  // d3-array tickIncrement thresholds: √50, √10, √2.
  const m =
    f >= Math.sqrt(50)
      ? 10
      : f >= Math.sqrt(10)
        ? 5
        : f >= Math.sqrt(2)
          ? 2
          : 1;
  return cleanEdge(m * base);
}

/**
 * Edges at `start + k·width` covering `[lo, hi]`. `start` defaults to 0, so
 * edges fall on multiples of the width. When `start` is given it is the first
 * edge. A data set of one value still gets one bin.
 */
export function edgesForWidth(
  lo: number,
  hi: number,
  width: number,
  start?: number
): number[] {
  const base = start ?? 0;
  const k0 = start !== undefined ? 0 : Math.floor((lo - base) / width + 1e-9);
  let k1 = Math.ceil((hi - base) / width - 1e-9);
  if (k1 <= k0) k1 = k0 + 1;
  // Backstop for #2261: never more than MAX_HISTOGRAM_BINS bins.
  if (!(k1 - k0 <= MAX_HISTOGRAM_BINS)) k1 = k0 + MAX_HISTOGRAM_BINS;
  const edges: number[] = [];
  for (let k = k0; k <= k1; k++) edges.push(cleanEdge(base + k * width));
  return edges;
}

/**
 * Count `values` into the bins `edges` marks. A value on an edge goes in
 * the bin to its right; the last bin also takes its right edge. Values
 * outside `[edges[0], edges[last]]` are not counted.
 */
export function countIntoBins(
  values: readonly number[],
  edges: readonly number[]
): Bin[] {
  const nBins = Math.max(0, edges.length - 1);
  const counts = new Array<number>(nBins).fill(0);
  const first = edges[0]!;
  const last = edges[nBins]!;
  for (const v of values) {
    if (!(v >= first && v <= last)) continue;
    // Largest i with edges[i] <= v.
    let a = 0;
    let b = nBins;
    while (a < b) {
      const mid = (a + b + 1) >> 1;
      if (edges[mid]! <= v) a = mid;
      else b = mid - 1;
    }
    counts[Math.min(a, nBins - 1)]!++;
  }
  return counts.map((count, i) => ({
    x0: edges[i]!,
    x1: edges[i + 1]!,
    count,
  }));
}

/** How the bin width is chosen. */
export interface BinRule {
  /** `bin-width W`: the exact width. */
  readonly width?: number;
  /** `bins N`: about N bins with round edges. */
  readonly count?: number;
  /** `bin-start S`: the first edge. */
  readonly start?: number;
}

/**
 * The shared edges for one histogram: every group's values pooled, the width
 * from the rule (Freedman–Diaconis when the rule sets none).
 */
export function histogramEdges(
  pooled: readonly number[],
  rule: BinRule = {}
): { edges: number[]; width: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of pooled) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return { edges: [], width: 0 };
  if (rule.start !== undefined) lo = Math.max(lo, rule.start);
  let width =
    rule.width ??
    (rule.count !== undefined
      ? niceStep(rule.start ?? lo, hi, Math.min(rule.count, MAX_HISTOGRAM_BINS))
      : freedmanDiaconisWidth(pooled));
  // A width that would need more than MAX_HISTOGRAM_BINS bins (a tiny
  // bin-width, or a bin-start far below the data) widens to the round width
  // that fits (#2261).
  const span = hi - (rule.start ?? lo);
  if (span / width > MAX_HISTOGRAM_BINS)
    width = roundWidthUp(span / MAX_HISTOGRAM_BINS);
  return { edges: edgesForWidth(lo, hi, width, rule.start), width };
}

/**
 * Mean of pre-counted bins, taking each bin's midpoint as its value.
 * NaN when nothing is counted.
 */
export function binnedMean(bins: readonly Bin[]): number {
  let sum = 0;
  let n = 0;
  for (const b of bins) {
    sum += ((b.x0 + b.x1) / 2) * b.count;
    n += b.count;
  }
  return n > 0 ? sum / n : NaN;
}

/**
 * Median of pre-counted bins, interpolated inside the bin that holds the
 * middle count (values spread evenly across each bin). NaN when empty.
 */
export function binnedMedian(bins: readonly Bin[]): number {
  const sorted = [...bins].sort((a, b) => a.x0 - b.x0);
  const total = sorted.reduce((s, b) => s + b.count, 0);
  if (total <= 0) return NaN;
  const half = total / 2;
  let below = 0;
  for (const b of sorted) {
    if (b.count > 0 && below + b.count >= half)
      return b.x0 + ((half - below) / b.count) * (b.x1 - b.x0);
    below += b.count;
  }
  return sorted.at(-1)!.x1;
}
