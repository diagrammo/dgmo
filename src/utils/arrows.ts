// ============================================================
// Shared Arrow Parsing Utility
// ============================================================
//
// Labeled arrow syntax (always left-to-right):
//   Sync:  `-label->`
//   Async: `~label~>`
//
// In-arrow label character-set contract (see docs/dgmo-language-spec.md
// §"In-Arrow Message Labels"):
//   - Allowed: any codepoint except the forbidden substrings and forbidden
//     control characters below.
//   - Forbidden substrings: "->", "~>" (arrow-token lookalikes inside labels).
//     Use the post-colon form for labels that need these symbols:
//       `A -> B: uses -> to chain`
//   - Forbidden characters: C0 control chars U+0000–U+001F EXCEPT U+0009 (tab),
//     and U+007F (DEL).
//   - Whitespace: leading/trailing trimmed; internal runs (incl. tab, NBSP,
//     ZWSP) preserved — never collapsed.
//   - Plain text only: no markdown interpretation. `*`, `_`, backticks,
//     `[`, `]`, `{`, `}` are literal characters.

import type { DgmoError } from '../diagnostics';
import { makeDgmoError } from '../diagnostics';

interface ParsedArrow {
  from: string;
  to: string;
  label: string;
  async: boolean;
}

// ============================================================
// Diagnostic codes (TD-16)
// ============================================================

/**
 * Stable diagnostic codes for in-arrow label parsing errors.
 *
 * **Active codes** — emitted by the parser pipeline today:
 *   - `ARROW_SUBSTRING_IN_LABEL` (TD-13)
 *   - `CONTROL_CHAR_IN_LABEL` (TD-14)
 *
 * **Reserved codes** — declared but NOT currently emitted. These are
 * placeholders for future tightening of the arrow-tokenization rules
 * described in TD-9. Today's chart parsers catch these cases through
 * their own regex machinery with different diagnostics. A follow-up
 * spec that introduces a dedicated tokenizer can start emitting them
 * without changing the public code shape:
 *   - `TRAILING_ARROW_TEXT` — extra `->`/`~>` after the primary arrow
 *   - `MIXED_ARROW_DELIMITERS` — opening delim type doesn't match arrow
 *
 * See `docs/dgmo-language-spec-decisions.md` → TD-16 for the rationale.
 */
export const ARROW_DIAGNOSTIC_CODES = {
  /** Active: label contains `->` or `~>` substring (TD-13). */
  ARROW_SUBSTRING_IN_LABEL: 'E_ARROW_SUBSTRING_IN_LABEL',
  /** Active: label contains a forbidden control character (TD-14). */
  CONTROL_CHAR_IN_LABEL: 'E_CONTROL_CHAR_IN_LABEL',
  /** Reserved: not currently emitted by any parser. See JSDoc above. */
  TRAILING_ARROW_TEXT: 'E_TRAILING_ARROW_TEXT',
  /** Reserved: not currently emitted by any parser. See JSDoc above. */
  MIXED_ARROW_DELIMITERS: 'E_MIXED_ARROW_DELIMITERS',
} as const;

// ============================================================
// validateLabelCharacters (TD-13, TD-14)
// ============================================================

/**
 * Validate an in-arrow label against the TD-13 and TD-14 character-set
 * contract. Returns diagnostics (possibly empty). Does NOT mutate the label —
 * callers that want a normalized label should trim before calling.
 *
 * TD-13: label must not contain the substrings "->" or "~>".
 * TD-14: label must not contain C0 control chars other than tab, and no DEL.
 */
export function validateLabelCharacters(
  label: string,
  lineNumber: number
): DgmoError[] {
  const out: DgmoError[] = [];

  // TD-13: forbidden substrings
  if (label.includes('->') || label.includes('~>')) {
    out.push(
      makeDgmoError(
        lineNumber,
        'Arrow symbols (-> or ~>) are not allowed inside a label. ' +
          'Move the label after the arrow: "A -> B: uses -> to chain". ' +
          'See "In-Arrow Message Labels" → Forbidden.',
        'error',
        ARROW_DIAGNOSTIC_CODES.ARROW_SUBSTRING_IN_LABEL
      )
    );
  }

  // TD-14: control chars (iterate codepoints to handle surrogate pairs)
  for (const ch of label) {
    const cp = ch.codePointAt(0)!;
    const isC0 = cp >= 0x00 && cp <= 0x1f && cp !== 0x09; // allow tab
    const isDel = cp === 0x7f;
    if (isC0 || isDel) {
      const hex = cp.toString(16).toUpperCase().padStart(4, '0');
      out.push(
        makeDgmoError(
          lineNumber,
          `Label contains a control character (U+${hex}). ` +
            'Remove it and use plain text.',
          'error',
          ARROW_DIAGNOSTIC_CODES.CONTROL_CHAR_IN_LABEL
        )
      );
      break; // one diagnostic per label is enough
    }
  }

  return out;
}

