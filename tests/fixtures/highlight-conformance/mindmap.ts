import type { HighlightFixture } from './_types';

// Spec §18. Mindmap: chart-type, same-line node metadata, and the canonical
// bare trailing `collapsed` flag (decision #48 — the legacy `collapsed: true`
// metadata form still parses, but `collapsed` now highlights as a `modifier`
// keyword in BOTH positions). The old pipe metadata this fixture used was
// retired in 0.18.0.
export const fixture: HighlightFixture = {
  chartType: 'mindmap',
  specSection: '18',
  source: `mindmap Product Strategy

Research
  User Interviews description: Quarterly NPS
    Surveys
  Competitor Analysis collapsed
Development
  MVP Features
`,
  assertions: [
    { text: 'mindmap', role: 'chartType' },
    { text: 'description', role: 'propertyName' },
    { text: 'collapsed', role: 'modifier' },
  ],
};
