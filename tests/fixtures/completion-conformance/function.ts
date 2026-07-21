import type { ConformanceFixture } from './_types';

// Spec §16 / §15.4. Functional family — colon REQUIRED between name and
// expression (§15.4). `x` declares the x-axis range; `fill` shades the
// area below curves.
export const fixture: ConformanceFixture = {
  chartType: 'function',
  specSection: '16',
  firstLineKeyword: 'function',
  directives: ['no-legend', 'x', 'x-label', 'y-label', 'fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
