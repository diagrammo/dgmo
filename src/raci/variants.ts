// ============================================================
// RACI variant rule sets
// ============================================================
//
// Single source of truth for what each variant's marker alphabet is
// and which structural rules apply. Adding CAIRO/PARIS later means
// adding another entry here — parser and renderer key off this map.

import { emit } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { RACI_DX } from './diagnostics';
import type { RaciMarker, RaciTask, RaciVariant } from './types';

/** Codes for variant-defining structural errors (always fire). */
export const RACI_ERROR_CODES = {
  MULTI_ACCOUNTABLE: 'E_RACI_MULTI_ACCOUNTABLE',
  DACI_MULTI_DRIVER: 'E_DACI_MULTI_DRIVER',
  DACI_MULTI_ACCOUNTABLE: 'E_DACI_MULTI_ACCOUNTABLE',
  INVALID_MARKER: 'E_RACI_INVALID_MARKER',
  UNEXPECTED_LINE: 'E_RACI_UNEXPECTED_LINE',
  MIXED_VARIANTS: 'E_RACI_MIXED_VARIANTS',
  DUPLICATE_VARIANT: 'E_RACI_DUPLICATE_VARIANT',
} as const;

/** Union of every variant's marker alphabet — used for tolerant tokenization. */
export const ALL_MARKERS: ReadonlySet<RaciMarker> = new Set([
  'R',
  'A',
  'S',
  'C',
  'I',
  'D',
]);

/**
 * Resolve the chart's variant from the markers actually used. `D`
 * present → DACI; `S` present → RASCI; otherwise RACI. Returns null
 * when both `D` and `S` appear in the same chart (caller should
 * surface `E_RACI_MIXED_VARIANTS`).
 */
export function inferVariant(
  markers: Iterable<RaciMarker>
): RaciVariant | null {
  let hasD = false;
  let hasS = false;
  for (const m of markers) {
    if (m === 'D') hasD = true;
    else if (m === 'S') hasS = true;
  }
  if (hasD && hasS) return null;
  if (hasD) return 'daci';
  if (hasS) return 'rasci';
  return 'raci';
}

/** Codes for warnings (suppressible chart-wide by the `no-rule-enforcement` directive). */
export const RACI_WARNING_CODES = {
  MISSING_ACCOUNTABLE: 'W_RACI_MISSING_ACCOUNTABLE',
  MISSING_RESPONSIBLE: 'W_RACI_MISSING_RESPONSIBLE',
  DACI_MISSING_DRIVER: 'W_DACI_MISSING_DRIVER',
  DACI_MISSING_ACCOUNTABLE: 'W_DACI_MISSING_ACCOUNTABLE',
  UNKNOWN_ROLE: 'W_RACI_UNKNOWN_ROLE',
  EMPTY_TASK: 'W_RACI_EMPTY_TASK',
  CONFLICTING_MARKERS: 'W_RACI_CONFLICTING_MARKERS',
  TOO_MANY_RESPONSIBLE: 'W_RACI_TOO_MANY_RESPONSIBLE',
  ORPHAN_ROLE: 'W_RACI_ORPHAN_ROLE',
} as const;

/**
 * Threshold for "too many Responsibles" diagnostic. Three is the most
 * commonly cited rule of thumb — beyond that, ownership starts to feel
 * diluted ("if everyone is R, no one is").
 */
export const TOO_MANY_RESPONSIBLE_THRESHOLD = 3;

/** A constraint rule produces zero or more diagnostics for a single task. */
export type ConstraintRule = (task: RaciTask) => DgmoError[];

export interface VariantRuleSet {
  alphabet: ReadonlyArray<RaciMarker>;
  /**
   * Structural errors. Fire whenever `no-rule-enforcement` is off, like
   * the warning rules — kept as a separate bucket so callers (e.g. the
   * editor diagnostics panel) can style them with error severity.
   */
  errorRules: ConstraintRule[];
  /** Hygiene warnings — same suppression as errors. */
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

function totalMarkerCount(task: RaciTask): number {
  let n = 0;
  for (const a of task.roleAssignments) n += a.markers.length;
  return n;
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
      emit(
        RACI_DX.MULTI_ACCOUNTABLE,
        findFirstAssignmentLineWithMarker(task, 'A', true),
        {
          task: task.displayName,
        }
      ),
    ];
  }
  return [];
};

const daciMultiDriverRule: ConstraintRule = (task) => {
  if (countMarker(task, 'D') > 1) {
    return [
      emit(
        RACI_DX.DACI_MULTI_DRIVER,
        findFirstAssignmentLineWithMarker(task, 'D', true),
        {
          task: task.displayName,
        }
      ),
    ];
  }
  return [];
};

const daciMultiAccountableRule: ConstraintRule = (task) => {
  if (countMarker(task, 'A') > 1) {
    return [
      emit(
        RACI_DX.DACI_MULTI_ACCOUNTABLE,
        findFirstAssignmentLineWithMarker(task, 'A', true),
        {
          task: task.displayName,
        }
      ),
    ];
  }
  return [];
};

