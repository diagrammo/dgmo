// ============================================================
// Generic diagram note — layout assembly
// ============================================================
//
// Turns resolved notes + positioned anchor rects into render-ready
// {@link PlacedNote}s (box geometry LOCAL to each node's center, or a
// collapsed flag). A chart's layout calls this once, attaches each
// PlacedNote to its layout node, then extends its content bbox with the
// note rects and applies `noteCanvasShift`. Keeps every adopting chart's
// note wiring to a few lines.

import { noteBoxSize } from '../note-box';
import type { WrappedDescLine } from '../wrapped-desc';
import { placeNotes, type NoteSide, type PlaceableNode } from './place';
import type { DiagramNote } from './model';

/** A resolved, placed note ready for the note-box drawer. */
export interface PlacedNote {
  /** Box left, LOCAL to the node center (add node.x). Unused if collapsed. */
  readonly x: number;
  /** Box top, LOCAL to the node center (add node.y). Unused if collapsed. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly side: NoteSide;
  /** Resolved hex accent (border + faded fill); default yellow if absent. */
  readonly color?: string;
  readonly lines: readonly WrappedDescLine[];
  readonly lineNumber: number;
  readonly endLineNumber: number;
  /** Collapsed → renderer draws a corner badge; box geometry is unused. */
  readonly collapsed?: boolean;
}

/** A positioned anchor node: its id plus its center rect. */
export interface NoteAnchor extends PlaceableNode {
  readonly id: string;
}

/**
 * Build a map of node id → {@link PlacedNote} for every anchor that has a
 * resolved note. Measures each note, runs the shared collision placer, and
 * assembles render-ready geometry. Collapsed notes (lineNumber ∈
 * `collapsedNotes`) reserve no space.
 */
export function buildPlacedNotes(
  anchors: readonly NoteAnchor[],
  noteByNode: ReadonlyMap<string, DiagramNote>,
  direction: 'TB' | 'LR',
  collapsedNotes?: ReadonlySet<number>
): Map<string, PlacedNote> {
  const placed = new Map<string, PlacedNote>();
  if (noteByNode.size === 0) return placed;

  interface Geom {
    readonly noteW: number;
    readonly noteH: number;
    readonly color?: string;
    readonly lines: readonly WrappedDescLine[];
    readonly lineNumber: number;
    readonly endLineNumber: number;
  }
  const geoms = new Map<string, Geom>();
  const requests: {
    key: string;
    node: PlaceableNode;
    noteW: number;
    noteH: number;
    collapsed: boolean;
  }[] = [];

  for (const a of anchors) {
    const note = noteByNode.get(a.id);
    if (!note) continue;
    const size = noteBoxSize(note.body);
    geoms.set(a.id, {
      noteW: size.width,
      noteH: size.height,
      ...(note.color && { color: note.color }),
      lines: size.lines,
      lineNumber: note.lineNumber,
      endLineNumber: note.endLineNumber,
    });
    requests.push({
      key: a.id,
      node: { x: a.x, y: a.y, width: a.width, height: a.height },
      noteW: size.width,
      noteH: size.height,
      collapsed: collapsedNotes?.has(note.lineNumber) ?? false,
    });
  }

  const placements = placeNotes(
    anchors.map((a) => ({ x: a.x, y: a.y, width: a.width, height: a.height })),
    requests,
    direction
  );

  for (const [id, g] of geoms) {
    const p = placements.get(id)!;
    placed.set(
      id,
      p.collapsed
        ? {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            side: 'right',
            ...(g.color && { color: g.color }),
            lines: [],
            lineNumber: g.lineNumber,
            endLineNumber: g.endLineNumber,
            collapsed: true,
          }
        : {
            x: p.x,
            y: p.y,
            width: g.noteW,
            height: g.noteH,
            side: p.side,
            ...(g.color && { color: g.color }),
            lines: g.lines,
            lineNumber: g.lineNumber,
            endLineNumber: g.endLineNumber,
          }
    );
  }

  return placed;
}
