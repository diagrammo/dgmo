// ============================================================
// Sketch diagram — Diagnostic codes (spec §31.8)
// ============================================================

import type { DiagnosticSpec } from '../diagnostics';

export const SKETCH_DIAGNOSTIC_CODES = {
  BOX_DEPTH: 'E_SKETCH_BOX_DEPTH',
  AMBIGUOUS_TARGET: 'E_SKETCH_AMBIGUOUS_TARGET',
  UNKNOWN_SHAPE: 'W_SKETCH_UNKNOWN_SHAPE',
  OVERLAP_RESOLVED: 'W_SKETCH_OVERLAP_RESOLVED',
  AT_OUT_OF_RANGE: 'W_SKETCH_AT_OUT_OF_RANGE',
} as const;

export const SKETCH_DIAGNOSTICS: DiagnosticSpec[] = [
  {
    code: SKETCH_DIAGNOSTIC_CODES.BOX_DEPTH,
    severity: 'error',
    chartType: 'sketch',
    title: 'Box nested too deep',
    message: (p) =>
      `Box "${String(p.label ?? '?')}" is nested ${String(p.depth ?? '?')} levels deep — sketch boxes nest to depth ${String(p.max ?? '?')} (decision #58); its shapes join the box above it`,
    hint: 'Move the inner [Box] up a level — two levels of bracket is the bound.',
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
  {
    code: SKETCH_DIAGNOSTIC_CODES.AT_OUT_OF_RANGE,
    severity: 'warning',
    chartType: 'sketch',
    title: 'at: coordinate out of range',
    message: (p) =>
      `at: coordinate "${String(p.raw ?? '?')}" is out of range — half-slot coords must be whole numbers within ±${String(p.max ?? '?')}; shape will flow-place`,
    hint: 'Use small integer half-slot coordinates near the origin, or omit at: to flow-place.',
    example: 'sketch\nA at: 2 0',
  },
];
