// ============================================================
// Family Diagram — Diagnostic Catalog
// ============================================================
//
// Declarative metadata for every coded diagnostic the family parser/layout
// (`src/family/{parser,layout}.ts`) can emit. Emission goes through
// `emit(FAMILY_DX.<KEY>, line, params)`; the wording lives here only, never
// re-typed at the call site (swimlane precedent). Registered in the aggregate
// REGISTRY (`diagnostics-registry.ts`) so the completeness test enforces parity.

import type { DiagnosticSpec } from '../diagnostics';

/** Keyed specs — referenced by the parser/layout `emit()` call sites. */
export const FAMILY_DX = {
  SELF_UNION: {
    code: 'E_FAMILY_SELF_UNION',
    severity: 'error',
    chartType: 'family',
    title: 'Self union',
    message: (p) => `A person cannot marry themselves ('${p.name ?? 'Anne'}')`,
    hint: 'A union line joins two DIFFERENT people — check the names on each side of `+`.',
    example: `family
Anne + Anne`,
  },
  TOO_MANY_PARENTS: {
    code: 'E_FAMILY_TOO_MANY_PARENTS',
    severity: 'error',
    chartType: 'family',
    title: 'Too many parents in a union',
    message: (p) =>
      `A union joins at most two people, found ${p.count ?? 3} ('${p.line ?? 'Anne + Bob + Carol'}')`,
    hint: 'Split into separate union lines — one couple per line. A trio like `A + B + C` is not a union.',
    example: `family
Anne + Bob + Carol`,
  },
  MISSING_OPERAND: {
    code: 'E_FAMILY_MISSING_OPERAND',
    severity: 'error',
    chartType: 'family',
    title: 'Union missing an operand',
    message: 'A union line needs a name on both sides of `+`',
    hint: 'Write `NameA + NameB`. A trailing/leading/doubled `+` with a blank side is not a valid union.',
    example: `family
Anne +`,
  },
  ANCESTRY_CYCLE: {
    code: 'E_FAMILY_ANCESTRY_CYCLE',
    severity: 'error',
    chartType: 'family',
    title: 'Ancestry cycle',
    message:
      'union creates an ancestry cycle — a person and their own ancestor cannot share a marriage row',
    hint: 'Someone is listed as their own ancestor, married to a direct ancestor, or a parent-child pair forms a union. Remove the cycle.',
    example: `family
Anne + Bob
  Carol
Carol + Anne`,
  },
  CHILD_OUTSIDE_UNION: {
    code: 'E_FAMILY_CHILD_OUTSIDE_UNION',
    severity: 'error',
    chartType: 'family',
    title: 'Child outside a union',
    message:
      'indented child line has no union or person line above it to attach to',
    hint: 'A child must be indented under a union line (`A + B`) or a single parent line.',
    example: `family
  Carol`,
  },
  UNKNOWN_KEY: {
    code: 'W_FAMILY_UNKNOWN_KEY',
    severity: 'warning',
    chartType: 'family',
    title: 'Unknown metadata key',
    message: (p) => `Unknown metadata key "${p.key ?? 'favouritecolor'}".`,
    hint: 'Recognized person keys: sex, b, d, bp, dp, occupation, military, education, religion, burial. Union key: m.',
    example: `family
Anne favouritecolor: red`,
  },
  DUPLICATE_METADATA: {
    code: 'W_FAMILY_DUPLICATE_METADATA',
    severity: 'warning',
    chartType: 'family',
    title: 'Conflicting metadata re-declaration',
    message: (p) =>
      `Metadata key '${p.key ?? 'b'}' re-declared with a different value ('${p.old ?? '1665'}' → '${p.new ?? '1666'}') — keeping the first.`,
    hint: 'A person was declared more than once with conflicting values for the same key. Consolidate the declarations.',
    example: `family
Anne b: 1665
Anne b: 1666`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const FAMILY_DIAGNOSTICS: DiagnosticSpec[] = Object.values(FAMILY_DX);
