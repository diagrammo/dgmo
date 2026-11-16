/**
 * `stack diverging` geometry (#1980), shared by the bar parser (axis checks)
 * and renderer. Each series gets a `[from, to]` span on the value axis.
 * Series before the neutral one grow left of 0, series after it grow right,
 * nearest-to-centre first in declared order; the neutral segment is split
 * half each side of 0. With no neutral (`neutral` undefined) the split falls
 * between the two middle series. Values are magnitudes: a sign is ignored.
 */
export function divergingSpans(
  values: readonly number[],
  neutral: number | undefined
): [number, number][] {
  const a = values.map((v) => Math.abs(v));
  const spans: [number, number][] = a.map(() => [0, 0]);
  let lastLeft: number;
  let firstRight: number;
  let left = 0;
  let right = 0;
  if (neutral !== undefined && neutral < a.length) {
    const half = a[neutral]! / 2;
    spans[neutral] = [-half, half];
    left = -half;
    right = half;
    lastLeft = neutral - 1;
    firstRight = neutral + 1;
  } else {
    lastLeft = Math.ceil(a.length / 2) - 1;
    firstRight = lastLeft + 1;
  }
  for (let i = lastLeft; i >= 0; i--) {
    spans[i] = [left - a[i]!, left];
    left -= a[i]!;
  }
  for (let i = firstRight; i < a.length; i++) {
    spans[i] = [right, right + a[i]!];
    right += a[i]!;
  }
  return spans;
}
