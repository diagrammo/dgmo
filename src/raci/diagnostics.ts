// ============================================================
// RACI / RASCI / DACI Diagnostic Catalog
// ============================================================
//
// Declarative `DiagnosticSpec` entries for every coded diagnostic the
// RACI parser can emit. This is the single source of truth for wording:
// the parser (`src/raci/parser.ts`) and rule set (`src/raci/variants.ts`)
// emit through `emit(RACI_DX.<KEY>, line, params)` so catalog consumers
// (CLI `diagnostics`, console error-review, MCP `validate_diagram`, spec
// docs) can enumerate RACI diagnostics without re-typing wording at each
// call site.
//
// Codes are also mirrored in `variants.ts` (`RACI_ERROR_CODES`,
// `RACI_WARNING_CODES`) for downstream consumers/tests that key off the
// code tables. Every message builder tolerates being called with `{}` so
// the catalog can render a representative message without live params.

import type { DiagnosticSpec } from '../diagnostics';

// ── Role and task limits (#2460) ─────────────────────────────
//
// A RACI matrix is read cell by cell, so every cell has to stay legible.
// Past either limit the parser keeps the first roles (column order) and the
// first tasks (source order), and raises one error per limit on the first
// role or task left out. Under the limits the renderer scales the grid to fit
// the canvas both ways. Not author-tunable: crowding is the renderer's
// decision (dgmo/CLAUDE.md → Output rules).
//
// How the numbers were chosen (2026-11-27, measured by rendering a full grid
// — one A, two R, the rest C/I — at 1200×800, the default canvas):
// - Roles: on export each column keeps ROLE_COL_MIN (64 px), so past 14 roles
//   the grid is drawn wider than 1200 and scaled down. The 12 px role headers
//   stay at or above MIN_READABLE_TYPE_PX (11 px) up to 16 roles (×0.94,
//   11.3 px); 17 roles is ×0.90, 10.8 px; 20 roles is 9.4 px.
// - Tasks: in a 1200×800 preview pane at 16 roles, 40 task rows fill the pane
//   with task labels at TEXT_FLOOR (9 px) and no fit scaling; 50 rows scale
//   the grid to ×0.81, 7.3 px.

/** Most role columns one RACI matrix draws. */
export const MAX_RACI_ROLES = 16;

/** Most task rows one RACI matrix draws, counted across all phases. */
export const MAX_RACI_TASKS = 40;

// Kept here, not in a module of their own, so the light chart-meta entry
// reaches no extra module (tests/light-entries-stay-light.test.ts).

