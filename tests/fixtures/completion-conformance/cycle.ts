import type { ConformanceFixture } from './_types';

// Spec §21 (Cycle Diagrams). Three chart-specific directives plus
// the fill family (via FILL_FAMILY_CAPABLE — not yet documented in §21.5).
// Pipe metadata splits cleanly across node and edge contexts.
//
// Note: spec subsection numbering inside §21 reads "20.1, 20.2, ..." —
// stale from when cycle was §20. Tracked separately.
export const fixture: ConformanceFixture = {
  chartType: 'cycle',
  structuralKeywords: ['direction-counterclockwise', 'circle-nodes'],
  specSection: '21',
  firstLineKeyword: 'cycle',

  directives: [
    'direction-counterclockwise',
    'circle-nodes',
    'fill-tint',
    'fill-solid',
    'fill-outline', // working but not documented in §21.5
  ],

  pipeKeys: {
    node: ['color', 'span', 'description'],
    edge: ['color', 'width'],
  },

  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
