// ============================================================
// Generic diagram note — collision-aware placement
// ============================================================
//
// Floats each note beside its anchor node WITHOUT moving the node, so the
// shape keeps its layout position and its edge connections. Every chart
// shares this one placement policy. The caller supplies positioned node
// rects (`obstacles`) and per-note requests; this returns a box position
// LOCAL to each node's center (the renderer's translate origin).

import { NOTE_GAP, noteConnectorPoints } from '../note-box';

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

/** Clearance kept between a note's connector and any other shape. */
const CONNECTOR_CLEAR = 4;

/** Clearance kept between a note's box and any edge line. */
const EDGE_CLEAR = 6;

/** An edge as the polyline its waypoints draw, in canvas coords. */
export type NoteEdgePath = readonly {
  readonly x: number;
  readonly y: number;
}[];

/**
 * Step of the slide along a side, and the farthest a note moves from its
 * side — outward, or along a left/right side. Dense layouts leave gaps
 * smaller than a note, so the clear spot can be a long diagonal away.
 */
const SLIDE_STEP = 10;
const SEARCH_REACH = 480;

/** Does the segment (x1,y1)→(x2,y2) pass through the inside of `r`? */
const segmentCrosses = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: Rect
): boolean => {
  // Liang–Barsky clip: the part of the segment inside `r` is [t0, t1].
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - r.left, r.right - x1, y1 - r.top, r.bottom - y1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi <= 0) return false;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t0 < t1;
};

/**
 * Place each note beside its node, so the note's box clears every shape
 * and the straight connector from the node to the note crosses no other
 * shape. Try the default side (right for TB, below for LR), then the
 * opposite side. If neither is clear, search all four sides — sliding
 * along each side and stepping outward — and take the clear position with
 * the shortest connector. A clear position also keeps the box off every
 * edge line; only if no such position exists are the edges ignored. Only
 * if none is clear, push the default side outward past the blockers. Each placed note then becomes an obstacle
 * for later notes and connectors.
 *
 * Returns a map keyed by request `key`. The `x/y` are the box left/top
 * relative to the node center; collapsed requests return `{collapsed:true,
 * side:'right', x:0, y:0}`.
 */
export function placeNotes(
  obstacles: readonly PlaceableNode[],
  requests: readonly NotePlaceRequest[],
  direction: 'TB' | 'LR',
  edges: readonly NoteEdgePath[] = []
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
      direction === 'LR'
        ? ['below', 'above', 'right', 'left']
        : ['right', 'left', 'below', 'above'];

    const anchor: Rect = {
      left: nodeLeft,
      top: nodeTop,
      right: nodeRight,
      bottom: nodeBottom,
    };
    const isAnchor = (o: Rect): boolean =>
      o.left === anchor.left &&
      o.top === anchor.top &&
      o.right === anchor.right &&
      o.bottom === anchor.bottom;

    // The connector exactly as the renderer draws it, in canvas coords.
    const connector = (rect: Rect, side: NoteSide): number[] => {
      const [x1, y1, x2, y2] = noteConnectorPoints(p, {
        x: rect.left - cx,
        y: rect.top - cy,
        width: noteW,
        height: noteH,
        side,
      });
      return [cx + x1, cy + y1, cx + x2, cy + y2];
    };

    const onEdge = (rect: Rect): boolean => {
      const padded = {
        left: rect.left - EDGE_CLEAR,
        top: rect.top - EDGE_CLEAR,
        right: rect.right + EDGE_CLEAR,
        bottom: rect.bottom + EDGE_CLEAR,
      };
      return edges.some((path) =>
        path.some(
          (pt, i) =>
            i > 0 &&
            segmentCrosses(path[i - 1]!.x, path[i - 1]!.y, pt.x, pt.y, padded)
        )
      );
    };

    const isClear = (
      rect: Rect,
      side: NoteSide,
      avoidEdges: boolean
    ): boolean => {
      if (occupied.some((o) => intersects(rect, o, NOTE_CLEAR))) return false;
      if (avoidEdges && onEdge(rect)) return false;
      const [x1, y1, x2, y2] = connector(rect, side) as [
        number,
        number,
        number,
        number,
      ];
      return !occupied.some(
        (o) =>
          !isAnchor(o) &&
          segmentCrosses(x1, y1, x2, y2, {
            left: o.left - CONNECTOR_CLEAR,
            top: o.top - CONNECTOR_CLEAR,
            right: o.right + CONNECTOR_CLEAR,
            bottom: o.bottom + CONNECTOR_CLEAR,
          })
      );
    };

    // First a spot clear of shapes AND edge lines; failing that, one clear
    // of shapes only.
    const search = (
      avoidEdges: boolean
    ): { rect: Rect; side: NoteSide } | null => {
      let chosen: { rect: Rect; side: NoteSide } | null = null;
      for (const side of order.slice(0, 2)) {
        const rect = rectFor(side);
        if (isClear(rect, side, avoidEdges)) {
          chosen = { rect, side };
          break;
        }
      }

      if (chosen) return chosen;

      // Search the four sides: slide along each, step outward, keep the
      // clear position whose connector is shortest. Above and below slide
      // only while the note still spans the node's centre, so their
      // connector stays the renderer's straight vertical line.
      let bestLen = Infinity;
      for (const side of order) {
        const axisIsY = side === 'above' || side === 'below';
        const outward = side === 'below' || side === 'right' ? 1 : -1;
        const reach = axisIsY ? noteW / 2 : SEARCH_REACH;
        const slides = [0];
        for (let s = SLIDE_STEP; s <= reach; s += SLIDE_STEP) {
          slides.push(s, -s);
        }
        const base = rectFor(side);
        for (let out = 0; out <= SEARCH_REACH; out += NOTE_CLEAR) {
          for (const slide of slides) {
            const dx = axisIsY ? slide : out * outward;
            const dy = axisIsY ? out * outward : slide;
            const rect = {
              left: base.left + dx,
              top: base.top + dy,
              right: base.right + dx,
              bottom: base.bottom + dy,
            };
            if (!isClear(rect, side, avoidEdges)) continue;
            const [x1, y1, x2, y2] = connector(rect, side) as [
              number,
              number,
              number,
              number,
            ];
            const len = Math.hypot(x2 - x1, y2 - y1);
            if (len < bestLen) {
              bestLen = len;
              chosen = { rect, side };
            }
          }
        }
      }
      return chosen;
    };

    let chosen = search(true) ?? search(false);

    if (!chosen) {
      // Nowhere is clear — push the default side outward past blockers.
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
