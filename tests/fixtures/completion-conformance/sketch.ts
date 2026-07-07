import type { ConformanceFixture } from './_types';

// Spec §31. GUI-first canvas: shapes carry same-line `shape:`/`at:` metadata,
// boxes take a bare `collapsed` flag; directives are legend/fill toggles only.
// solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'sketch',
  structuralKeywords: ['tag'],
  specSection: '31',
  firstLineKeyword: 'sketch',
  directives: ['no-legend', 'solid-fill'],
  pipeKeys: {
    node: ['shape', 'at', 'collapsed'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
