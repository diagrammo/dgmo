import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §33 (Body). Figure facets are bare directives (§33.2).
export const fixture: ConformanceFixture = {
  chartType: 'body',
  specSection: '33',
  firstLineKeyword: 'body',
  structuralKeywords: ['tag'],
  directives: [
    ...FRAME_DIRECTIVES,
    // §33.2 facets: form, sex, view.
    'muscle',
    'skin',
    'male',
    'female',
    'front',
    'back',
    'no-legend',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
