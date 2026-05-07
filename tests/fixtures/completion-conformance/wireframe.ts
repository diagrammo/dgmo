import type { ConformanceFixture } from './_types';

// Spec §19. Layout/form-factor option: `mobile`. active-tag for tag groups.
// solid-fill via SOLID_FILL_CAPABLE. Pipe metadata uses flag keywords (not
// key-value) per §18.5 — flags aren't surfaced via PIPE_METADATA today.
export const fixture: ConformanceFixture = {
  chartType: 'wireframe',
  specSection: '19',
  firstLineKeyword: 'wireframe',
  directives: ['mobile', 'active-tag', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
