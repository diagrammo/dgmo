// ============================================================
// Generic graph notes — shared parse helpers + resolver
// ============================================================
//
// One note model + note-line grammar + resolver for every chart type in
// the `graph/` family (flowchart, state). The per-chart parser only
// collects raw `{ref, body, lines}`; this module owns the no-silent-skip
// resolution contract (unknown ref → error; ambiguous/duplicate → warn)
// so the chart parsers cannot drift apart. See ADR-1/ADR-3 in the
// graph-notes tech spec.

import { makeDgmoError, suggest, type DgmoError } from '../diagnostics';
import { measureIndent } from '../utils/parsing';
import { normalizeName } from '../utils/name-normalize';
import type { GraphNode, GraphNote } from './types';

/**
 * Split a `note` line's remainder into a `ref` token and the inline body.
 * Supports a quoted ref for multi-word node labels:
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
  /** Full body text (inline + indented lines), joined with `\n`. */
  readonly body: string;
  /** 1-based last source line consumed (note line or last body line). */
  readonly endLineNumber: number;
  /** 0-based index of the last source line consumed (for loop advance). */
  readonly lastIndex: number;
}

/**
 * Collect a note's multi-line body: any following lines indented MORE
 * than the note line. A blank line or a dedent terminates the body
 * (mirrors the sequence multi-line-body rule). Lines are trimmed and
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
    if (!trimmed) break; // blank terminates
    if (measureIndent(raw) <= noteIndent) break; // dedent terminates
    parts.push(trimmed);
    lastIndex = j;
    endLineNumber = j + 1;
  }

  return { body: parts.join('\n'), endLineNumber, lastIndex };
}

/**
 * Resolve each note's `ref` to a concrete node id. Returns a map keyed
 * by node id (one note per node — first wins). When `diagnostics` is
 * passed, pushes:
 *   - an `error` for an unknown ref (never a silent drop) with a suggest;
 *   - a `warning` when a ref matches multiple nodes (attaches to first);
 *   - a `warning` when a node already has a note (keeps the first).
 *
 * Matching is by normalized label so an author-typed bare id resolves to
 * the shape-qualified node id regardless of shape.
 */
export function resolveNotes(
  notes: readonly GraphNote[],
  nodes: readonly GraphNode[],
  diagnostics?: DgmoError[]
): Map<string, GraphNote> {
  const byNodeId = new Map<string, GraphNote>();
  if (notes.length === 0) return byNodeId;

  // Index nodes by normalized label (the lookup key authors type).
  const byNormLabel = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = normalizeName(node.label);
    const arr = byNormLabel.get(key);
    if (arr) arr.push(node);
    else byNormLabel.set(key, [node]);
  }

  for (const note of notes) {
    const matches = byNormLabel.get(normalizeName(note.ref));

    if (!matches || matches.length === 0) {
      if (diagnostics) {
        const hint = suggest(
          note.ref,
          nodes.map((n) => n.label)
        );
        diagnostics.push(
          makeDgmoError(
            note.lineNumber,
            `Note references unknown node id "${note.ref}".${
              hint ? ' ' + hint : ''
            }`,
            'error'
          )
        );
      }
      continue;
    }

    const target = matches[0]!;
    if (matches.length > 1 && diagnostics) {
      diagnostics.push(
        makeDgmoError(
          note.lineNumber,
          `Note ref "${note.ref}" matches ${matches.length} nodes; attaching to the first.`,
          'warning'
        )
      );
    }

    if (byNodeId.has(target.id)) {
      if (diagnostics) {
        diagnostics.push(
          makeDgmoError(
            note.lineNumber,
            `Multiple notes on node "${target.label}"; keeping the first.`,
            'warning'
          )
        );
      }
      continue;
    }

    byNodeId.set(target.id, note);
  }

  return byNodeId;
}
