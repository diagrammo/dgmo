import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §24B (Map). `poi`, `route`, `note` and `tag` open lines; element
// channels are the reserved colon keys of §24B.9.
export const fixture: ConformanceFixture = {
  chartType: 'map',
  specSection: '24B',
  firstLineKeyword: 'map',
  structuralKeywords: ['poi', 'route', 'note', 'tag'],
  directives: [
    ...FRAME_DIRECTIVES,
    'region-heat',
    'scale',
    'poi-size',
    'flow-width',
    'locale',
    'active-tag',
    'no-legend',
    'no-coastline',
    'no-relief',
    'no-context-labels',
    'no-region-labels',
    'no-region-heat-value',
    'no-poi-labels',
    'no-notes',
    'no-colorize',
    'no-cities',
    'no-cluster-pois',
  ],
  pipeKeys: {
    node: ['heat', 'size', 'width', 'label', 'style', 'clock'],
  },
  enumChecks: [{ directive: 'scale', values: ['diverging', 'binned'] }],
};
