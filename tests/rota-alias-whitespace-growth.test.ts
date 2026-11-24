import { describe, expect, it } from 'vitest';
import { checkAliasSyntax } from '../src/utils/alias-registry';
import { splitNameAndMeta } from '../src/utils/parsing';
import { parseInfra } from '../src/infra/parser';
import { parseVisualization } from '../src/visualizations/parse';
import { SEQUENCE_REGISTRY } from '../src/utils/reserved-key-registry';
import { measureGrowth } from './perf-helpers';

// The `as <alias>` regexes put `\s+` before `as`, so every start inside a
// long whitespace run rescanned the run (#2280). A line of a name, a long
// space run and a word that is not `as` is the adversarial input.
// class, er and boxes-and-lines are left out: other lazy-name regexes in
// those parsers stay quadratic on the same input (tracked separately).
const run = (n: number) => `x${' '.repeat(n)}y`;

const cases: Array<[string, (src: string) => unknown, (n: number) => string]> =
  [
    ['checkAliasSyntax', (s) => checkAliasSyntax(s, undefined, 1), run],
    ['splitNameAndMeta', (s) => splitNameAndMeta(s, SEQUENCE_REGISTRY), run],
    ['infra', (s) => parseInfra(s), (n) => `infra\na${' '.repeat(n)}%`],
    ['venn', (s) => parseVisualization(s), (n) => `venn\n${run(n)}`],
  ];

describe('`as <alias>` regexes on a long whitespace run (#2280)', () => {
  for (const [name, parse, input] of cases) {
    it(`${name}: cost grows about linearly with the space run`, () => {
      const exponent = measureGrowth({
        small: 2000,
        large: 8000,
        prepare: input,
        run: parse,
        limit: 1.5,
      });
      expect(exponent).toBeLessThan(1.5);
    });
  }

  it('an alias is still peeled after the lookbehind', () => {
    expect(splitNameAndMeta('Web Server as web', SEQUENCE_REGISTRY).alias).toBe(
      'web'
    );
    expect(
      splitNameAndMeta('Storage as a Service', SEQUENCE_REGISTRY).alias
    ).toBeUndefined();
  });
});
