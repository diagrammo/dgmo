// Sequence participant shapes as numbers (#1732): kind and size in, a list of
// SVG parts out. No DOM here — the renderer's one drawer turns a shape into
// elements and applies fill, stroke and the highlight class in one place.

import { SEQUENCE_CYLINDER_RY, SEQUENCE_QUEUE_CAP } from '../shape-caps';
import type { ParticipantType } from './parser';

/** A participant box's nominal height; the actor's figure scales against it. */
export const PARTICIPANT_BOX_HEIGHT = 50;

/**
 * How the drawer paints a part. `shape`: fill and stroke. `body`: fill only,
 * with the `participant-body` class so the highlight CSS keeps the stroke off
 * a cylinder's inner rect (e9e9f7a3). `line`: stroke only. `ring`: stroke
 * with no fill.
 */
export type ShapePaint = 'shape' | 'body' | 'line' | 'ring';

export interface ShapePart {
  tag: 'rect' | 'ellipse' | 'line' | 'circle';
  paint: ShapePaint;
  /** Geometry, in the order the attributes are written. */
  attrs: Record<string, number>;
}

export interface ParticipantShape {
  parts: ShapePart[];
  strokeWidth: number;
  /** Every stroke is dashed — the cache's mark of ephemeral storage. */
  dashed: boolean;
}

const STROKE_WIDTH = 1.5;

/**
 * A cylinder along `axis`: far cap, body, the two walls, near cap — drawn in
 * that order so the body hides the far cap's inner arc. A database stands on
 * `y`; a queue lies on `x`, the same cylinder with its axes swapped.
 */
function cylinder(
  axis: 'x' | 'y',
  w: number,
  h: number,
  cap: number
): ShapePart[] {
  const v = axis === 'y';
  const start = v ? cap : -w / 2 + cap;
  const span = (v ? h : w) - cap * 2;
  const end = start + span;
  const [lo, hi, mid, half] = v
    ? [-w / 2, w / 2, 0, w / 2]
    : [0, h, h / 2, h / 2];
  const at = (a: number, c: number): [number, number] => (v ? [c, a] : [a, c]);
  const capAt = (a: number): ShapePart => {
    const [cx, cy] = at(a, mid);
    const [rx, ry] = v ? [half, cap] : [cap, half];
    return { tag: 'ellipse', paint: 'shape', attrs: { cx, cy, rx, ry } };
  };
  const wall = (c: number): ShapePart => {
    const [x1, y1] = at(start, c);
    const [x2, y2] = at(end, c);
    return { tag: 'line', paint: 'line', attrs: { x1, y1, x2, y2 } };
  };
  const [x, y] = at(start, lo);
  const body: ShapePart = {
    tag: 'rect',
    paint: 'body',
    attrs: { x, y, width: v ? w : span, height: v ? span : h },
  };
  return [capAt(end), body, wall(lo), wall(hi), capAt(start)];
}

/**
 * A stick figure with no background. Every number scales by `h` over the
 * nominal box height, so when ScaleContext compresses the box the head does
 * not balloon over a shrunken body.
 */
function actor(h: number): ParticipantShape {
  const sc = h / PARTICIPANT_BOX_HEIGHT;
  const hip = h * 0.65;
  const legY = h - 2 * sc;
  const line = (x1: number, y1: number, x2: number, y2: number): ShapePart => ({
    tag: 'line',
    paint: 'line',
    attrs: { x1, y1, x2, y2 },
  });
  return {
    parts: [
      {
        tag: 'circle',
        paint: 'ring',
        attrs: { cx: 0, cy: 10 * sc, r: 8 * sc },
      },
      line(0, 19 * sc, 0, hip),
      line(-16 * sc, 24 * sc, 16 * sc, 24 * sc),
      line(0, hip, -12 * sc, legY),
      line(0, hip, 12 * sc, legY),
    ],
    strokeWidth: Math.max(1.2, 2.5 * sc),
    dashed: false,
  };
}

/** The parts of a participant of `type` drawn in a `w` × `h` box. */
export function participantShape(
  type: ParticipantType,
  w: number,
  h: number
): ParticipantShape {
  const drawn = (parts: ShapePart[], dashed = false): ParticipantShape => ({
    parts,
    strokeWidth: STROKE_WIDTH,
    dashed,
  });
  switch (type) {
    case 'actor':
      return actor(h);
    case 'database':
      return drawn(cylinder('y', w, h, SEQUENCE_CYLINDER_RY));
    case 'cache':
      return drawn(cylinder('y', w, h, SEQUENCE_CYLINDER_RY), true);
    case 'queue':
      return drawn(cylinder('x', w, h, SEQUENCE_QUEUE_CAP));
    default:
      return drawn([
        {
          tag: 'rect',
          paint: 'shape',
          attrs: { x: -w / 2, y: 0, width: w, height: h, rx: 2, ry: 2 },
        },
      ]);
  }
}
