import type { HighlightFixture } from './_types';

// Spec §18. Mindmap: chart-type, two directives, node pipe metadata.
export const fixture: HighlightFixture = {
  chartType: 'mindmap',
  specSection: '18',
  source: `mindmap Product Strategy
no-descriptions

Research
  User Interviews | description: Quarterly NPS
    Surveys
  Competitor Analysis | collapsed: true
Development
  MVP Features
`,
  assertions: [
    { text: 'mindmap', role: 'chartType' },
    { text: 'no-descriptions', role: 'keyword' },
    { text: 'description', role: 'propertyName' },
    { text: 'collapsed', role: 'propertyName' },
  ],
};
