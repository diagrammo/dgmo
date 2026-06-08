// ============================================================
// Generic diagram note — shared parsing
// ============================================================

import { makeDgmoError, type DgmoError } from '../../diagnostics';
import type { PaletteColors } from '../../palettes';
import { measureIndent, extractColor } from '../parsing';
import type { DiagramNote } from './model';

/**
 * Split a `note` heading's remainder into a `ref` token and inline body.
 * Quote the ref for multi-word labels:
 *   `note Foo a comment`        → { ref: 'Foo', inlineBody: 'a comment' }
 *   `note "Order Received" done` → { ref: 'Order Received', inlineBody: 'done' }
 */
export function parseNoteHeader(rest: string): {
  ref: string;
  inlineBody: string;
} {
  const t = rest.trim();
  const quoted = t.match(/^"([^"]+)"\s*(.*)$/);
  if (quoted) {
    return { ref: quoted[1]!.trim(), inlineBody: quoted[2]!.trim() };
  }
  const m = t.match(/^(\S+)\s*(.*)$/);
  if (m) {
    return { ref: m[1]!, inlineBody: m[2]!.trim() };
  }
  return { ref: t, inlineBody: '' };
}

export interface CollectedNoteBody {
  readonly body: string;
  readonly endLineNumber: number;
  /** 0-based index of the last source line consumed. */
  readonly lastIndex: number;
}

/**
 * Collect a note's multi-line body: following lines indented MORE than the
 * note line. A blank line or a dedent terminates. Lines are trimmed and
 * joined with `\n`; the inline body (if any) leads.
 */
export function collectNoteBody(
  lines: readonly string[],
  noteIndex: number,
  noteIndent: number,
  inlineBody: string
): CollectedNoteBody {
  const parts: string[] = [];
  if (inlineBody) parts.push(inlineBody);

  let lastIndex = noteIndex;
  let endLineNumber = noteIndex + 1;

  for (let j = noteIndex + 1; j < lines.length; j++) {
    const raw = lines[j]!;
    const trimmed = raw.trim();
    if (!trimmed) break;
    if (measureIndent(raw) <= noteIndent) break;
    parts.push(trimmed);
    lastIndex = j;
    endLineNumber = j + 1;
  }

  return { body: parts.join('\n'), endLineNumber, lastIndex };
}

export interface TryCollectNoteResult {
  /** Absent when the body was empty (a warning was pushed, line consumed). */
  readonly note?: DiagramNote;
  /** 0-based index of the last consumed source line. */
  readonly lastIndex: number;
}

/**
 * Try to parse a `note` line at `lines[index]` into a {@link DiagramNote},
 * collecting any indented body and peeling a trailing color word. Returns
 * `null` when the line is not a note (incl. `note -> X`, which a chart with
 * bare-name nodes parses as an edge). On an empty body, emits a warning and
 * returns `{ lastIndex }` with no note (the line is still consumed).
 *
 * Each chart calls this in its main loop:
 *   const r = tryCollectNote(lines, i, indent, palette, diagnostics);
 *   if (r) { if (r.note) notes.push(r.note); i = r.lastIndex; continue; }
 */
export function tryCollectNote(
  lines: readonly string[],
  index: number,
  indent: number,
  palette: PaletteColors | undefined,
  diagnostics: DgmoError[]
): TryCollectNoteResult | null {
  const trimmed = lines[index]!.trim();
  const m = trimmed.match(/^note\s+(.+)$/i);
  if (!m || /^note\s+->/i.test(trimmed)) return null;

  const lineNumber = index + 1;
  // Trailing lowercase color word colors the note (§1.5); capitalize to
  // keep it as literal body text.
  const { label: headerNoColor, color } = extractColor(
    m[1]!,
    palette,
    diagnostics,
    lineNumber
  );
  const { ref, inlineBody } = parseNoteHeader(headerNoColor);
  const collected = collectNoteBody(lines, index, indent, inlineBody);

  if (!collected.body.trim()) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `Note on "${ref}" has no text — ignored.`,
        'warning'
      )
    );
    return { lastIndex: collected.lastIndex };
  }

  return {
    note: {
      ref,
      body: collected.body,
      ...(color && { color }),
      lineNumber,
      endLineNumber: collected.endLineNumber,
    },
    lastIndex: collected.lastIndex,
  };
}
