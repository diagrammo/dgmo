// ============================================================
// Shared Arrow Parsing Utility
// ============================================================
//
// Labeled arrow syntax: `-label->`, `~label~>`, `<-label->`, `<~label~>`
// Used by sequence, C4, and init-status parsers.

export interface ParsedArrow {
  from: string;
  to: string;
  label: string;
  async: boolean;
  bidirectional: boolean;
}

// Bidi patterns checked FIRST — longer prefix avoids partial match
const BIDI_SYNC_LABELED_RE = /^(\S+)\s+<-(.+)->\s+(\S+)$/;
const BIDI_ASYNC_LABELED_RE = /^(\S+)\s+<~(.+)~>\s+(\S+)$/;
const SYNC_LABELED_RE = /^(\S+)\s+-(.+)->\s+(\S+)$/;
const ASYNC_LABELED_RE = /^(\S+)\s+~(.+)~>\s+(\S+)$/;

const ARROW_CHARS = ['->', '~>', '<->', '<~>'];

/**
 * Try to parse a labeled arrow from a trimmed line.
 *
 * Returns:
 *  - `ParsedArrow` if matched and valid
 *  - `{ error: string }` if matched but label contains arrow chars
 *  - `null` if not a labeled arrow (caller should fall through to plain patterns)
 */
export function parseArrow(
  line: string,
): ParsedArrow | { error: string } | null {
  // Order: bidi first (longer prefix), then unidirectional
  const patterns: {
    re: RegExp;
    async: boolean;
    bidirectional: boolean;
  }[] = [
    { re: BIDI_SYNC_LABELED_RE, async: false, bidirectional: true },
    { re: BIDI_ASYNC_LABELED_RE, async: true, bidirectional: true },
    { re: SYNC_LABELED_RE, async: false, bidirectional: false },
    { re: ASYNC_LABELED_RE, async: true, bidirectional: false },
  ];

  for (const { re, async: isAsync, bidirectional } of patterns) {
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
      bidirectional,
    };
  }

  return null;
}
