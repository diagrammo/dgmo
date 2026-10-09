import { describe, expect, it } from 'vitest';

import * as advanced from '../src/advanced';
import { getPalette } from '../src/palettes';
import { CYLINDER_RY, QUEUE_CAP } from '../src/c4/renderer';
import {
  clipWhiteboardConnector,
  whiteboardConnectorAttachments,
  whiteboardShapeAt,
  whiteboardShapeContains,
} from '../src/whiteboard/geometry';
import { parseWhiteboard } from '../src/whiteboard/parser';
import { renderWhiteboard, whiteboardBounds } from '../src/whiteboard/renderer';
import type {
  WhiteboardArrow,
  WhiteboardElement,
  WhiteboardShape,
} from '../src/whiteboard/types';

function board(...lines: string[]): readonly WhiteboardElement[] {
  const parsed = parseWhiteboard(['whiteboard', ...lines].join('\n'));
  expect(parsed.diagnostics).toEqual([]);
  return parsed.elements;
}

/** Clip the LAST element, which must be an arrow or line. */
function clip(...lines: string[]) {
  const els = board(...lines);
  const c = els[els.length - 1] as WhiteboardArrow;
  return clipWhiteboardConnector(c, els);
}

function draw(src: string): SVGSVGElement {
  const pal = getPalette('nord').light;
  const el = document.createElement('div');
  renderWhiteboard(el, parseWhiteboard(src, pal), pal, false);
  return el.querySelector('svg')!;
}

