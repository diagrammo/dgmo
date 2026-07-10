// ============================================================
// Body Diagram — Diagnostic Catalog
// ============================================================
//
// Declarative metadata for every coded diagnostic the body parser emits (via
// `emit(BODY_DX.<KEY>, line, params)`). Canonical wording lives here only, so
// the catalog and parser output can't drift. Mirrors event-line/diagnostics.ts.

import type { DiagnosticSpec } from '../diagnostics';

/** Keyed specs — referenced by the parser's `emit()` call sites. */
export const BODY_DX = {
  // parser.ts: header line is not `body …`
  EXPECTED_HEADER: {
    code: 'E_BODY_EXPECTED_HEADER',
    severity: 'error',
    chartType: 'body',
    title: 'Missing header',
    message: 'Expected "body [Title]" as the first line.',
    hint: 'Start the diagram with `body` (optionally followed by a title).',
    example: `body Push Day
muscle
chest  effort: Primary`,
  },
  // parser.ts: a named part isn't in the catalog for the active figure
  UNKNOWN_PART: {
    code: 'W_BODY_UNKNOWN_PART',
    severity: 'warning',
    chartType: 'body',
    title: 'Unknown body part',
    message: (p) =>
      `Unknown body part '${p.name ?? 'quadratus'}' — not in the anatomy catalog for this figure.`,
    hint: 'Use a catalog name like chest, biceps, triceps, abs, quadriceps, or calves.',
    example: `body

xyz  effort: Primary`,
  },
  // renderer.ts: requested form/sex/view isn't shipped in this build
  UNSUPPORTED_FIGURE: {
    code: 'W_BODY_UNSUPPORTED_FIGURE',
    severity: 'warning',
    chartType: 'body',
    title: 'Figure not available',
    message: (p) =>
      `The ${p.figure ?? 'female back skin'} figure isn't available yet; rendering the male front-view muscle figure instead.`,
    hint: 'This build ships only male / front / muscle. Other forms/views are a fast-follow.',
    example: `body

female
back`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const BODY_DIAGNOSTICS: DiagnosticSpec[] = Object.values(BODY_DX);
