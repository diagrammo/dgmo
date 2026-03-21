// ============================================================
// Shared Arrow Parsing Utility
// ============================================================
//
// Labeled arrow syntax (always left-to-right):
//   Sync:  `-label->`
//   Async: `~label~>`

export interface ParsedArrow {
  from: string;
  to: string;
  label: string;
  async: boolean;
}

// Forward (call) patterns — participant names may contain spaces, so use non-greedy (.+?)
const SYNC_LABELED_RE = /^(.+?)\s+-(.+)->\s+(.+)$/;
const ASYNC_LABELED_RE = /^(.+?)\s+~(.+)~>\s+(.+)$/;

// Deprecated patterns — produce errors
const RETURN_SYNC_LABELED_RE = /^(.+?)\s+<-(.+)-\s+(.+)$/;
const RETURN_ASYNC_LABELED_RE = /^(.+?)\s+<~(.+)~\s+(.+)$/;
const BIDI_SYNC_RE = /^(.+?)\s+<-(.+)->\s+(.+)$/;
const BIDI_ASYNC_RE = /^(.+?)\s+<~(.+)~>\s+(.+)$/;

const ARROW_CHARS = ['->', '~>'];

/**
 * Try to parse a labeled arrow from a trimmed line.
 *
 * Returns:
 *  - `ParsedArrow` if matched and valid
 *  - `{ error: string }` if matched but invalid (deprecated syntax)
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

  // Check deprecated return arrow patterns — return error
  if (RETURN_SYNC_LABELED_RE.test(line) || RETURN_ASYNC_LABELED_RE.test(line)) {
    const m =
      line.match(RETURN_SYNC_LABELED_RE) ??
      line.match(RETURN_ASYNC_LABELED_RE);
    const from = m![3];
    const to = m![1];
    const label = m![2].trim();
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

    const label = m[2].trim();

    // Empty label (e.g. `--> B`) — fall through to plain arrow handling
    if (!label) return null;

    // Validate: no arrow chars inside label
    for (const arrow of ARROW_CHARS) {
      if (label.includes(arrow)) {
        return {
          error: 'Arrow characters (->, ~>) are not allowed inside labels',
        };
      }
    }

    return {
      from: m[1],
      to: m[3],
      label,
      async: isAsync,
    };
  }

  return null;
}
