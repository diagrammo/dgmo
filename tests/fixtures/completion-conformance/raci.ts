// Completion-conformance fixture for the RACI chart type.
//
// Each fixture is a hand-curated transcription of what the canonical spec
// (docs/dgmo-language-spec.md §24A) says completion *should* surface for
// this chart type. The test harness diffs this against the live registry
// in dgmo/src/completion.ts. Drift in either direction fails the test:
//
//   - Items in `expected` but missing from the registry → completion gap
//     (a documented thing users can't autocomplete).
//   - Items in the registry but missing from `expected` → either the spec
//     forgot to document something, or the registry has a stale entry.
//     Add it to `expected` (with a spec-section pointer) or remove it.
//
// To allow intentionally-undocumented internal aliases, mark them in
// `allowExtras` — the test ignores those rather than failing.

import type { ConformanceFixture } from './_types';

export const fixture: ConformanceFixture = {
  chartType: 'raci',
  structuralKeywords: ['roles'],
  specSection: '24A',
  firstLineKeyword: 'raci',
  // There is now ONE `raci` chart type; the variant (RACI/RASCI/DACI) is
  // inferred from the markers used (S → RASCI, D → DACI) — there are no
  // `variant-*` directives, and `rasci`/`daci` are no longer first-line
  // keywords.
  notFirstLineKeywords: [],

  // Directives the spec documents (palette/theme are universal — included
  // automatically by the harness for every chart type).
  directives: [
    'no-legend',
    'roles',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],

  // Pipe metadata, scoped by what the line is attached to. RACI uses pipe
  // metadata in two contexts:
  //   - Role declarations inside the `roles` block (Cap | color: red)
  //   - Phase headers ([Departure] | color: teal)
  // Both accept `color` only (per spec §24A "Phase metadata" + "Roles").
  pipeKeys: {
    role: ['color'],
    phase: ['color'],
  },

  // Color values must be palette-resolvable names — the harness checks
  // these come from the shared palette enum, not chart-specific.
  enumChecks: [
    { directive: 'palette', source: 'palettes' },
    { directive: 'theme', values: ['light', 'dark', 'transparent'] },
  ],
};
