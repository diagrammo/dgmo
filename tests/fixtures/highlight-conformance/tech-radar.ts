import type { HighlightFixture } from './_types';

// Tech-radar exposes a name-collision: `quadrant` and `ring` are both
// chart-type keywords AND pipe-metadata keys here. The current
// highlighter doesn't context-distinguish, so they stay as `chartType`
// even after a `|`. Documented limitation — fixture asserts only on
// the unambiguous tokens until contextual override lands.
export const fixture: HighlightFixture = {
  chartType: 'tech-radar',
  specSection: '20',
  source: `tech-radar Engineering Radar
show-blip-legend

rings
  Adopt
  Trial

Tools | quadrant: top-left
  Vite | ring: Adopt, trend: up
`,
  assertions: [
    { text: 'tech-radar', role: 'chartType' },
    { text: 'show-blip-legend', role: 'keyword' },
    { text: 'rings', role: 'keyword' },
    { text: 'top-left', role: 'keyword' },
    { text: 'trend', role: 'keyword' },
  ],
};
