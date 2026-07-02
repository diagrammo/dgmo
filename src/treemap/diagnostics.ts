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
    hint: 'Treemap cell areas encode magnitude — use a value of 0 or greater.',
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
      }" has no value — it renders with zero area`,
    hint: 'Add a trailing number (e.g. `Lonely 40`) so the leaf gets an area.',
    example: 'treemap T\nA\n  Lonely',
  },
  BRANCH_VALUE_IGNORED: {
    code: 'W_TREEMAP_BRANCH_VALUE_IGNORED',
    severity: 'warning',
    chartType: 'treemap',
    title: 'Branch value ignored',
    message: (p) =>
      `"${
        (p.label as string) ?? 'Operations'
      }" is a branch — its trailing number is ignored; the area is the auto-sum of its children`,
    hint: "Remove the trailing number from a branch — a parent's area is the sum of its children.",
    example: 'treemap T\nOperations 999\n  Cloud 110\n  Support 70',
  },
} satisfies Record<string, DiagnosticSpec>;

export const TREEMAP_DIAGNOSTICS: DiagnosticSpec[] = Object.values(TREEMAP_DX);