/** Keyed specs — referenced by the parser's / rules' `emit()` call sites. */
export const RACI_DX = {
  // ── Errors ──────────────────────────────────────────────────

  MULTI_ACCOUNTABLE: {
    code: 'E_RACI_MULTI_ACCOUNTABLE',
    severity: 'error',
    chartType: 'raci',
    title: 'Multiple Accountable',
    // variants.ts › multiAccountableRule
    message: (p) =>
      `Task '${(p.task as string) ?? 'Task'}' has more than one Accountable — RACI requires exactly one.`,
    hint: 'Assign the A marker to exactly one role per task; make the others Responsible or Consulted.',
    example: `raci\n\nTask\n  Cap: A\n  QM: A`,
  },
  TOO_MANY_ROLES: {
    code: 'E_RACI_TOO_MANY_ROLES',
    severity: 'error',
    chartType: 'raci',
    title: 'Too many roles',
    // parser.ts › capRaci — on the first role left out
    message: (p) =>
      `This matrix has ${(p.count as number) ?? 'too many'} roles; only the first ${MAX_RACI_ROLES} (MAX_RACI_ROLES) are drawn. Split the matrix into one chart per phase or team.`,
    hint: `Keep a RACI matrix to ${MAX_RACI_ROLES} roles or fewer: split it into one chart per phase or team, or merge roles that always share markers.`,
    example: `raci\nroles Lead, Dev, QA\n\nShip it\n  Lead: A\n  Dev: R`,
  },
  TOO_MANY_TASKS: {
    code: 'E_RACI_TOO_MANY_TASKS',
    severity: 'error',
    chartType: 'raci',
    title: 'Too many tasks',
    // parser.ts › capRaci — on the first task left out
    message: (p) =>
      `This matrix has ${(p.count as number) ?? 'too many'} tasks; only the first ${MAX_RACI_TASKS} (MAX_RACI_TASKS) are drawn. Split the matrix into one chart per phase.`,
    hint: `Keep a RACI matrix to ${MAX_RACI_TASKS} tasks or fewer: split it into one chart per phase, or roll small tasks up into one.`,
    example: `raci\n\n[Plan]\nScope\n  Lead: A R\n\n[Build]\nCode\n  Lead: A\n  Dev: R`,
  },
  DACI_MULTI_DRIVER: {
    code: 'E_DACI_MULTI_DRIVER',
    severity: 'error',
    chartType: 'raci',
    title: 'Multiple Driver (DACI)',
    // variants.ts › daciMultiDriverRule
    message: (p) =>
      `Task '${(p.task as string) ?? 'Task'}' has more than one Driver — DACI requires exactly one.`,
    hint: 'A DACI decision has a single Driver; give the extra D roles another marker.',
    example: `raci\n\nDecision\n  PM: D\n  Cap: D`,
  },
  DACI_MULTI_ACCOUNTABLE: {
    code: 'E_DACI_MULTI_ACCOUNTABLE',
    severity: 'error',
    chartType: 'raci',
    title: 'Multiple Approver (DACI)',
    // variants.ts › daciMultiAccountableRule
    message: (p) =>
      `Task '${(p.task as string) ?? 'Task'}' has more than one Approver — DACI requires exactly one.`,
    hint: 'A DACI decision has a single Approver (A); reduce to one.',
    example: `raci\n\nDecision\n  Lead: D\n  PM: A\n  Cap: A`,
  },
  INVALID_MARKER: {
    code: 'E_RACI_INVALID_MARKER',
    severity: 'error',
    chartType: 'raci',
    // Two emit sites share this code: parser.ts first-pass (default form,
    // rejects letters outside the union alphabet) and parser.ts post-pass
    // (variant-aware form, passed `variant`+`alphabet`, rejects union
    // letters outside the resolved variant). The `{}` default renders the
    // first-pass wording.
    title: 'Invalid marker',
    // parser.ts first-pass tokenizer
    message: (p) =>
      p.variant !== undefined && p.variant !== null
        ? `Marker '${(p.marker as string) ?? 'X'}' is not in the ${p.variant} alphabet (${p.alphabet}).`
        : `Marker '${(p.marker as string) ?? 'X'}' is not a recognized RACI marker (R A S C I D).`,
    hint: 'Use only R, A, S, C, I (or D for DACI). Wrong-variant letters (e.g. S in a DACI chart) trigger the variant-alphabet form of this diagnostic.',
    example: `raci\n\nTask\n  Cap: X`,
  },
  UNEXPECTED_LINE: {
    code: 'E_RACI_UNEXPECTED_LINE',
    severity: 'error',
    chartType: 'raci',
    title: 'Unexpected line under task',
    // parser.ts — free-text after first role assignment
    message: (p) =>
      `Unexpected line after role assignments under task '${(p.task as string) ?? 'Task'}'. Lines under a task must be either a description (before the first 'Role: markers' line) or another role assignment.`,
    hint: 'Put all description text before the first role assignment; nothing but assignments may follow.',
    example: `raci\n\nTask\n  Cap: A\n  This is an unexpected description.`,
  },
  MIXED_VARIANTS: {
    code: 'E_RACI_MIXED_VARIANTS',
    severity: 'error',
    chartType: 'raci',
    title: 'Mixed RASCI/DACI markers',
    // parser.ts — variant resolution, inferVariant() returned null
    message:
      "Chart uses both 'D' and 'S' markers but neither RASCI nor DACI covers both. Use only RACI/RASCI markers (R, A, S, C, I) or only DACI markers (D, A, C, I).",
    hint: 'Pick one convention: R/A/S/C/I (RACI/RASCI) or D/A/C/I (DACI). Do not mix D and S in one chart.',
    example: `raci\n\nTask\n  Cap: D\n  Crew: S`,
  },

  // ── Warnings ────────────────────────────────────────────────

  MISSING_ACCOUNTABLE: {
    code: 'W_RACI_MISSING_ACCOUNTABLE',
    severity: 'warning',
    chartType: 'raci',
    title: 'Missing Accountable',
    // variants.ts › missingAccountableRule
    message: (p) =>
      `Task '${(p.task as string) ?? 'Task'}' has no Accountable assigned.`,
    hint: 'Every RACI task should have exactly one Accountable (A).',
    example: `raci\n\nTask\n  Cap: R`,
  },
  MISSING_RESPONSIBLE: {
    code: 'W_RACI_MISSING_RESPONSIBLE',
    severity: 'warning',
    chartType: 'raci',
    title: 'Missing Responsible',
    // variants.ts › missingResponsibleRule
    message: (p) =>
      `Task '${(p.task as string) ?? 'Task'}' has no Responsible assigned.`,
    hint: 'Assign at least one Responsible (R) — someone has to do the work.',
    example: `raci\n\nTask\n  Cap: A`,
  },
  DACI_MISSING_DRIVER: {
    code: 'W_DACI_MISSING_DRIVER',
    severity: 'warning',
    chartType: 'raci',
    title: 'Missing Driver (DACI)',
    // variants.ts › daciMissingDriverRule
    message: (p) =>
      `Task '${(p.task as string) ?? 'Task'}' has no Driver assigned.`,
    hint: 'A DACI decision needs a Driver (D) to move it forward.',
    example: `raci\n\nPick Vendor\n  Lead: D\n  PM: A\nSign Off\n  Cap: C`,
  },
  DACI_MISSING_ACCOUNTABLE: {
    code: 'W_DACI_MISSING_ACCOUNTABLE',
    severity: 'warning',
    chartType: 'raci',
    title: 'Missing Approver (DACI)',
    // variants.ts › daciMissingAccountableRule
    message: (p) =>
      `Task '${(p.task as string) ?? 'Task'}' has no Approver assigned.`,
    hint: 'A DACI decision needs an Approver (A) to sign off.',
    example: `raci\n\nPick Vendor\n  Lead: D\n  PM: A\nSign Off\n  Cap: C`,
  },
  UNKNOWN_ROLE: {
    code: 'W_RACI_UNKNOWN_ROLE',
    severity: 'warning',
    chartType: 'raci',
    title: 'Undeclared role',
    // parser.ts — only when `roles:` is declared. Live message appends a
    // ` Did you mean 'X'?` suggestion when a near match exists.
    message: (p) => {
      const role = (p.role as string) ?? 'Role';
      const hint = (p.hint as string) ?? '';
      return `Role '${role}' is not declared in the 'roles:' directive.${hint ? ' ' + hint : ''}`;
    },
    hint: 'Add the role to the `roles` directive, or fix the typo to match a declared role.',
    example: `raci\nroles Cap, QM\n\nTask\n  Cap: A\n  Stranger: R`,
  },
  EMPTY_TASK: {
    code: 'W_RACI_EMPTY_TASK',
    severity: 'warning',
    chartType: 'raci',
    title: 'Empty task',
    // variants.ts › emptyTaskRule
    message: (p) =>
      `Task '${(p.task as string) ?? 'Task'}' has no role assignments.`,
    hint: 'Add at least one `Role: markers` line, or remove the empty task.',
    example: `raci\n\nTask\n  Just a description with no assignments`,
  },
  CONFLICTING_MARKERS: {
    code: 'W_RACI_CONFLICTING_MARKERS',
    severity: 'warning',
    chartType: 'raci',
    title: 'Conflicting markers',
    // variants.ts › conflictingMarkersRule
    message: (p) => {
      const role = (p.role as string) ?? 'Role';
      const task = (p.task as string) ?? 'Task';
      const markers = (p.markers as string) ?? 'A C';
      return `Role '${role}' on task '${task}' has conflicting markers (${markers}). A role can be either active (R/A/D) or passive (C/I), not both.`;
    },
    hint: 'Give the role either an active marker (R/A/D) or a passive one (C/I), not both.',
    example: `raci\n\nTask\n  Cap: A C`,
  },
  TOO_MANY_RESPONSIBLE: {
    code: 'W_RACI_TOO_MANY_RESPONSIBLE',
    severity: 'warning',
    chartType: 'raci',
    title: 'Too many Responsible',
    // variants.ts › tooManyResponsibleRule (threshold = 3)
    message: (p) => {
      const task = (p.task as string) ?? 'Task';
      const count = (p.count as number) ?? 4;
      const threshold = (p.threshold as number) ?? 3;
      return `Task '${task}' has ${count} Responsibles — more than ${threshold} dilutes ownership. Consider splitting the task or marking some as Consulted.`;
    },
    hint: 'Keep Responsibles at or below 3 — split the task or downgrade some roles to Consulted.',
    example: `raci\n\nTask\n  W: R\n  X: R\n  Y: R\n  Z: R\n  Lead: A`,
  },
  ORPHAN_ROLE: {
    code: 'W_RACI_ORPHAN_ROLE',
    severity: 'warning',
    chartType: 'raci',
    title: 'Orphan role',
    // parser.ts — role declared/seen but never assigned any marker
    message: (p) =>
      `Role '${(p.role as string) ?? 'Role'}' is declared but never assigned to any task.`,
    hint: 'Assign the role a marker somewhere, or remove it from the `roles` directive.',
    example: `raci\nroles Cap, Ghost\n\nTask\n  Cap: A R`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const RACI_DIAGNOSTICS: DiagnosticSpec[] = Object.values(RACI_DX);
