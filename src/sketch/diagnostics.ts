// ============================================================
// Sketch diagram — Diagnostic codes (spec §31.8)
// ============================================================

import type { DiagnosticSpec } from '../diagnostics';

export const SKETCH_DIAGNOSTIC_CODES = {
  NESTED_BOX: 'E_SKETCH_NESTED_BOX',
  AMBIGUOUS_TARGET: 'E_SKETCH_AMBIGUOUS_TARGET',
  UNKNOWN_SHAPE: 'W_SKETCH_UNKNOWN_SHAPE',
  OVERLAP_RESOLVED: 'W_SKETCH_OVERLAP_RESOLVED',
} as const;

export const SKETCH_DIAGNOSTICS: DiagnosticSpec[] = [
  {
    code: SKETCH_DIAGNOSTIC_CODES.NESTED_BOX,
    severity: 'error',
    chartType: 'sketch',
    title: 'Nested box',
    message: (p) =>
      `Box "${String(p.label ?? '?')}" is nested inside another box — sketch boxes are one level only; its shapes join the outer box`,
    hint: 'Move the inner [Box] to the top level.',
    example: 'sketch\n[Outer]\n  [Inner]\n    Shape',
  },
  {
    code: SKETCH_DIAGNOSTIC_CODES.AMBIGUOUS_TARGET,
    severity: 'error',
    chartType: 'sketch',
    title: 'Ambiguous edge target',
    message: (p) =>
      `Edge target "${String(p.target ?? '?')}" matches more than one shape — give each duplicate an alias (as x) and target the alias`,
    hint: 'Alias duplicate-label shapes and reference the alias.',
    example: 'sketch\nCache as c1\nCache as c2\nApp\n  -> c1',
  },
  {
    code: SKETCH_DIAGNOSTIC_CODES.UNKNOWN_SHAPE,
    severity: 'warning',
    chartType: 'sketch',
    title: 'Unknown shape',
    message: (p) =>
      `Unknown shape "${String(p.shape ?? '?')}" — rendered as a rectangle (valid: database, queue, person, document, note)`,
    hint: 'Use one of the closed shape kinds, or drop shape: for a rectangle.',
    example: 'sketch\nStore shape: database',
  },
  {
    code: SKETCH_DIAGNOSTIC_CODES.OVERLAP_RESOLVED,
    severity: 'warning',
    chartType: 'sketch',
    title: 'Overlapping shapes auto-resolved',
    message: (p) =>
      `Shape "${String(p.label ?? '?')}" overlapped another at its authored position — moved to the nearest free slot`,
    hint: 'Keep shapes at least 2 half-slots apart on one axis, or omit at: to flow-place.',
    example: 'sketch\nA at: 0 0\nB at: 0 0',
  },
];
