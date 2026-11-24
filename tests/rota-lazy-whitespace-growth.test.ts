import { describe, expect, it } from 'vitest';
import { parseDgmo } from '../src/dgmo-router';
import { measureGrowth } from './perf-helpers';

// A lazy name group (`(.+?)`, `([^…]*?)`) followed by `\s`, or a regex that
// opens with `\s+` and is not anchored, rescanned a long whitespace run from
// every start (#2281). Each case is the line shape that read worst for its
// chart type in a census of every type, before the `(?<!\s)` guards; all were
// g ≈ 1.6–3.0 then (sequence was cubic: 55 s for one 4 KB line).
const shapes: Record<string, (s: string) => string> = {
  plain: (s) => `x${s}y`,
  arrow: (s) => `x${s}-> y`,
  arrowTail: (s) => `x ->${s}y`,
  indent: (s) => `A\n  x${s}y`,
  colon: (s) => `x${s}: y`,
  num: (s) => `x${s}1`,
  dash: (s) => `x${s}- y`,
};

const cases: Array<[string, keyof typeof shapes]> = [
  ['arc', 'colon'],
  ['boxes-and-lines', 'arrow'],
  ['bracket', 'dash'],
  ['c4', 'arrowTail'],
  ['class', 'indent'],
  ['clock', 'colon'],
  ['er', 'plain'],
  ['function', 'num'],
  ['funnel', 'num'],
  ['heatmap', 'num'],
  ['histogram', 'num'],
  ['infra', 'dash'],
  ['quadrant', 'dash'],
  ['sankey', 'plain'],
  ['scatter', 'num'],
  ['sequence', 'arrowTail'],
  ['treemap', 'arrow'],
  ['version-control', 'arrow'],
];

describe('lazy-name regexes on a long whitespace run (#2281)', () => {
  for (const [type, shape] of cases) {
    it(`${type} (${shape}): cost grows about linearly with the space run`, () => {
      const exponent = measureGrowth({
        small: 1000,
        large: 4000,
        prepare: (n) => `${type}\n${shapes[shape]!(' '.repeat(n))}`,
        run: (src) => parseDgmo(src),
        limit: 1.5,
      });
      expect(exponent).toBeLessThan(1.5);
    });
  }
});
