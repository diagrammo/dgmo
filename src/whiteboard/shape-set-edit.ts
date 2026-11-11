// ============================================================
// The `shapes` line edit — one oracle for every editor path (#1845)
// ============================================================
//
// Three editor paths turn a glyph set on or off: accepting a glyph from
// completion, the quick fix on `W_WHITEBOARD_SHAPE_SET_OFF`, and the Shape
// sets picker's tick. All three write the same line the same way, so the rule
// lives here, once, as a pure function over the CURRENT document text.
//
// Leaf module: it imports only the glyph registry (itself a leaf), so the light
// `@diagrammo/dgmo/completion` entry can carry it without the parsers.

import { glyphSetById } from '../glyphs/registry';

/** One text change: replace `[from, to)` of the source with `insert`. */
export interface SourceEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

interface SourceLine {
  /** Offset of the line's first character. */
  readonly start: number;
  /** The line without its `\n` (and without a trailing `\r`). */
  readonly text: string;
}

function splitLines(source: string): SourceLine[] {
  const out: SourceLine[] = [];
  let start = 0;
  for (const raw of source.split('\n')) {
    out.push({ start, text: raw.endsWith('\r') ? raw.slice(0, -1) : raw });
    start += raw.length + 1;
  }
  return out;
}

const SHAPES_LINE = /^shapes(?=\s|$)/i;

/** The ids a `shapes` line names, as written (empty entries dropped). */
function idsOf(text: string): string[] {
  return text
    .slice('shapes'.length)
    .split(/[\s,]+/)
    .filter((t) => t !== '');
}

/**
 * The edits that turn bundled glyph set `setId` on (`on: true`) or off in a
 * whiteboard source. Offsets are into `source`, ascending and non-overlapping,
 * so an editor applies them as one change. An empty array means there is
 * nothing to do: the set is already in that state, `setId` is not a bundled
 * set, or (turning on) the source has no `whiteboard` line to write under.
 *
 * - **On.** A file with a `shapes` line gets `, <id>` appended to the first
 *   one. A file with none gets `shapes <id>` on a new line directly under the
 *   title line, where the emitter writes it.
 * - **Off.** Every `shapes` line naming the set loses that id; a line left
 *   naming nothing is deleted, newline and all.
 *
 * A `shapes` line is one that starts at column 1, as the emitter writes it.
 * Ids compare case-insensitively, as the parser reads them.
 */
export function shapeSetEdits(
  source: string,
  setId: string,
  on: boolean
): SourceEdit[] {
  const id = setId.toLowerCase();
  if (!glyphSetById(id)) return [];
  const lines = splitLines(source);
  const shapesLines = lines.filter((l) => SHAPES_LINE.test(l.text));
  const names = (l: SourceLine): boolean =>
    idsOf(l.text).some((t) => t.toLowerCase() === id);

  if (on) {
    if (shapesLines.some(names)) return [];
    const first = shapesLines[0];
    if (first) {
      const end = first.start + first.text.trimEnd().length;
      const sep = idsOf(first.text).length > 0 ? ', ' : ' ';
      return [{ from: end, to: end, insert: `${sep}${id}` }];
    }
    const title = lines.find((l) => {
      const t = l.text.trim();
      return t !== '' && !t.startsWith('//');
    });
    if (!title || !/^whiteboard(?=\s|$)/i.test(title.text.trim())) return [];
    const end = title.start + title.text.length;
    return [{ from: end, to: end, insert: `\nshapes ${id}` }];
  }

  const edits: SourceEdit[] = [];
  for (const l of shapesLines) {
    if (!names(l)) continue;
    const kept = idsOf(l.text).filter((t) => t.toLowerCase() !== id);
    if (kept.length > 0) {
      edits.push({
        from: l.start,
        to: l.start + l.text.length,
        insert: `shapes ${kept.join(', ')}`,
      });
      continue;
    }
    // Delete the line with its newline: the one after it, or — on the last
    // line — the one before it, so no blank line is left behind.
    const next = l.start + l.text.length;
    const nl = next < source.length ? source.indexOf('\n', next) : -1;
    if (nl !== -1) {
      edits.push({ from: l.start, to: nl + 1, insert: '' });
      continue;
    }
    const crlf = l.start >= 2 && source[l.start - 2] === '\r';
    const from = Math.max(0, l.start - (crlf ? 2 : 1));
    const prev = edits[edits.length - 1];
    if (prev && prev.to > from) {
      // The newline before this line is already inside the edit that deletes
      // the line above; extend that edit over this one instead of overlapping.
      if (prev.insert === '') {
        const prevCrlf = prev.from >= 2 && source[prev.from - 2] === '\r';
        edits[edits.length - 1] = {
          from: Math.max(0, prev.from - (prevCrlf ? 2 : 1)),
          to: source.length,
          insert: '',
        };
      } else {
        edits.push({ from: prev.to, to: source.length, insert: '' });
      }
      continue;
    }
    // A trailing lone `\r` belongs to this line, so it goes with it.
    edits.push({ from, to: source.length, insert: '' });
  }
  return edits;
}
