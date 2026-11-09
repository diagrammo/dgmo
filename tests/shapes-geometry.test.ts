import { describe, expect, it } from 'vitest';
import {
  cloudPath,
  cylinderPath,
  cylinderPieces,
  cylinderTopCap,
  diamondPoints,
  documentPath,
  documentPieces,
  documentWavePoints,
  parallelogramPoints,
  queueNearCapPath,
  queuePath,
  queuePieces,
} from '../src/shapes/geometry';

// The shapes module replaced per-chart copies (#1760). These pin the strings
// the copies wrote, centred, for a fractional width where a reordered
// expression would drift in the last bit.
const W = 137.37;
const H = 61.13;

describe('documentPath', () => {
  it('matches the flowchart document node, centred', () => {
    const wave = 10;
    const left = -W / 2;
    const right = W / 2;
    const top = -H / 2;
    const bottom = H / 2 - wave;
    const old = [
      `M ${left} ${top}`,
      `L ${right} ${top}`,
      `L ${right} ${bottom}`,
      `C ${right - W * 0.25} ${bottom + wave * 2}, ${left + W * 0.25} ${bottom - wave}, ${left} ${bottom}`,
      'Z',
    ].join(' ');
    expect(documentPath(-W / 2, -H / 2, W, H, wave)).toBe(old);
  });

  it('samples the same cubic it draws, ending on both corners', () => {
    const pts = documentWavePoints(0, 0, 100, 40, 10);
    expect(pts[0]).toEqual({ x: 100, y: 30 });
    expect(pts.at(-1)).toEqual({ x: 0, y: 30 });
  });

  it('has pieces that cover the body and stop at the wave', () => {
    const pieces = documentPieces(0, 0, 100, 40, 10);
    expect(pieces[0]).toMatchObject({ kind: 'rect', x0: 0, y0: 0, x1: 100 });
    expect(pieces.length).toBeGreaterThan(1);
  });
});

describe('cylinder', () => {
  it('matches the c4 cylinder card, centred', () => {
    const ry = 8;
    const old = [
      `M ${-W / 2} ${-H / 2 + ry}`,
      `A ${W / 2} ${ry} 0 0 1 ${W / 2} ${-H / 2 + ry}`,
      `L ${W / 2} ${H / 2 - ry}`,
      `A ${W / 2} ${ry} 0 0 1 ${-W / 2} ${H / 2 - ry}`,
      'Z',
    ].join(' ');
    expect(cylinderPath(-W / 2, -H / 2, W, H, ry)).toBe(old);
    expect(cylinderTopCap(-W / 2, -H / 2, W, ry)).toEqual({
      cx: 0,
      cy: -H / 2 + ry,
      rx: W / 2,
      ry,
    });
  });

  it('is a body plus two caps', () => {
    expect(cylinderPieces(0, 0, 100, 60, 8).map((p) => p.kind)).toEqual([
      'rect',
      'ellipse',
      'ellipse',
    ]);
  });
});

describe('queue', () => {
  it('matches the c4 queue card, centred', () => {
    const cap = 16;
    const xL = -W / 2 + cap;
    const xR = W / 2 - cap;
    const ry = H / 2;
    const old = [
      `M ${xL} ${-ry}`,
      `L ${xR} ${-ry}`,
      `A ${cap} ${ry} 0 0 1 ${xR} ${ry}`,
      `L ${xL} ${ry}`,
      `A ${cap} ${ry} 0 0 1 ${xL} ${-ry}`,
      'Z',
    ].join(' ');
    expect(queuePath(-W / 2, -H / 2, W, H, cap)).toBe(old);
    expect(queueNearCapPath(-W / 2, -H / 2, H, cap)).toBe(
      `M ${xL} ${-ry} A ${cap} ${ry} 0 0 1 ${xL} ${ry}`
    );
  });

  it('is a body plus two caps', () => {
    expect(queuePieces(0, 0, 100, 40, 16).map((p) => p.kind)).toEqual([
      'rect',
      'ellipse',
      'ellipse',
    ]);
  });
});

describe('diamondPoints', () => {
  it('matches the flowchart decision node, centred', () => {
    const w = W / 2;
    const h = H / 2;
    expect(diamondPoints(0, 0, w, h)).toBe(
      [`${0},${-h}`, `${w},${0}`, `${0},${h}`, `${-w},${0}`].join(' ')
    );
  });

  it('matches the class marker, anchored at its top-left', () => {
    const DW = 12;
    const DH = 8;
    expect(diamondPoints(DW / 2, DH / 2, DW / 2, DH / 2)).toBe(
      `${DW / 2},0 ${DW},${DH / 2} ${DW / 2},${DH} 0,${DH / 2}`
    );
  });
});

describe('parallelogramPoints', () => {
  it('matches the flowchart io node, centred', () => {
    const w = W / 2;
    const h = H / 2;
    const sk = 15;
    expect(parallelogramPoints(0, 0, w, h, sk)).toBe(
      [
        `${-w + sk},${-h}`,
        `${w + sk},${-h}`,
        `${w - sk},${h}`,
        `${-w - sk},${h}`,
      ].join(' ')
    );
  });
});

describe('cloudPath', () => {
  it('starts and ends on the inset top-left corner, inside the box', () => {
    const d = cloudPath(-W / 2, -H / 2, W, H, 7);
    expect(d.startsWith(`M ${-W / 2 + 7} ${-H / 2 + 7} A`)).toBe(true);
    expect(d.endsWith(`${-W / 2 + 7} ${-H / 2 + 7} Z`)).toBe(true);
    expect(d.match(/A /g)).toHaveLength(8);
  });
});
