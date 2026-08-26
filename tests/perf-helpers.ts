/** Return the fastest run so scheduler pauses do not dominate the sample. */
export function fastestOf(repetitions: number, run: () => void): number {
  let fastest = Infinity;
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    run();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

/** The exponent k in cost proportional to n^k, derived from two samples. */
export function growthExponent(
  small: { n: number; ms: number },
  large: { n: number; ms: number }
): number {
  return Math.log(large.ms / small.ms) / Math.log(large.n / small.n);
}
