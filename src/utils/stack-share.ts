/**
 * `stack 100%` shares (#1846), shared by the bar and line renderers. Values
 * stay raw in the source; each x position is converted to percentages of its
 * own total. A missing value (non-finite) counts as 0 and stays missing.
 */
export function toShares(values: readonly number[]): number[] {
  const total = values.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
  return values.map((v) =>
    !Number.isFinite(v) ? v : total > 0 ? (v / total) * 100 : 0
  );
}

/** A share as printed: whole percent, one decimal below 10%. */
export function shareText(p: number): string {
  const r = p >= 10 || p === 0 ? Math.round(p) : Math.round(p * 10) / 10;
  return `${r}%`;
}

/**
 * Cumulative `[lower, upper]` per series for one x position, bottom series
 * first. A missing value adds nothing.
 */
export function stackSpans(values: readonly number[]): [number, number][] {
  let acc = 0;
  return values.map((v) => {
    const from = acc;
    if (Number.isFinite(v)) acc += v;
    return [from, acc];
  });
}