describe('whiteboard connector geometry', () => {
  it('is exported from @diagrammo/dgmo/advanced', () => {
    expect(advanced.clipWhiteboardConnector).toBe(clipWhiteboardConnector);
    expect(advanced.whiteboardShapeAt).toBe(whiteboardShapeAt);
    expect(advanced.whiteboardShapeContains).toBe(whiteboardShapeContains);
    expect(advanced.whiteboardConnectorAttachments).toBe(
      whiteboardConnectorAttachments
    );
  });

  it('leaves a free connector exactly as stored', () => {
    expect(
      clip('rectangle at: 0 0, size: 100 100', 'arrow from: 200 0, to: 300 0')
    ).toEqual({ x1: 200, y1: 0, x2: 300, y2: 0 });
  });

  it('clips at a rectangle edge, and at its rounded corner', () => {
    const r = 'rectangle at: 100 0, size: 100 100';
    expect(clip(r, 'arrow from: 0 50, to: 150 50')).toEqual({
      x1: 0,
      y1: 50,
      x2: 100,
      y2: 50,
    });
    // Toward the corner the ray meets the 6px rounding, not the box corner.
    const s = clip(r, 'line from: 50 -50, to: 150 50');
    const corner = 6 - 6 / Math.SQRT2; // the arc's 45° point, inset per axis
    expect(s.x2).toBeCloseTo(100 + corner);
    expect(s.y2).toBeCloseTo(corner);
  });

  it('clips exactly at an ellipse', () => {
    const e = 'ellipse at: 0 0, size: 200 100'; // centre 100 50, rx 100, ry 50
    const s = clip(e, 'arrow from: 300 50, to: 100 50');
    expect(s.x2).toBeCloseTo(200);
    expect(s.y2).toBeCloseTo(50);
    const d = clip(e, 'arrow from: 300 250, to: 100 50');
    // The clipped point lies on the ellipse.
    expect(((d.x2 - 100) / 100) ** 2 + ((d.y2 - 50) / 50) ** 2).toBeCloseTo(1);
  });

  it('clips a database at its curved cap, as drawn', () => {
    // Straight down onto the top cap's crown: the outline reaches y = 0 at
    // the centre, but only y = ry at the side.
    const db = 'database at: 0 0, size: 100 80';
    expect(clip(db, 'arrow from: 50 -100, to: 50 40').y2).toBeCloseTo(0);
    // Aimed at the centre (50 40) from off to one side: lands on the cap.
    const c = clip(db, 'arrow from: 10 -200, to: 20 60');
    expect(c.y2).toBeGreaterThan(0);
    expect(c.y2).toBeLessThan(CYLINDER_RY);
    expect(
      ((c.x2 - 50) / 50) ** 2 + ((c.y2 - CYLINDER_RY) / CYLINDER_RY) ** 2
    ).toBeCloseTo(1);
    // Flat side.
    expect(clip(db, 'arrow from: -100 40, to: 50 40').x2).toBeCloseTo(0);
  });

  it('clips a queue at its rounded end cap, as drawn', () => {
    const q = 'queue at: 0 0, size: 200 60'; // caps centred x 16 and 184
    expect(clip(q, 'arrow from: -100 30, to: 100 30').x2).toBeCloseTo(0);
    // Off-centre the cap curves away from the box edge.
    const s = clip(q, 'arrow from: -100 5, to: 100 5');
    expect(s.x2).toBeGreaterThan(0);
    expect(
      ((s.x2 - QUEUE_CAP) / QUEUE_CAP) ** 2 + ((s.y2 - 30) / 30) ** 2
    ).toBeCloseTo(1);
    // The flat top.
    expect(clip(q, 'arrow from: 100 -50, to: 100 30').y2).toBeCloseTo(0);
  });

  it('clips both ends, each against its own shape', () => {
    expect(
      clip(
        'rectangle at: 0 0, size: 100 100',
        'rectangle at: 300 0, size: 100 100',
        'line from: 50 50, to: 350 50'
      )
    ).toEqual({ x1: 100, y1: 50, x2: 300, y2: 50 });
  });

  it('aims attached ends at their shapes’ centres, not the stored points', () => {
    // Ends dropped near facing corners: the drawn line still runs centre to
    // centre, clipped at each border.
    const s = clip(
      'rectangle at: 0 0, size: 100 100',
      'rectangle at: 300 200, size: 100 100',
      'arrow from: 90 90, to: 310 210'
    );
    expect(s.x1).toBeCloseTo(100);
    expect(s.y1).toBeCloseTo(50 + 200 / 6);
    expect(s.x2).toBeCloseTo(300);
    expect(s.y2).toBeCloseTo(250 - 200 / 6);
    // A free tail keeps its stored point; only the head is aimed.
    const t = clip(
      'rectangle at: 300 0, size: 100 100',
      'arrow from: 0 50, to: 390 10'
    );
    expect(t).toEqual({ x1: 0, y1: 50, x2: 300, y2: 50 });
  });

  it('attaches to the topmost shape — the later one in the file', () => {
    const els = board(
      'rectangle at: 100 0, size: 200 100',
      'ellipse at: 150 0, size: 100 100',
      'arrow from: 0 50, to: 200 50'
    );
    expect(whiteboardShapeAt({ x: 200, y: 50 }, els)).toBe(1);
    expect(whiteboardShapeAt({ x: 110, y: 50 }, els)).toBe(0);
    expect(whiteboardShapeAt({ x: 500, y: 50 }, els)).toBe(-1);
    expect(
      clipWhiteboardConnector(els[2] as WhiteboardArrow, els).x2
    ).toBeCloseTo(150);
  });

  it('does not clip when both ends are inside the same shape', () => {
    const els = board(
      'rectangle at: 0 0, size: 200 100',
      'arrow from: 20 50, to: 180 50'
    );
    expect(
      whiteboardConnectorAttachments(els[1] as WhiteboardArrow, els)
    ).toEqual({ from: -1, to: -1 });
    expect(clipWhiteboardConnector(els[1] as WhiteboardArrow, els)).toEqual({
      x1: 20,
      y1: 50,
      x2: 180,
      y2: 50,
    });
  });

  it('clips only the end whose shape the other end is not in', () => {
    // A small box inside a big one: the end in the small box attaches to it;
    // the end in the big box stays free, since the other end is in it too.
    const els = board(
      'rectangle at: 0 0, size: 400 200',
      'rectangle at: 20 20, size: 100 100',
      'arrow from: 70 70, to: 300 70'
    );
    const a = els[2] as WhiteboardArrow;
    expect(whiteboardConnectorAttachments(a, els)).toEqual({ from: 1, to: -1 });
    expect(clipWhiteboardConnector(a, els)).toEqual({
      x1: 120,
      y1: 70,
      x2: 300,
      y2: 70,
    });
  });

  it('falls back to the stored segment when clipping would collapse it', () => {
    // Two overlapping shapes, one end in each, the ends inside the overlap
    // of the other's outline along the segment.
    expect(
      clip(
        'rectangle at: 0 0, size: 100 100',
        'rectangle at: 60 0, size: 100 100',
        'arrow from: 40 50, to: 120 50'
      )
    ).toEqual({ x1: 40, y1: 50, x2: 120, y2: 50 });
    // Zero length.
    expect(
      clip('rectangle at: 0 0, size: 100 100', 'arrow from: 50 50, to: 50 50')
    ).toEqual({ x1: 50, y1: 50, x2: 50, y2: 50 });
  });

  it('containment follows the real outline, not the box', () => {
    const [e] = board('ellipse at: 0 0, size: 100 100') as WhiteboardShape[];
    expect(whiteboardShapeContains(e!, { x: 50, y: 50 })).toBe(true);
    expect(whiteboardShapeContains(e!, { x: 3, y: 3 })).toBe(false);
  });
});

