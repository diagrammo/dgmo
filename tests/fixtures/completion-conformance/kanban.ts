import type { ConformanceFixture } from './_types';

// Spec §11 §10.4 Options: no-auto-color, hide, active-tag.
// solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'kanban',
  specSection: '11',
  firstLineKeyword: 'kanban',
  directives: ['no-auto-color', 'hide', 'active-tag', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