// ============================================================
// parseInArrowLabel (TD-1, TD-8, TD-10, TD-13, TD-14)
// ============================================================

export interface ParseInArrowLabelResult {
  /** Cleaned label (trimmed; `undefined` if empty after trim per TD-10). */
  label: string | undefined;
  diagnostics: DgmoError[];
}

/**
 * Normalize and validate a raw in-arrow label.
 *
 * Behavior:
 *   - Trims leading/trailing whitespace (TD-8: internal whitespace preserved).
 *   - Empty-after-trim → `{ label: undefined }` (TD-10 normalization).
 *   - TD-13: emits `E_ARROW_SUBSTRING_IN_LABEL` if `->` or `~>` is present.
 *   - TD-14: emits `E_CONTROL_CHAR_IN_LABEL` for forbidden control chars.
 *
 * This helper is intentionally chart-agnostic: it operates on an already
 * extracted label string, leaving each chart's existing arrow-finding
 * tokenization in place. Edges no longer have a color slot on any chart
 * type (see spec §1.7 "Edge color is not a feature"); arrow content is
 * pure label text.
 */
export function parseInArrowLabel(
  rawLabel: string,
  lineNumber: number
): ParseInArrowLabelResult {
  const trimmed = rawLabel.trim();

  // TD-10: empty/whitespace-only label normalizes to undefined
  if (trimmed.length === 0) {
    return { label: undefined, diagnostics: [] };
  }

  // TD-13 / TD-14 validation
  const diagnostics = validateLabelCharacters(trimmed, lineNumber);

  return { label: trimmed, diagnostics };
}

// Forward (call) patterns — participant names may contain spaces, so use non-greedy (.+?)
const SYNC_LABELED_RE = /^(.+?)\s*-(.+)->\s*(.+)$/;
const ASYNC_LABELED_RE = /^(.+?)\s*~(.+)~>\s*(.+)$/;

// Deprecated patterns — produce errors
const RETURN_SYNC_LABELED_RE = /^(.+?)\s*<-(.+)-\s*(.+)$/;
const RETURN_ASYNC_LABELED_RE = /^(.+?)\s*<~(.+)~\s*(.+)$/;
const BIDI_SYNC_RE = /^(.+?)\s*<-(.+)->\s*(.+)$/;
const BIDI_ASYNC_RE = /^(.+?)\s*<~(.+)~>\s*(.+)$/;

/**
 * Try to parse a labeled arrow from a trimmed line.
 *
 * Returns:
 *  - `ParsedArrow` if matched and valid
 *  - `{ error: string }` if matched but invalid (deprecated syntax)
 *  - `null` if not a labeled arrow (caller should fall through to bare patterns)
 *
 * Note: arrow-char-in-label validation (TD-13) is NOT performed here —
 * callers must route the returned `label` through `parseInArrowLabel` or
 * `validateLabelCharacters` to get the unified `E_ARROW_SUBSTRING_IN_LABEL`
 * diagnostic with the correct code. In practice this path is unreachable
 * because arrow regexes are greedy enough to absorb inner `->`/`~>` tokens
 * into the source/destination captures, but the check remains at the
 * validator level for defense in depth.
 */
export function parseArrow(
  line: string
): ParsedArrow | { error: string } | null {
  // Check bidi patterns first — return error
  if (BIDI_SYNC_RE.test(line) || BIDI_ASYNC_RE.test(line)) {
    return {
      error:
        "Bidirectional arrows are no longer supported. Use two separate lines: 'A -msg-> B' and 'B -msg-> A'",
    };
  }

  // Check deprecated return arrow patterns — return error
  if (RETURN_SYNC_LABELED_RE.test(line) || RETURN_ASYNC_LABELED_RE.test(line)) {
    const m =
      line.match(RETURN_SYNC_LABELED_RE) ?? line.match(RETURN_ASYNC_LABELED_RE);
    // RETURN_*_LABELED_RE both have 3 capture groups by construction.
    const from = m![3]!;
    const to = m![1]!;
    const label = m![2]!.trim();
    return {
      error: `Left-pointing arrows are no longer supported. Write '${from} -${label}-> ${to}' instead`,
    };
  }

  const patterns: {
    re: RegExp;
    async: boolean;
  }[] = [
    { re: SYNC_LABELED_RE, async: false },
    { re: ASYNC_LABELED_RE, async: true },
  ];

  for (const { re, async: isAsync } of patterns) {
    const m = line.match(re);
    if (!m) continue;

    // SYNC_LABELED_RE / ASYNC_LABELED_RE both have 3 capture groups.
    const label = m[2]!.trim();

    // Empty label (e.g. `--> B`) — fall through to plain arrow handling
    if (!label) return null;

    return {
      from: m[1]!,
      to: m[3]!,
      label,
      async: isAsync,
    };
  }

  return null;
}
