// ============================================================
// RACI variant rule sets
// ============================================================
//
// Single source of truth for what each variant's marker alphabet is
// and which structural rules apply. Adding CAIRO/PARIS later means
// adding another entry here — parser and renderer key off this map.

import { makeDgmoError } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { RaciMarker, RaciTask, RaciVariant } from './types';

/** Codes for variant-defining structural errors (always fire). */
export const RACI_ERROR_CODES = {
  MULTI_ACCOUNTABLE: 'E_RACI_MULTI_ACCOUNTABLE',
  DACI_MULTI_DRIVER: 'E_DACI_MULTI_DRIVER',
  DACI_MULTI_ACCOUNTABLE: 'E_DACI_MULTI_ACCOUNTABLE',
  INVALID_MARKER: 'E_RACI_INVALID_MARKER',
  UNEXPECTED_LINE: 'E_RACI_UNEXPECTED_LINE',
} as const;

/** Codes for warnings (suppressible by `draft` directive or per-task `# allow-incomplete`). */
export const RACI_WARNING_CODES = {
  MISSING_ACCOUNTABLE: 'W_RACI_MISSING_ACCOUNTABLE',
  MISSING_RESPONSIBLE: 'W_RACI_MISSING_RESPONSIBLE',
  DACI_MISSING_DRIVER: 'W_DACI_MISSING_DRIVER',
  DACI_MISSING_ACCOUNTABLE: 'W_DACI_MISSING_ACCOUNTABLE',
  UNKNOWN_ROLE: 'W_RACI_UNKNOWN_ROLE',
  UNKNOWN_ANNOTATION: 'W_RACI_UNKNOWN_ANNOTATION',
} as const;

/** A constraint rule produces zero or more diagnostics for a single task. */
export type ConstraintRule = (task: RaciTask) => DgmoError[];

export interface VariantRuleSet {
  alphabet: ReadonlyArray<RaciMarker>;
  /** Rules that always fire even with `draft`/`# allow-incomplete`. */
  errorRules: ConstraintRule[];
  /** Rules that are suppressible by draft mode or per-task annotation. */
  warningRules: ConstraintRule[];
}

// ── Helper: count markers across a task's role assignments ────

function countMarker(task: RaciTask, marker: RaciMarker): number {
  let count = 0;
  for (const assignment of task.roleAssignments) {
    for (const m of assignment.markers) if (m === marker) count++;
  }
  return count;
}

function findFirstAssignmentLineWithMarker(
  task: RaciTask,
  marker: RaciMarker,
  skipFirst: boolean
): number {
  let seen = 0;
  for (const assignment of task.roleAssignments) {
    if (assignment.markers.includes(marker)) {
      seen++;
      if (skipFirst && seen === 1) continue;
      return assignment.lineNumber;
    }
  }
  return task.lineNumber;
}

// ── Rules ─────────────────────────────────────────────────────

const multiAccountableRule: ConstraintRule = (task) => {
  if (countMarker(task, 'A') > 1) {
    return [
      makeDgmoError(
        findFirstAssignmentLineWithMarker(task, 'A', true),
        `Task '${task.displayName}' has more than one Accountable (A) — RACI requires exactly one.`,
        'error',
        RACI_ERROR_CODES.MULTI_ACCOUNTABLE
      ),
    ];
  }
  return [];
};

const daciMultiDriverRule: ConstraintRule = (task) => {
  if (countMarker(task, 'D') > 1) {
    return [
      makeDgmoError(
        findFirstAssignmentLineWithMarker(task, 'D', true),
        `Task '${task.displayName}' has more than one Driver (D) — DACI requires exactly one.`,
        'error',
        RACI_ERROR_CODES.DACI_MULTI_DRIVER
      ),
    ];
  }
  return [];
};

const daciMultiAccountableRule: ConstraintRule = (task) => {
  if (countMarker(task, 'A') > 1) {
    return [
      makeDgmoError(
        findFirstAssignmentLineWithMarker(task, 'A', true),
        `Task '${task.displayName}' has more than one Approver (A) — DACI requires exactly one.`,
        'error',
        RACI_ERROR_CODES.DACI_MULTI_ACCOUNTABLE
      ),
    ];
  }
  return [];
};

const missingAccountableRule: ConstraintRule = (task) => {
  if (countMarker(task, 'A') === 0) {
    return [
      makeDgmoError(
        task.lineNumber,
        `Task '${task.displayName}' has no Accountable (A) assigned.`,
        'warning',
        RACI_WARNING_CODES.MISSING_ACCOUNTABLE
      ),
    ];
  }
  return [];
};

const missingResponsibleRule: ConstraintRule = (task) => {
  if (countMarker(task, 'R') === 0) {
    return [
      makeDgmoError(
        task.lineNumber,
        `Task '${task.displayName}' has no Responsible (R) assigned.`,
        'warning',
        RACI_WARNING_CODES.MISSING_RESPONSIBLE
      ),
    ];
  }
  return [];
};

const daciMissingDriverRule: ConstraintRule = (task) => {
  if (countMarker(task, 'D') === 0) {
    return [
      makeDgmoError(
        task.lineNumber,
        `Task '${task.displayName}' has no Driver (D) assigned.`,
        'warning',
        RACI_WARNING_CODES.DACI_MISSING_DRIVER
      ),
    ];
  }
  return [];
};

const daciMissingAccountableRule: ConstraintRule = (task) => {
  if (countMarker(task, 'A') === 0) {
    return [
      makeDgmoError(
        task.lineNumber,
        `Task '${task.displayName}' has no Approver (A) assigned.`,
        'warning',
        RACI_WARNING_CODES.DACI_MISSING_ACCOUNTABLE
      ),
    ];
  }
  return [];
};

// ── Variant table ─────────────────────────────────────────────

export const VARIANTS: Readonly<Record<RaciVariant, VariantRuleSet>> = {
  raci: {
    alphabet: ['R', 'A', 'C', 'I'],
    errorRules: [multiAccountableRule],
    warningRules: [missingAccountableRule, missingResponsibleRule],
  },
  rasci: {
    alphabet: ['R', 'A', 'S', 'C', 'I'],
    errorRules: [multiAccountableRule],
    warningRules: [missingAccountableRule, missingResponsibleRule],
  },
  daci: {
    alphabet: ['D', 'A', 'C', 'I'],
    errorRules: [daciMultiDriverRule, daciMultiAccountableRule],
    warningRules: [daciMissingDriverRule, daciMissingAccountableRule],
  },
};

/** Returns true if `s` is a single character that is a marker in `variant`'s alphabet. */
export function isVariantMarker(
  s: string,
  variant: RaciVariant
): s is RaciMarker {
  return VARIANTS[variant].alphabet.includes(s as RaciMarker);
}
