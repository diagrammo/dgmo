// Shared compact number formatting. Used by the map region-value labels and the
// gradient legend's ramp ends so the two read identically (a region printing
// `39.5M` lines up with a legend that ends at `40M`).

/** Compact display of a numeric value:
 *  - integers and |n| < 1000 print bare (non-integers to 1 decimal, matching the
 *    legend's legacy ramp formatting): `0`, `3.2`, `999`, `42`.
 *  - |n| >= 1000 uses magnitude suffixes to 1 significant fraction digit:
 *    `1.1K`, `39.5M`, `2.3B`, `1.4T`.
 *  Negatives keep their sign (`-39.5M`). */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs < 1000) {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }
  const sign = n < 0 ? '-' : '';
  const units: ReadonlyArray<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [factor, suffix] of units) {
    if (abs >= factor) {
      // 1 fraction digit, but drop a trailing `.0` (39.0M → 39M).
      const scaled = Math.round((abs / factor) * 10) / 10;
      const body = Number.isInteger(scaled)
        ? String(scaled)
        : scaled.toFixed(1);
      return `${sign}${body}${suffix}`;
    }
  }
  // Unreachable (abs >= 1000 always matches the 1e3 unit), but keep TS happy.
  return String(n);
}
