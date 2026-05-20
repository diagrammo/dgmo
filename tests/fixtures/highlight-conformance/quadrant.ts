import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'quadrant',
  specSection: '17',
  source: `quadrant Crew
x-label Low Skill, High Skill
y-label Low Loyalty, High Loyalty

top-right Promote green
top-left Train yellow
bottom-right Watch purple
bottom-left Maroon red

Quartermaster 0.9 0.95
`,
  assertions: [
    { text: 'quadrant', role: 'chartType' },
    { text: 'x-label', role: 'keyword' },
    { text: 'y-label', role: 'keyword' },
    { text: 'top-right', role: 'keyword' },
    { text: 'top-left', role: 'keyword' },
    { text: 'bottom-right', role: 'keyword' },
    { text: 'bottom-left', role: 'keyword' },
  ],
};
