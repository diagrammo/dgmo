import { describe, it, expect } from 'vitest';
import { rectsOverlap } from '../src/label-layout';
import type { LabelRect } from '../src/label-layout';
import {
  DOT_LABEL_GAP,
  dotLabelFits,
  dotLabelRect,
  placeDotLabel,
} from '../src/map/dot-labels';
import type { LabelDot, LabelSegment } from '../src/map/dot-labels';

// Hand-made dots on a bare 400×300 canvas: no map, no projection, no basemap.
const W = 400;
const H = 300;
const dot: LabelDot = { id: 'a', cx: 200, cy: 150, r: 4 };
const LW = 40;
const LH = 15;

function place(
  over: Partial<Parameters<typeof placeDotLabel>[0]> = {}
): ReturnType<typeof placeDotLabel> {
  return placeDotLabel({
    dot,
    w: LW,
    h: LH,
    width: W,
    height: H,
    collides: () => false,
    dots: [dot],
    segments: [],
    openness: () => 0,
    ...over,
  });
}

describe('dotLabelRect', () => {
  it('seats a cardinal label one gap off the rim, centred on the other axis', () => {
    const off = dot.r + DOT_LABEL_GAP;
    expect(dotLabelRect(dot, LW, LH, 'right')).toEqual({
      x: dot.cx + off,
      y: dot.cy - LH / 2,
      w: LW,
      h: LH,
    });
    expect(dotLabelRect(dot, LW, LH, 'left').x).toBe(dot.cx - off - LW);
    expect(dotLabelRect(dot, LW, LH, 'above')).toMatchObject({
      x: dot.cx - LW / 2,
      y: dot.cy - off - LH,
    });
    expect(dotLabelRect(dot, LW, LH, 'below').y).toBe(dot.cy + off);
  });

  it('pulls a diagonal label in by (r + gap)/√2 on both axes', () => {
    const d = (dot.r + DOT_LABEL_GAP) * 0.7071;
    expect(dotLabelRect(dot, LW, LH, 'above-left')).toEqual({
      x: dot.cx - d - LW,
      y: dot.cy - d - LH,
      w: LW,
      h: LH,
    });
  });
});

describe('dotLabelFits', () => {
  const rect: LabelRect = { x: 10, y: 10, w: 20, h: 10 };
  it('accepts an on-canvas rect that hits nothing', () => {
    expect(dotLabelFits(rect, W, H, () => false)).toBe(true);
  });
  it('refuses a rect past any canvas edge, or one that collides', () => {
    expect(dotLabelFits({ ...rect, x: -1 }, W, H, () => false)).toBe(false);
    expect(dotLabelFits({ ...rect, x: W - 19 }, W, H, () => false)).toBe(false);
    expect(dotLabelFits({ ...rect, y: H - 9 }, W, H, () => false)).toBe(false);
    expect(dotLabelFits(rect, W, H, () => true)).toBe(false);
  });
});

describe('placeDotLabel', () => {
  it('puts a lone dot in open space on its right flank', () => {
    expect(place()?.side).toBe('right');
  });

  it('flips to the left when the right flank runs off the canvas', () => {
    const edge: LabelDot = { id: 'e', cx: W - 10, cy: 150, r: 4 };
    expect(place({ dot: edge, dots: [edge] })?.side).toBe('left');
  });

  it('goes above when both flanks are blocked', () => {
    // Two obstacles hugging the flanks, clear of the slots above and below.
    const off = dot.r + DOT_LABEL_GAP;
    const blocks: LabelRect[] = [
      { x: dot.cx + off, y: dot.cy - 2, w: LW, h: 4 },
      { x: dot.cx - off - LW, y: dot.cy - 2, w: LW, h: 4 },
    ];
    const collides = (r: LabelRect): boolean =>
      blocks.some((b) => rectsOverlap(r, b));
    expect(place({ collides })?.side).toBe('above');
  });

  it('runs its label away from a neighbouring dot', () => {
    const near: LabelDot = { id: 'b', cx: 260, cy: 150, r: 4 };
    expect(place({ dots: [dot, near] })?.side).toBe('left');
  });

  it('ignores its own dot when measuring clearance', () => {
    expect(place({ dots: [dot] })?.side).toBe('right');
  });

  it('runs its label away from a connector', () => {
    const leg: LabelSegment = [215, 0, 215, H];
    expect(place({ segments: [leg] })?.side).toBe('left');
  });

  it('prefers the water-facing flank over the land-facing one', () => {
    const westIsWater = (r: LabelRect): number =>
      r.x + r.w <= dot.cx ? 1000 : 0;
    expect(place({ openness: westIsWater })?.side).toBe('left');
  });

  it('returns the rect it chose', () => {
    expect(place()?.rect).toEqual(dotLabelRect(dot, LW, LH, 'right'));
  });

  it('returns null when every slot collides', () => {
    expect(place({ collides: () => true })).toBeNull();
  });
});
