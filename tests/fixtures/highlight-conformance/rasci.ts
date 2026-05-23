import type { HighlightFixture } from './_types';

// Spec §24A — RASCI variant. Same structural shape as raci, but:
//   - first-line chart-type keyword is `rasci`
//   - marker alphabet adds S (Support)
export const fixture: HighlightFixture = {
  chartType: 'rasci',
  specSection: '24A',
  source: `rasci Voyage Operations
roles
  Cap | color: red
  Bos | color: blue

[Departure] | color: teal
  Plot the course
    Cap: A R
    Bos: S
`,
  assertions: [
    // First-line chart-type keyword
    { text: 'rasci', role: 'chartType' },

    // Structural block keyword
    { text: 'roles', role: 'keyword' },

    // Pipe-metadata key in role declaration
    { text: 'color', role: 'keyword' },

    // Pipe and colon separators
    { text: '|', role: 'deprecatedSyntax' },
    { text: ':', role: 'separator' },

    // Bracket section header
    { text: '[', role: 'bracket' },
    { text: ']', role: 'bracket' },

    // Bare role names — plain identifiers
    { text: 'Cap', role: 'default' },
    { text: 'Bos', role: 'default' },

    // RASCI-specific marker letter (Support)
    { text: 'S', role: 'default' },
  ],
};
