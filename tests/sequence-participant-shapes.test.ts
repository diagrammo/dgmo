import { describe, expect, it } from 'vitest';
import { participantShape } from '../src/sequence/participant-shapes';
import { SEQUENCE_CYLINDER_RY, SEQUENCE_QUEUE_CAP } from '../src/shape-caps';

// The participant shape table (#1732): kind and size in, numbers out, no DOM.
// `parts` reads tag:paint in drawing order; `body` is the part that carries
// the participant-body class the highlight CSS keys on (e9e9f7a3).
const W = 120;
const H = 50;
const RY = SEQUENCE_CYLINDER_RY;
const CAP = SEQUENCE_QUEUE_CAP;
const CYLINDER = 'ellipse:shape rect:body line:line line:line ellipse:shape';

const rows = [
  {
    kind: 'default',
    parts: 'rect:shape',
    sw: 1.5,
    dashed: false,
    first: { x: -60, y: 0, width: W, height: H, rx: 2, ry: 2 },
  },
  {
    kind: 'actor',
    parts: 'circle:ring line:line line:line line:line line:line',
    sw: 2.5,
    dashed: false,
    first: { cx: 0, cy: 10, r: 8 },
  },
  {
    kind: 'database',
    parts: CYLINDER,
    sw: 1.5,
    dashed: false,
    first: { cx: 0, cy: H - RY, rx: W / 2, ry: RY },
  },
  {
    kind: 'cache',
    parts: CYLINDER,
    sw: 1.5,
    dashed: true,
    first: { cx: 0, cy: H - RY, rx: W / 2, ry: RY },
  },
  {
    kind: 'queue',
    parts: CYLINDER,
    sw: 1.5,
    dashed: false,
    first: { cx: W / 2 - CAP, cy: H / 2, rx: CAP, ry: H / 2 },
  },
] as const;

describe('participant shape table', () => {
  it.each(rows)('$kind', ({ kind, parts, sw, dashed, first }) => {
    const shape = participantShape(kind, W, H);
    expect(shape.parts.map((p) => `${p.tag}:${p.paint}`).join(' ')).toBe(parts);
    expect(shape.strokeWidth).toBe(sw);
    expect(shape.dashed).toBe(dashed);
    expect(shape.parts[0].attrs).toEqual(first);
  });

  it('a cylinder body sits between its caps, and a queue is a database on its side', () => {
    expect(participantShape('database', W, H).parts[1].attrs).toEqual({
      x: -W / 2,
      y: RY,
      width: W,
      height: H - RY * 2,
    });
    expect(participantShape('queue', W, H).parts[1].attrs).toEqual({
      x: -W / 2 + CAP,
      y: 0,
      width: W - CAP * 2,
      height: H,
    });
  });

  it('the actor scales every number with the box height', () => {
    const full = participantShape('actor', W, H);
    const half = participantShape('actor', W, H / 2);
    full.parts.forEach((part, i) => {
      for (const [k, v] of Object.entries(part.attrs))
        expect(half.parts[i].attrs[k]).toBeCloseTo(v / 2);
    });
    expect(half.strokeWidth).toBe(1.25);
    expect(participantShape('actor', W, 10).strokeWidth).toBe(1.2);
  });
});
