// ============================================================
// Treemap — Diagnostic Registry
// ============================================================
//
// Declarative catalog of treemap-specific diagnostics. This is ADDITIVE
// metadata that mirrors the codes/wording emitted by `parser.ts` (see
// `TREEMAP_DIAGNOSTIC_CODES` and the value-resolution post-pass). The
// parser is the source of truth for what actually fires; this array is
// what the CLI `diagnostics` subcommand, the console error-review
// surface, MCP `validate_diagram`, and the spec docs enumerate.
//
// Message builders mirror the parser's exact wording. They tolerate being
// called with `{}` so the catalog can render a representative message
// without live params.
//
// Note: the parser also emits the UNIVERSAL code `E_TAG_DECLARED_AFTER_CONTENT`
// (declared in `METADATA_DIAGNOSTIC_CODES`); that is not a treemap-owned code
// and is intentionally excluded here.

import type { DiagnosticSpec } from '../diagnostics';

/** Keyed specs — referenced by the parser's `emit()` call sites. */
export const TREEMAP_DX = {
  NEGATIVE_VALUE: {
    code: 'E_TREEMAP_NEGATIVE_VALUE',
    severity: 'error',
    chartType: 'treemap',
    title: 'Negative leaf value',
    message: (p) =>
      `Leaf "${(p.label as string) ?? 'X'}" has a negative value (${
        (p.value as number | string) ?? -5
      }) — treemap sizes must be ≥ 0`,
    hint: 'Segment magnitude must be zero or greater — use a value of 0 or more.',
    example: 'treemap T\nA\n  Bad -5',
  },
  LEAF_NO_VALUE: {
    code: 'W_TREEMAP_LEAF_NO_VALUE',
    severity: 'warning',
    chartType: 'treemap',
    title: 'Leaf has no value',
    message: (p) =>
      `Leaf "${
        (p.label as string) ?? 'Lonely'
      }" has no value — it renders with zero size`,
    hint: 'Add a trailing number (e.g. `Lonely 40`) so the leaf gets a size.',
    example: 'treemap T\nA\n  Lonely',
  },
  LEAF_VALUE_UNPARSEABLE: {
    code: 'W_TREEMAP_LEAF_VALUE_UNPARSEABLE',
    severity: 'warning',
    chartType: 'treemap',
    title: 'Leaf value could not be read as a number',
    message: (p) => {
      const token = (p.token as string) ?? '1,24,000';
      return `Leaf "${
        (p.label as string) ?? 'Cluster'
      }" — could not read "${token}" as a number, so it renders with zero size. Remove the grouping separators: ${token.replace(
        /[,_]/g,
        ''
      )}`;
    },
    hint: 'Grouping separators must split the digits into even groups — `1,240,000` or `1_240_000`. Anything else must be written plainly, e.g. `1240000`.',
    example: 'treemap T\nA\n  Cluster 1,24,000',
  },
  BRANCH_VALUE_IGNORED: {
    code: 'W_TREEMAP_BRANCH_VALUE_IGNORED',
    severity: 'warning',
    chartType: 'treemap',
    title: 'Branch value ignored',
    message: (p) =>
      `"${
        (p.label as string) ?? 'Operations'
      }" is a branch — its trailing number is ignored; the size is the auto-sum of its children`,
    hint: "Remove the trailing number from a branch — a parent's size is the sum of its children.",
    example: 'treemap T\nOperations 999\n  Cloud 110\n  Support 70',
  },
  LAYOUT_CONFLICT: {
    code: 'E_TREEMAP_LAYOUT_CONFLICT',
    severity: 'error',
    chartType: 'treemap',
    title: 'Two treemap layouts',
    message: () =>
      '`sunburst` and `icicle` are both set — a treemap takes one layout',
    hint: 'Keep one of the two flags: `sunburst` draws rings, `icicle` draws columns.',
    example: 'treemap T\nsunburst\nicicle\n\nA\n  X 1',
  },
  RADIAL_RENAMED: {
    code: 'E_TREEMAP_RADIAL_RENAMED',
    severity: 'error',
    chartType: 'treemap',
    title: '`radial` is now `sunburst`',
    message: () =>
      '`radial` is no longer a treemap flag — it was renamed to `sunburst`',
    hint: 'Write `sunburst` to draw the treemap as concentric rings, or `icicle` to draw it as columns.',
    example: 'treemap T\nradial\n\nA\n  X 1',
  },
} satisfies Record<string, DiagnosticSpec>;

export const TREEMAP_DIAGNOSTICS: DiagnosticSpec[] = Object.values(TREEMAP_DX);
