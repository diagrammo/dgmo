// ============================================================
// Map binned scale — class breaks (#1988)
// ============================================================
//
// `scale binned <n>` cuts the region values into n quantile classes;
// `scale binned <t1> <t2> …` uses the author's thresholds. Decided
// 2026-11-23 (issue #1988, mockup 2026-11-22-map-binned-scale-decisions):
//   - a value ON a break starts the upper class;
//   - quantile breaks are rounded before regions are coloured, so the legend
//     reads "under 2 · 2–5 · … · 15 and up";
//   - quantile classes left empty by ties merge (the caller warns);
//   - 2–9 classes (MAP_BINNED_MIN_CLASSES..MAP_BINNED_MAX_CLASSES).
// Threshold classes keep their colour slot whatever the data, so two maps
// with the same thresholds compare; only empty END classes leave the legend.

import { compactNumber } from '../utils/number-format';

export const MAP_BINNED_MIN_CLASSES = 2;
export const MAP_BINNED_MAX_CLASSES = 9;

export type BinnedScale =
  | { kind: 'binned'; count: number; line: number }
  | { kind: 'binned'; thresholds: readonly number[]; line: number };

export interface MapBin {
  /** Inclusive low break (undefined for the open bottom class). */
  readonly from?: number;
  /** Exclusive high break (undefined for the open top class). */
  readonly to?: number;
  /** Position among ALL colour slots, 0 = lowest. */
  readonly slot: number;
  readonly label: string;
}

export interface MapBins {
  readonly bins: readonly MapBin[];
  /** Colour slots the classes are spread over (≥ bins.length). */
  readonly slots: number;
  /** Quantile form only: classes asked for, when fewer could be drawn. */
  readonly requested?: number;
  /** The bin index a value falls in, or -1 when it is in no drawn bin. */
  readonly binOf: (v: number) => number;
}

/** Quantile at p (0–1) of sorted values, linear between ranks. */
function quantile(sorted: readonly number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** Rounds a break to two significant figures (2.04 → 2, 10.8 → 11,
 *  1,234 → 1,200), so the legend reads like a news map's. */
function roundBreak(v: number): number {
  return v === 0 ? 0 : parseFloat(v.toPrecision(2));
}

const fmt = (n: number): string => compactNumber(n);

function labelFor(from: number | undefined, to: number | undefined): string {
  if (from === undefined && to !== undefined) return `under ${fmt(to)}`;
  if (to === undefined && from !== undefined) return `${fmt(from)} and up`;
  return `${fmt(from!)}–${fmt(to!)}`;
}

/** Class index under `breaks` (sorted): a value on a break starts the upper class. */
function classOf(v: number, breaks: readonly number[]): number {
  let i = 0;
  while (i < breaks.length && v >= breaks[i]!) i++;
  return i;
}

export function computeMapBins(
  values: readonly number[],
  scale: BinnedScale
): MapBins | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);

  if ('thresholds' in scale) {
    const breaks = scale.thresholds;
    const slots = breaks.length + 1;
    const counts = new Array<number>(slots).fill(0);
    for (const v of sorted) counts[classOf(v, breaks)]!++;
    // Interior classes always show; an open end shows only when used.
    const first = counts[0]! > 0 ? 0 : 1;
    const last = counts[slots - 1]! > 0 ? slots - 1 : slots - 2;
    const bins: MapBin[] = [];
    for (let s = first; s <= last; s++) {
      const from = s === 0 ? undefined : breaks[s - 1];
      const to = s === slots - 1 ? undefined : breaks[s];
      bins.push({
        ...(from !== undefined && { from }),
        ...(to !== undefined && { to }),
        slot: s,
        label: labelFor(from, to),
      });
    }
    return {
      bins,
      slots,
      binOf: (v) => {
        const s = classOf(v, breaks);
        return s >= first && s <= last ? s - first : -1;
      },
    };
  }

  // Quantile: n-1 inner breaks, rounded, then drop any that leave a class
  // empty (ties, or a rounded break that swallowed a class).
  const n = scale.count;
  let breaks = Array.from({ length: n - 1 }, (_, i) =>
    roundBreak(quantile(sorted, (i + 1) / n))
  );
  breaks = [...new Set(breaks)];
  for (;;) {
    const counts = new Array<number>(breaks.length + 1).fill(0);
    for (const v of sorted) counts[classOf(v, breaks)]!++;
    const empty = counts.findIndex((c) => c === 0);
    if (empty < 0) break;
    breaks.splice(Math.min(empty, breaks.length - 1), 1);
  }
  const classes = breaks.length + 1;
  const bins: MapBin[] = Array.from({ length: classes }, (_, s) => {
    const from = s === 0 ? undefined : breaks[s - 1];
    const to = s === classes - 1 ? undefined : breaks[s];
    return {
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
      slot: s,
      label: classes === 1 ? fmt(sorted[0]!) : labelFor(from, to),
    };
  });
  return {
    bins,
    slots: classes,
    ...(classes < n && { requested: n }),
    binOf: (v) => classOf(v, breaks),
  };
}
