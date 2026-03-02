// ============================================================
// Shared Arrow Parsing Utility
// ============================================================
//
// Labeled arrow syntax:
//   Forward: `-label->`, `~label~>`
//   Return:  `<-label-`, `<~label~`

export interface ParsedArrow {
  from: string;
  to: string;
  label: string;
  async: boolean;
  isReturn: boolean;
}

// Forward (call) patterns
const SYNC_LABELED_RE = /^(\S+)\s+-(.+)->\s+(\S+)$/;
const ASYNC_LABELED_RE = /^(\S+)\s+~(.+)~>\s+(\S+)$/;

// Return patterns — A <-msg- B means from=B, to=A
const RETURN_SYNC_LABELED_RE = /^(\S+)\s+<-(.+)-\s+(\S+)$/;
const RETURN_ASYNC_LABELED_RE = /^(\S+)\s+<~(.+)~\s+(\S+)$/;

// Bidi detection (for error messages only)
const BIDI_SYNC_RE = /^(\S+)\s+<-(.+)->\s+(\S+)$/;
const BIDI_ASYNC_RE = /^(\S+)\s+<~(.+)~>\s+(\S+)$/;

const ARROW_CHARS = ['->', '~>', '<-', '<~'];

/**
 * Try to parse a labeled arrow from a trimmed line.
 *
 * Returns:
 *  - `ParsedArrow` if matched and valid
 *  - `{ error: string }` if matched but invalid (bidi, or arrow chars in label)
 *  - `null` if not a labeled arrow (caller should fall through to bare patterns)
 */
export function parseArrow(
  line: string,
): ParsedArrow | { error: string } | null {
  // Check bidi patterns first — return error
  if (BIDI_SYNC_RE.test(line) || BIDI_ASYNC_RE.test(line)) {
    return {
      error:
        "Bidirectional arrows are no longer supported. Use two separate lines: 'A -msg-> B' and 'B -msg-> A'",
    };
  }

  const patterns: {
    re: RegExp;
    async: boolean;
    isReturn: boolean;
  }[] = [
    { re: RETURN_SYNC_LABELED_RE, async: false, isReturn: true },
    { re: RETURN_ASYNC_LABELED_RE, async: true, isReturn: true },
    { re: SYNC_LABELED_RE, async: false, isReturn: false },
    { re: ASYNC_LABELED_RE, async: true, isReturn: false },
  ];

  for (const { re, async: isAsync, isReturn } of patterns) {
    const m = line.match(re);
    if (!m) continue;

    const label = m[2].trim();

    // Empty label (e.g. `--> B`) — fall through to plain arrow handling
    if (!label) return null;

    // Validate: no arrow chars inside label
    for (const arrow of ARROW_CHARS) {
      if (label.includes(arrow)) {
        return {
          error: 'Arrow characters (->, ~>, <-, <~) are not allowed inside labels',
        };
      }
    }

    if (isReturn) {
      // Return arrow: A <-msg- B → from=B (source), to=A (destination)
      return {
        from: m[3],
        to: m[1],
        label,
        async: isAsync,
        isReturn: true,
      };
    }

    return {
      from: m[1],
      to: m[3],
      label,
      async: isAsync,
      isReturn: false,
    };
  }

  return null;
}
