// ============================================================
// Generic diagram note — collision-aware placement
// ============================================================
//
// Floats each note beside its anchor node WITHOUT moving the node, so the
// shape keeps its layout position and its edge connections. Ported verbatim
// from the graph layout's "Collision-aware note placement" block so every
// chart shares one placement policy. The caller supplies positioned node
// rects (`obstacles`) and per-note requests; this returns a box position
// LOCAL to each node's center (the renderer's translate origin).

import { NOTE_GAP } from '../note-box';

export type NoteSide = 'above' | 'below' | 'left' | 'right';

/** A positioned rect (center + size) that a note must avoid overlapping. */
export interface PlaceableNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NotePlaceRequest {
  /** Stable key (node id) the result map is keyed by. */
  readonly key: string;
  /** The anchor node the note floats beside. */
  readonly node: PlaceableNode;
  readonly noteW: number;
  readonly noteH: number;
  /** Collapsed notes reserve no space — drawn as a corner badge. */
  readonly collapsed: boolean;
}

export interface NotePlacement {
  readonly collapsed: boolean;
  readonly side: NoteSide;
  /** Box left/top, LOCAL to the node center (add node.x / node.y). */
  readonly x: number;
  readonly y: number;
}

/** Clearance kept between a note and any obstacle (node or earlier note). */
export const NOTE_CLEAR = 14;

type Rect = { left: number; top: number; right: number; bottom: number };

const intersects = (a: Rect, b: Rect, pad: number): boolean =>
  !(
    a.right + pad <= b.left ||
    b.right + pad <= a.left ||
    a.bottom + pad <= b.top ||
    b.bottom + pad <= a.top
  );

/**
 * Place each note beside its node. Try the default side (right for TB,
 * below for LR); if it would overlap an obstacle flip to the opposite
 * side; if both collide, push the default side outward past the blockers.
 * Each placed note then becomes an obstacle for later notes, so notes keep
 * a comfortable distance from every shape and from each other.
 *
 * Returns a map keyed by request `key`. The `x/y` are the box left/top
 * relative to the node center; collapsed requests return `{collapsed:true,
 * side:'right', x:0, y:0}`.
 */
export function placeNotes(
  obstacles: readonly PlaceableNode[],
  requests: readonly NotePlaceRequest[],
  direction: 'TB' | 'LR'
): Map<string, NotePlacement> {
  const placements = new Map<string, NotePlacement>();

  const occupied: Rect[] = obstacles.map((p) => ({
    left: p.x - p.width / 2,
    top: p.y - p.height / 2,
    right: p.x + p.width / 2,
    bottom: p.y + p.height / 2,
  }));

  for (const req of requests) {
    if (req.collapsed) {
      placements.set(req.key, {
        collapsed: true,
        side: 'right',
        x: 0,
        y: 0,
      });
      continue;
    }

    const p = req.node;
    const cx = p.x;
    const cy = p.y;
    const nodeLeft = cx - p.width / 2;
    const nodeRight = cx + p.width / 2;
    const nodeTop = cy - p.height / 2;
    const nodeBottom = cy + p.height / 2;
    const { noteW, noteH } = req;

    const rectFor = (side: NoteSide): Rect => {
      switch (side) {
        case 'right': {
          const left = nodeRight + NOTE_GAP;
          const top = cy - noteH / 2;
          return { left, top, right: left + noteW, bottom: top + noteH };
        }
        case 'left': {
          const right = nodeLeft - NOTE_GAP;
          const top = cy - noteH / 2;
          return { left: right - noteW, top, right, bottom: top + noteH };
        }
        case 'below': {
          const left = cx - noteW / 2;
          const top = nodeBottom + NOTE_GAP;
          return { left, top, right: left + noteW, bottom: top + noteH };
        }
        case 'above':
        default: {
          const left = cx - noteW / 2;
          const bottom = nodeTop - NOTE_GAP;
          return { left, top: bottom - noteH, right: left + noteW, bottom };
        }
      }
    };

    const order: NoteSide[] =
      direction === 'LR' ? ['below', 'above'] : ['right', 'left'];

    let chosen: { rect: Rect; side: NoteSide } | null = null;
    for (const side of order) {
      const rect = rectFor(side);
      if (!occupied.some((o) => intersects(rect, o, NOTE_CLEAR))) {
        chosen = { rect, side };
        break;
      }
    }

    if (!chosen) {
      // Both sides blocked — push the default side outward past blockers.
      const side = order[0]!;
      let rect = rectFor(side);
      const axisIsY = side === 'above' || side === 'below';
      const outward = side === 'below' || side === 'right' ? 1 : -1;
      for (let guard = 0; guard < 50; guard++) {
        const blockers = occupied.filter((o) =>
          intersects(rect, o, NOTE_CLEAR)
        );
        if (blockers.length === 0) break;
        if (axisIsY && outward > 0) {
          const top = Math.max(...blockers.map((b) => b.bottom)) + NOTE_CLEAR;
          rect = { ...rect, top, bottom: top + noteH };
        } else if (axisIsY) {
          const bottom = Math.min(...blockers.map((b) => b.top)) - NOTE_CLEAR;
          rect = { ...rect, bottom, top: bottom - noteH };
        } else if (outward > 0) {
          const left = Math.max(...blockers.map((b) => b.right)) + NOTE_CLEAR;
          rect = { ...rect, left, right: left + noteW };
        } else {
          const right = Math.min(...blockers.map((b) => b.left)) - NOTE_CLEAR;
          rect = { ...rect, right, left: right - noteW };
        }
      }
      chosen = { rect, side };
    }

    occupied.push(chosen.rect);
    placements.set(req.key, {
      collapsed: false,
      side: chosen.side,
      x: chosen.rect.left - p.x,
      y: chosen.rect.top - p.y,
    });
  }

  return placements;
}
