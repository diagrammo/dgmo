import type { ConformanceFixture } from './_types';

// Spec §19. Layout/form-factor option: `mobile`. active-tag for tag groups.
// fill family via FILL_FAMILY_CAPABLE. Pipe metadata uses flag keywords (not
// key-value) per §18.5 — flags aren't surfaced via PIPE_METADATA today.
export const fixture: ConformanceFixture = {
  chartType: 'wireframe',
  structuralKeywords: [
    'nav',
    'tabs',
    'table',
    'image',
    'modal',
    'skeleton',
    'alert',
    'progress',
    'chart',
    'mobile',
    'tag',
  ],
  specSection: '19',
  firstLineKeyword: 'wireframe',
  directives: [
    'mobile',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
