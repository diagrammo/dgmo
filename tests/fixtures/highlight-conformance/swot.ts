import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'swot',
  specSection: '40',
  source: `swot Tortuga Rum Co.
no-axes

strengths
  Oldest still on the island
weaknesses Soft spots yellow
  One barrel supplier
  Two crew roles unfilled
opportunities
  Navy rum ration contract
threats
  Royal Navy blockade
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'swot', role: 'chartType' },
    { text: 'no-axes', role: 'keyword' },
    { text: 'strengths', role: 'controlKeyword' },
    { text: 'weaknesses', role: 'controlKeyword' },
    { text: 'opportunities', role: 'controlKeyword' },
    { text: 'threats', role: 'controlKeyword' },
  ],
};
