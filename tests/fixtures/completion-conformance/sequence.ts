import type { ConformanceFixture } from './_types';

// Spec §3 (Sequence) §2.7 Options: activations, active-tag.
// `solid-fill` via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'sequence',
  structuralKeywords: ['if', 'else', 'loop', 'parallel', 'note', 'tag'],
  specSection: '3',
  firstLineKeyword: 'sequence',
  directives: ['activations', 'active-tag', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [
    { directive: 'palette', source: 'palettes' },
    { directive: 'activations', values: ['on', 'off'] },
  ],
};
