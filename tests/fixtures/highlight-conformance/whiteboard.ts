import type { HighlightFixture } from './_types';

// Whiteboard: chart-type declaration, element leaders with same-line
// `key: value` metadata, a free arrow, and a positional ink line.
export const fixture: HighlightFixture = {
  chartType: 'whiteboard',
  specSection: '39',
  source: `whiteboard Login ideas
rectangle Sign in at: 60 60, size: 180 70
ellipse OAuth? at: 345 53, size: 170 84, color: blue
arrow from: 240 95, to: 340 95
image login-ideas.assets/9f3c2a71.webp at: 420 200, size: 250 170
ink red 3 AZwE2AQYJDAWaqMBHQ
`,
  assertions: [
    { text: 'whiteboard', role: 'chartType' },
    { text: 'rectangle', role: 'controlKeyword' },
    { text: 'ellipse', role: 'controlKeyword' },
    { text: 'arrow', role: 'controlKeyword' },
    { text: 'image', role: 'controlKeyword' },
    { text: 'ink', role: 'controlKeyword' },
    { text: 'at', role: 'propertyName' },
  ],
};
