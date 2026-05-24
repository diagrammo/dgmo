import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'c4',
  specSection: '8',
  source: `c4 System
direction-tb
active-tag X

User
  description: A user
App
  tech: React
  technology: TypeScript
`,
  assertions: [
    { text: 'c4', role: 'chartType' },
    { text: 'direction-tb', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
    { text: 'description', role: 'propertyName' },
    { text: 'tech', role: 'propertyName' },
    { text: 'technology', role: 'keyword' },
  ],
};
