import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §24C (Treemap). The only node metadata key besides tag values is `heat`.
export const fixture: ConformanceFixture = {
  chartType: 'treemap',
  specSection: '24C',
  firstLineKeyword: 'treemap',
  structuralKeywords: ['tag'],
  directives: [
    ...FRAME_DIRECTIVES,
    'heat',
    'active-tag',
    'depth',
    'no-value',
    'no-percent',
    'no-headers',
    'no-legend',
    'sunburst',
    'icicle',
    // §1.11 emphasis, lineage closure.
    'highlight',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: { node: ['heat'] },
};
