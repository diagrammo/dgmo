import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §24 (Ring Diagrams). Two layer-pipe keys (color, description) and
// the fill family. `inverted` is explicitly
// REJECTED by the parser per §24.5 — listed in `notFirstLineKeywords`.
export const fixture: ConformanceFixture = {
  chartType: 'ring',
  specSection: '24',
  firstLineKeyword: 'ring',

  directives: [...FRAME_DIRECTIVES, 'fill-tint', 'fill-solid', 'fill-outline'],

  pipeKeys: {
    layer: ['color', 'description'],
  },
};
