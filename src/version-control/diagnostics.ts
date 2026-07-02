// ============================================================
// Version-Control (git graph) — Diagnostic Registry
// ============================================================
//
// Declarative catalog of version-control-specific diagnostics. This is
// the single source of truth for the codes/wording the parser emits via
// `emit(VERSION_CONTROL_DX.<KEY>, line, params)`. Consumers (the CLI
// `diagnostics` subcommand, the console error-review surface, MCP
// `validate_diagram`, and the spec docs) enumerate this catalog; the
// parser never re-types wording at the call site.
//
// Message builders mirror the parser's exact wording. They tolerate being
// called with `{}` so the catalog can render a representative message
// without live params.
//
// Notes on fidelity:
// - `E_VERSION_CONTROL_UNKNOWN_BRANCH` is emitted from THREE sites with
//   slightly different wording — `merge references … (§29.4)`,
//   `rebase references … (§29.8)`, and `reset references … (§29.8)`. The
//   builder below parameterizes the verb (`op`), branch, and section so it
//   reproduces any of the three exactly; the representative `{}` form uses
//   the `merge` wording.

import type { DiagnosticSpec } from '../diagnostics';

/** Keyed specs — referenced by the parser's `emit()` call sites. */
export const VERSION_CONTROL_DX = {
  NO_COMMITS: {
    code: 'E_VERSION_CONTROL_NO_COMMITS',
    severity: 'error',
    chartType: 'version-control',
    title: 'No commits',
    message: 'version-control has no commits.',
    hint: 'Add at least one indented commit line under a branch.',
    example: 'version-control Empty',
  },
  UNKNOWN_BRANCH: {
    code: 'E_VERSION_CONTROL_UNKNOWN_BRANCH',
    severity: 'warning',
    chartType: 'version-control',
    title: 'Unknown branch reference',
    message: (p) => {
      const op = (p.op as string) ?? 'merge';
      const branch = (p.branch as string) ?? 'ghostbranch';
      const section = (p.section as string) ?? '§29.4';
      return `${op} references unknown branch "${branch}". (${section})`;
    },
    hint: 'Declare the branch (a bare top-level line) before referencing it in merge/rebase/reset.',
    example: 'version-control U\n\nmain\n  A\n  merge ghostbranch',
  },
  AMBIGUOUS_REF: {
    code: 'E_VERSION_CONTROL_AMBIGUOUS_REF',
    severity: 'warning',
    chartType: 'version-control',
    title: 'Ambiguous commit reference',
    message: (p) => {
      const ref = (p.ref as string) ?? 'Fix';
      const count = (p.count as number | string) ?? 2;
      return `Commit reference "${ref}" matches ${count} commits — use an explicit id:. (§29.10)`;
    },
    hint: 'Give the target commit an `id:` and reference that id, or make the message unique.',
    example: 'version-control A\n\nmain\n  Fix\n  Fix\n  cherry-pick Fix',
  },
} satisfies Record<string, DiagnosticSpec>;

export const VERSION_CONTROL_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(VERSION_CONTROL_DX);
