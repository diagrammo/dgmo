// Single-line classifier for the `dgmo migrate` tool.
//
// `isLegacyMetadataLine(line)` returns true iff `line` contains a `|`
// in a position that the unified §1.4 grammar treats as the legacy
// metadata delimiter — i.e. NOT inside one of these surviving regions:
//
//   * Wireframe option braces `{A | B}`         (brace-depth tracked)
//   * Quoted strings `"..."` / `'...'`          (quote-state tracked)
//   * In-arrow labels `A -text|more-> B`        (§1.10, arrow regions)
//
// The classifier is intentionally pure and chart-type agnostic — every
// chart type whose legacy syntax used `|` for metadata gets the same
// treatment. Chart-type-specific bare-positional shapes (gantt `| 80%`,
// journey-map `| 4 Delighted`, pyramid/ring `| description text`) all
// start with `|` so the classifier flags them; the transformer is
// where chart-type awareness lives.

/**
 * Returns the byte offsets of every `|` on `line` that is OUTSIDE the
 * surviving non-metadata regions enumerated above. Empty array means
 * "no legacy metadata pipe on this line."
 */
export function findUnsafePipePositions(line: string): number[] {
  const positions: number[] = [];
  let i = 0;
  let inDouble = false;
  let inSingle = false;
  let braceDepth = 0;
  let inArrow = false;
  let arrowOpenChar: '-' | '~' | null = null;

  while (i < line.length) {
    const ch = line[i]!;
    const ch2 = i + 1 < line.length ? line[i + 1]! : '';

    if (inDouble) {
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inArrow) {
      if (
        (arrowOpenChar === '-' && ch === '-' && ch2 === '>') ||
        (arrowOpenChar === '~' && ch === '~' && ch2 === '>')
      ) {
        inArrow = false;
        arrowOpenChar = null;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (ch === '}') {
      if (braceDepth > 0) braceDepth--;
      i++;
      continue;
    }

    // Arrow start: an opening `-` or `~` that is preceded by whitespace
    // (token boundary) and followed by a non-arrow, non-space char,
    // with a matching `->` (or `~>`) closer further along the line and
    // no embedded `->`/`~>` substring inside the candidate label.
    // Conservative — false negatives leave the `|` flagged as metadata
    // (worst case: the migration tool tries to migrate the line and
    // the legacy parser rejects it, which is a surfaced skip, not a
    // silent corruption).
    if ((ch === '-' || ch === '~') && i > 0) {
      const prev = line[i - 1];
      const onBoundary = prev === ' ' || prev === '\t';
      const nextIsLabelChar =
        ch2 !== '' && ch2 !== ch && ch2 !== '>' && ch2 !== ' ' && ch2 !== '\t';
      if (onBoundary && nextIsLabelChar) {
        const closer = ch + '>';
        const closeIdx = line.indexOf(closer, i + 1);
        if (closeIdx > i) {
          const labelRegion = line.substring(i + 1, closeIdx);
          // Spec §1.10: `->` and `~>` substrings are forbidden inside
          // an arrow label. If they appear, this isn't a well-formed
          // arrow — bail and treat the `-`/`~` as ordinary text.
          if (!labelRegion.includes('->') && !labelRegion.includes('~>')) {
            inArrow = true;
            arrowOpenChar = ch as '-' | '~';
            i++;
            continue;
          }
        }
      }
    }

    if (ch === '|' && braceDepth === 0) {
      positions.push(i);
    }

    i++;
  }

  return positions;
}

/**
 * True iff `line` carries at least one legacy metadata `|` (outside
 * the surviving non-metadata regions). Pure, chart-type agnostic.
 */
export function isLegacyMetadataLine(line: string): boolean {
  return findUnsafePipePositions(line).length > 0;
}
