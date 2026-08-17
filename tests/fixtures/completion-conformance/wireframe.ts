import type { ConformanceFixture } from './_types';

// Spec §19. Layout/form-factor option: `mobile`.
// fill family via FILL_FAMILY_CAPABLE. Pipe metadata uses flag keywords (not
// key-value) per §18.5 — flags aren't surfaced via PIPE_METADATA today.
// NO tag groups and NO `active-tag`: an element's appearance comes from its
// trailing state keywords, so there is nothing for a tag to colour (#251).
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
  ],
  specSection: '19',
  firstLineKeyword: 'wireframe',
  directives: ['mobile', 'fill-tint', 'fill-solid', 'fill-outline'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
