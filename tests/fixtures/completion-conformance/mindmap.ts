import type { ConformanceFixture } from './_types';

// Spec §18 (Mindmap Diagrams). Two directives plus solid-fill (via
// SOLID_FILL_CAPABLE). Two static node-pipe keys; tag aliases are
// user-defined and resolved at runtime.
//
// Note: spec subsection numbering inside §18 reads "17.1, 17.2, ..." —
// stale from when mindmap was §17. Tracked separately.
export const fixture: ConformanceFixture = {
  chartType: 'mindmap',
  specSection: '18',
  firstLineKeyword: 'mindmap',

  directives: [
    'active-tag',
    'solid-fill', // working but not documented in §18.7
  ],

  pipeKeys: {
    node: ['description', 'collapsed'],
  },

  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