describe('whiteboard renderer — attached ends', () => {
  it('puts an arrowhead tip on the border', () => {
    const svg = draw(
      'whiteboard\nrectangle at: 200 0, size: 100 100\narrow from: 0 50, to: 250 50'
    );
    const tip = svg
      .querySelector('.whiteboard-arrow polygon')!
      .getAttribute('points')!
      .split(' ')[0];
    expect(tip).toBe('200,50');
    // The shaft stops a head length short of the border.
    expect(
      svg.querySelector('.whiteboard-arrow line')!.getAttribute('x2')
    ).toBe(String(200 - 12));
  });

  it('runs a plain line to the edge, dashed style intact', () => {
    const svg = draw(
      'whiteboard\nellipse at: 200 0, size: 100 100\nline from: 0 50, to: 250 50, style: dashed'
    );
    const line = svg.querySelector('.whiteboard-line line')!;
    expect(line.getAttribute('x2')).toBe('200');
    expect(line.hasAttribute('stroke-dasharray')).toBe(true);
  });

  it('centres the label on the CLIPPED segment', () => {
    const svg = draw(
      [
        'whiteboard',
        'rectangle at: 0 0, size: 100 100',
        'rectangle at: 300 0, size: 100 100',
        'arrow go from: 0 50, to: 400 50',
      ].join('\n')
    );
    expect(
      svg
        .querySelector('.whiteboard-arrow .whiteboard-label')!
        .getAttribute('x')
    ).toBe('200');
    // Unclipped it would also be 200 — so check an asymmetric case.
    const asym = draw(
      [
        'whiteboard',
        'rectangle at: 300 0, size: 200 100',
        'arrow go from: 0 50, to: 500 50',
      ].join('\n')
    );
    expect(
      asym
        .querySelector('.whiteboard-arrow .whiteboard-label')!
        .getAttribute('x')
    ).toBe('150');
  });

  it('crops to the drawn geometry, not the stored point', () => {
    // A stored end far inside a big shape adds nothing past the shape; only
    // the clipped segment counts. Compare against the same board with the
    // arrow stopping at the border by hand.
    const attached = whiteboardBounds(
      parseWhiteboard(
        'whiteboard\nrectangle at: 0 0, size: 50 50\narrow go from: -300 25, to: 25 25'
      )
    );
    const byHand = whiteboardBounds(
      parseWhiteboard(
        'whiteboard\nrectangle at: 0 0, size: 50 50\narrow go from: -300 25, to: 0 25'
      )
    );
    expect(attached).toEqual(byHand);
  });
});
