import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'live-link',
  specSection: '38',
  // Two roles, not one: the chart-type keyword AND the `url` directive. Copying
  // a single-assertion fixture (class.ts) would pass while `url` highlighted as
  // plain identifier text — the exact failure registering it in
  // directives-registry.ts exists to prevent.
  source: `live-link Platform architecture
url https://online.diagrammo.app/d/dgm_7f2a91
`,
  assertions: [
    { text: 'live-link', role: 'chartType' },
    { text: 'url', role: 'keyword' },
  ],
};
