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
      'Move the label after the arrow: "A -> B: uses -> to chain". ' +
      'See "In-Arrow Message Labels" → Forbidden.',
    hint: 'Put the label after the arrow with a colon: `A -> B: uses -> to chain`.',
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
