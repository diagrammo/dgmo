// ============================================================
// Arrow / Edge-Label Diagnostic Registry (TD-16)
// ============================================================
//
// Declarative `DiagnosticSpec` metadata for the SHARED in-arrow /
// edge-label diagnostics defined in `./arrows.ts`. These codes are not
// owned by any single chart type — every edge-bearing graph chart
// (sequence, flowchart, state, class, er, c4, infra, boxes-and-lines,
// …) routes labels through the same validator — so each spec sets
// `chartType: null`.
//
// This file is ADDITIVE metadata only: it re-describes the codes and
// canonical wording that already live in `arrows.ts`. It does NOT change
// parser behavior or emission. The wording below is transcribed verbatim
// from `validateLabelCharacters()` so the catalog cannot drift from what
// the parser actually emits.
//
// See `docs/dgmo-language-spec.md` → "In-Arrow Message Labels" and
// `docs/dgmo-language-spec-decisions.md` → TD-13/TD-14/TD-16.

import type { DiagnosticSpec } from '../diagnostics';
import { ARROW_DIAGNOSTIC_CODES } from './arrows';

export const ARROW_DIAGNOSTICS: DiagnosticSpec[] = [
  // --- ACTIVE (TD-13): emitted by validateLabelCharacters ---
  {
    code: ARROW_DIAGNOSTIC_CODES.ARROW_SUBSTRING_IN_LABEL, // 'E_ARROW_SUBSTRING_IN_LABEL'
    severity: 'error',
    chartType: null,
    title: 'Arrow symbol inside label',
    // Verbatim from validateLabelCharacters (arrows.ts, TD-13).
    message:
      'Arrow symbols (-> or ~>) are not allowed inside a label. ' +
      'Reword the label without them — e.g. "A -chains to-> B". ' +
      'See "In-Arrow Message Labels" → Forbidden.',
    // 🔴 This said `A -> B: uses -> to chain` until 2026-09-01 — it recommended
    // the one syntax that breaks silently. In a sequence diagram the colon form
    // is a hard error; in boxes-and-lines it parses clean and invents a node
    // literally named "B: uses to chain" (verified: nodes come back
    // `["A","B: uses to chain"]` with zero diagnostics). The label belongs
    // BETWEEN the dashes, and it can never contain an arrow, so the repair is
    // to reword it rather than move it.
    hint:
      'The label goes between the dashes — `A -chains to-> B` — and cannot ' +
      'contain an arrow at all, so reword it rather than move it. Do not use ' +
      '`A -> B: label`: outside sequence diagrams that silently creates a node ' +
      'named "B: label".',
    // End-to-end trigger via a symbolic parser (class), whose label is
    // everything after the target name, so the inner `~>` survives to the
    // validator instead of being absorbed as a second arrow token.
    example: 'class\nFoo\n  --|> Bar uses ~> chain',
  },

  // --- ACTIVE (TD-14): emitted by validateLabelCharacters ---
  {
    code: ARROW_DIAGNOSTIC_CODES.CONTROL_CHAR_IN_LABEL, // 'E_CONTROL_CHAR_IN_LABEL'
    severity: 'error',
    chartType: null,
    title: 'Control character in label',
    // Verbatim from validateLabelCharacters (arrows.ts, TD-14). The emitter
    // interpolates the offending codepoint as a 4-digit upper-hex string
    // (e.g. '0000'); tolerate `{}` for the param-less catalog view.
    message: (p) =>
      `Label contains a control character (U+${
        typeof p.hex === 'string' ? p.hex : 'XXXX'
      }). Remove it and use plain text.`,
    hint: 'Delete the control character (C0 U+0000–U+001F except tab, or U+007F); use plain text.',
    // `\u0000` is a literal NUL inside the label, which triggers
    // E_CONTROL_CHAR_IN_LABEL end-to-end on any chain-tokenizing chart.
    // (Escaped, not a raw NUL byte, to keep the source file text-safe.)
    example: 'sequence\nA -has\u0000nul-> B',
  },
];
