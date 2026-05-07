import type { ConformanceFixture } from './_types';

// Spec §22 (Journey Map Diagrams). Directives: no-legend, active-tag,
// plus solid-fill via SOLID_FILL_CAPABLE.
//
// Open coverage gap (not asserted yet): step-annotation keys — `pain:`,
// `opportunity:`, `thought:`, `description:` — appear on indented lines
// inside a step, not after a pipe. They're a third completion surface
// the harness doesn't model yet (PIPE_METADATA covers only after-`|`
// keys). Tracked separately.
export const fixture: ConformanceFixture = {
  chartType: 'journey-map',
  specSection: '22',
  firstLineKeyword: 'journey-map',

  directives: [
    'no-legend',
    'active-tag',
    'solid-fill', // working but not documented in §22 directives table
  ],

  pipeKeys: {
    // Step pipe accepts `score` as the only documented static key.
    // Tag aliases (e.g. `ch: Web`) are user-defined via `tag` blocks
    // and resolved at runtime, not via static PIPE_METADATA.
    node: ['score'],
  },

  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