/**
 * Single warning for tasks that have zero markers anywhere — replaces
 * the duplicate missing-A and missing-R warnings that would otherwise
 * fire for the same line.
 */
const emptyTaskRule: ConstraintRule = (task) => {
  if (totalMarkerCount(task) === 0) {
    return [
      emit(RACI_DX.EMPTY_TASK, task.lineNumber, { task: task.displayName }),
    ];
  }
  return [];
};

const missingAccountableRule: ConstraintRule = (task) => {
  if (totalMarkerCount(task) === 0) return []; // emptyTaskRule covers it
  if (countMarker(task, 'A') === 0) {
    return [
      emit(RACI_DX.MISSING_ACCOUNTABLE, task.lineNumber, {
        task: task.displayName,
      }),
    ];
  }
  return [];
};

const missingResponsibleRule: ConstraintRule = (task) => {
  if (totalMarkerCount(task) === 0) return []; // emptyTaskRule covers it
  if (countMarker(task, 'R') === 0) {
    return [
      emit(RACI_DX.MISSING_RESPONSIBLE, task.lineNumber, {
        task: task.displayName,
      }),
    ];
  }
  return [];
};

const daciMissingDriverRule: ConstraintRule = (task) => {
  if (totalMarkerCount(task) === 0) return []; // emptyTaskRule covers it
  if (countMarker(task, 'D') === 0) {
    return [
      emit(RACI_DX.DACI_MISSING_DRIVER, task.lineNumber, {
        task: task.displayName,
      }),
    ];
  }
  return [];
};

const daciMissingAccountableRule: ConstraintRule = (task) => {
  if (totalMarkerCount(task) === 0) return []; // emptyTaskRule covers it
  if (countMarker(task, 'A') === 0) {
    return [
      emit(RACI_DX.DACI_MISSING_ACCOUNTABLE, task.lineNumber, {
        task: task.displayName,
      }),
    ];
  }
  return [];
};

/**
 * Flag a single role assigned both an "active" marker (R/A/D — actually
 * doing or owning the work) and a "passive" marker (C/I — only consulted
 * or informed). The combo is internally inconsistent: you're either part
 * of the action or you're a stakeholder, not both.
 *
 * Note: A+R / D+A on the same role is *not* flagged — every major guide
 * (Atlassian, PMI, Smartsheet) explicitly allows the same person being
 * both Accountable and Responsible (or Driver and Approver).
 */
const ACTIVE_MARKERS: ReadonlySet<RaciMarker> = new Set(['R', 'A', 'D']);
const PASSIVE_MARKERS: ReadonlySet<RaciMarker> = new Set(['C', 'I']);

const conflictingMarkersRule: ConstraintRule = (task) => {
  const out: DgmoError[] = [];
  for (const a of task.roleAssignments) {
    let hasActive = false;
    let hasPassive = false;
    for (const m of a.markers) {
      if (ACTIVE_MARKERS.has(m)) hasActive = true;
      if (PASSIVE_MARKERS.has(m)) hasPassive = true;
    }
    if (hasActive && hasPassive) {
      out.push(
        emit(RACI_DX.CONFLICTING_MARKERS, a.lineNumber, {
          role: a.displayName,
          task: task.displayName,
          markers: a.markers.join(' '),
        })
      );
    }
  }
  return out;
};

/**
 * "If everyone is R, no one is R" — beyond ~3 Responsibles per task,
 * ownership feels diluted. Threshold matches the most common rule of
 * thumb across PM literature.
 */
const tooManyResponsibleRule: ConstraintRule = (task) => {
  const n = countMarker(task, 'R');
  if (n > TOO_MANY_RESPONSIBLE_THRESHOLD) {
    return [
      emit(RACI_DX.TOO_MANY_RESPONSIBLE, task.lineNumber, {
        task: task.displayName,
        count: n,
        threshold: TOO_MANY_RESPONSIBLE_THRESHOLD,
      }),
    ];
  }
  return [];
};

// ── Variant table ─────────────────────────────────────────────

export const VARIANTS: Readonly<Record<RaciVariant, VariantRuleSet>> = {
  raci: {
    alphabet: ['R', 'A', 'C', 'I'],
    errorRules: [multiAccountableRule],
    warningRules: [
      emptyTaskRule,
      missingAccountableRule,
      missingResponsibleRule,
      conflictingMarkersRule,
      tooManyResponsibleRule,
    ],
  },
  rasci: {
    alphabet: ['R', 'A', 'S', 'C', 'I'],
    errorRules: [multiAccountableRule],
    warningRules: [
      emptyTaskRule,
      missingAccountableRule,
      missingResponsibleRule,
      conflictingMarkersRule,
      tooManyResponsibleRule,
    ],
  },
  daci: {
    alphabet: ['D', 'A', 'C', 'I'],
    errorRules: [daciMultiDriverRule, daciMultiAccountableRule],
    warningRules: [
      emptyTaskRule,
      daciMissingDriverRule,
      daciMissingAccountableRule,
      conflictingMarkersRule,
    ],
  },
};
