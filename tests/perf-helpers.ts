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

/** Calls per sample so one sample lasts at least `minMs` (timer resolution). */
function callsFor(run: () => void, minMs: number): number {
  let calls = 1;
  while (calls < 1 << 20) {
    const started = performance.now();
    for (let i = 0; i < calls; i++) run();
    if (performance.now() - started >= minMs) break;
    calls *= 2;
  }
  return calls;
}

/**
 * The growth exponent of `run` between two sizes, measured so that load on a
 * shared machine cannot fake a superlinear result (diagrammo/diagrammo#1921).
 *
 * - Each sample repeats its call until it lasts `minMs`, so a microsecond call
 *   is not lost in timer resolution.
 * - Small and large samples alternate, round by round, so a load burst lands
 *   on both sizes rather than one; each size keeps its fastest round.
 * - If the exponent still reaches `limit`, the whole measurement repeats, up
 *   to `attempts` times, and the lowest exponent wins. Load only ever inflates
 *   a sample, and a genuinely superlinear algorithm reads superlinear on every
 *   quiet attempt, so the minimum is the honest reading.
 *
 * `prepare(n)` builds the input outside the timed region; `run` is timed.
 */
export function measureGrowth<T>(opts: {
  small: number;
  large: number;
  prepare: (n: number) => T;
  run: (input: T) => unknown;
  limit: number;
  rounds?: number;
  attempts?: number;
  minMs?: number;
}): number {
  const { small, large, prepare, run, limit } = opts;
  const rounds = opts.rounds ?? 5;
  const attempts = opts.attempts ?? 3;
  const minMs = opts.minMs ?? 5;
  const smallInput = prepare(small);
  const largeInput = prepare(large);
  const runSmall = () => void run(smallInput);
  const runLarge = () => void run(largeInput);
  const sample = (fn: () => void, calls: number) => {
    const started = performance.now();
    for (let i = 0; i < calls; i++) fn();
    return (performance.now() - started) / calls;
  };

  let best = Infinity;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const smallCalls = callsFor(runSmall, minMs);
    const largeCalls = callsFor(runLarge, minMs);
    let smallMs = Infinity;
    let largeMs = Infinity;
    for (let round = 0; round < rounds; round++) {
      smallMs = Math.min(smallMs, sample(runSmall, smallCalls));
      largeMs = Math.min(largeMs, sample(runLarge, largeCalls));
    }
    best = Math.min(
      best,
      growthExponent({ n: small, ms: smallMs }, { n: large, ms: largeMs })
    );
    if (best < limit) break;
  }
  return best;
}
