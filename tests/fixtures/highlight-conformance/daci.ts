import type { HighlightFixture } from './_types';

// Spec §24A — DACI variant. Same structural shape as raci, but:
//   - first-line chart-type keyword is `daci`
//   - marker alphabet is D / A / C / I (Driver, Approver, Contributor, Informed)
export const fixture: HighlightFixture = {
  chartType: 'daci',
  specSection: '24A',
  source: `daci Launch Decision
roles
  PM  | color: red
  Eng | color: blue

[Scope] | color: teal
  Pick the launch date
    PM: D A
    Eng: C
`,
  assertions: [
    // First-line chart-type keyword
    { text: 'daci', role: 'chartType' },

    // Structural block keyword
    { text: 'roles', role: 'keyword' },

    // Pipe-metadata key in role declaration
    { text: 'color', role: 'keyword' },

    // Pipe and colon separators
    { text: '|', role: 'separator' },
    { text: ':', role: 'separator' },

    // Bracket section header
    { text: '[', role: 'bracket' },
    { text: ']', role: 'bracket' },

    // Bare role names — plain identifiers
    { text: 'PM', role: 'default' },
    { text: 'Eng', role: 'default' },

    // DACI-specific marker letter (Driver)
    { text: 'D', role: 'default' },
  ],
};
