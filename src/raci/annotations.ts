// ============================================================
// Trailing `# annotation` parser
// ============================================================
//
// First chart-type to ship per-line `#` annotations in dgmo. The
// helper is generic so a follow-up can wire `# allow-merge` (sequence
// merge-fold suppression) onto the same machinery — see the JSDoc on
// `NAME_DIAGNOSTIC_CODES.NAME_MERGED` in `diagnostics.ts`.
//
// Grammar (anchored to end-of-line, whitespace-delimited):
//
//   ... <task body>  # name [name ...]
//
// `#` only triggers stripping when preceded by whitespace AND not
// inside a quoted string — otherwise `Task "with # in name"` would
// lose its closing quote.

/** Result of stripping a trailing annotation segment from a line. */
export interface ParsedTaskAnnotations<A extends string = string> {
  /** Line content with the trailing `# ...` segment removed and trimmed. */
  stripped: string;
  /** Validated annotation names (unknown ones are dropped, see `unknown`). */
  annotations: Set<A>;
  /** Annotation names that did not appear in the `allowed` set. */
  unknown: string[];
}

/**
 * Strip a trailing `# name [name ...]` segment from a line.
 *
 * The `#` must be preceded by whitespace AND outside any quoted string
 * (single or double). Annotation names are space-separated within the
 * single `#` segment. Unknown names are reported via the `unknown`
 * field and excluded from `annotations`.
 *
 * @param line   The raw line text (already trimmed of indentation, optional)
 * @param allowed Set of recognized annotation names for this caller
 */
export function parseTaskAnnotations<A extends string>(
  line: string,
  allowed: ReadonlySet<A>
): ParsedTaskAnnotations<A> {
  const hashIdx = findUnquotedTrailingHash(line);
  if (hashIdx < 0) {
    return { stripped: line, annotations: new Set(), unknown: [] };
  }

  const stripped = line.substring(0, hashIdx).trimEnd();
  const tail = line.substring(hashIdx + 1).trim();
  const tokens = tail.length > 0 ? tail.split(/\s+/) : [];

  const annotations = new Set<A>();
  const unknown: string[] = [];
  for (const token of tokens) {
    if (allowed.has(token as A)) {
      annotations.add(token as A);
    } else {
      unknown.push(token);
    }
  }

  return { stripped, annotations, unknown };
}

/**
 * Locate the byte index of a `#` that begins a trailing annotation.
 *
 * Rules:
 * - The `#` must be preceded by whitespace (or be at column 0 — but
 *   that would mean the whole line starts with `#`, treated as no annotation
 *   to leave room for future comment-line semantics).
 * - The `#` must be outside any active quoted span (`"..."` or `'...'`).
 * - Only the LAST qualifying `#` on the line is the anchor — earlier
 *   ones become part of the label.
 *
 * Returns `-1` if no such anchor exists.
 */
function findUnquotedTrailingHash(line: string): number {
  let inDouble = false;
  let inSingle = false;
  let lastValidHash = -1;
  let prev = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
    } else if (!inDouble && ch === "'") {
      inSingle = !inSingle;
    } else if (
      ch === '#' &&
      !inDouble &&
      !inSingle &&
      (prev === ' ' || prev === '\t')
    ) {
      lastValidHash = i;
    }
    prev = ch;
  }
  return lastValidHash;
}
