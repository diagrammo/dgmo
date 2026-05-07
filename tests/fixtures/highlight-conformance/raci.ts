import type { HighlightFixture } from './_types';

// Spec §24A. Exercises:
//   - chart-type keyword on line 1
//   - bare directive keyword (variant-rasci)
//   - structural-block keyword (roles)
//   - pipe-metadata key (color)
//   - bracket section header ([Departure])
//   - operator separators (| and :)
//   - bare identifiers and assignments
export const fixture: HighlightFixture = {
  chartType: 'raci',
  specSection: '24A',
  source: `raci Voyage Operations
variant-rasci
roles
  Cap | color: red
  Bos | color: blue

[Departure] | color: teal
  Plot the course
    Cap: A R
    Bos: C
`,
  assertions: [
    // First-line chart-type keyword
    { text: 'raci', role: 'chartType' },

    // Bare directive (locks variant)
    { text: 'variant-rasci', role: 'keyword' },

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
    { text: 'Cap', role: 'default' },
    { text: 'Bos', role: 'default' },

    // Marker letters in role assignments — also identifiers
    { text: 'A', role: 'default' },
    { text: 'R', role: 'default' },
  ],
};
