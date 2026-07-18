import type { ConformanceFixture } from './_types';

// Spec §20 (Tech Radar). One directive: no-blip-legend (listing default-on
// per decision #48; legacy `show-blip-legend` is a no-op). `rings` is a
// structural block keyword. Pipe metadata splits across quadrant
// headers (quadrant, color) and blip lines (ring, trend).
export const fixture: ConformanceFixture = {
  chartType: 'tech-radar',
  structuralKeywords: ['rings'],
  specSection: '20',
  firstLineKeyword: 'tech-radar',
  directives: ['no-blip-legend'],
  pipeKeys: {
    // Stuffed into `node` until PIPE_METADATA gains real
    // quadrant/blip contexts. Spec defines:
    //   quadrant headers: quadrant, color
    //   blips:            ring, trend
    node: ['quadrant', 'color', 'ring', 'trend'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
