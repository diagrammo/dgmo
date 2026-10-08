import { describe, expect, it } from 'vitest';

import {
  decodeInk,
  encodeInk,
  INK_DEFAULT_TOLERANCE,
  INK_PRESSURE_LEVELS,
  type InkPoint,
} from '../src/index';
import { parseWhiteboard } from '../src/whiteboard/parser';
import {
  prng,
  syntheticBoard,
  syntheticStroke,
} from './helpers/whiteboard-synth';

/** Distance from p to the polyline `line`. */
function distToPolyline(p: InkPoint, line: readonly InkPoint[]): number {
  if (line.length === 1) return Math.hypot(p.x - line[0]!.x, p.y - line[0]!.y);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)
          );
    best = Math.min(
      best,
      Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    );
  }
  return best;
}

// RDP tolerance plus the worst integer-rounding error (√0.5).
const MAX_ERR = INK_DEFAULT_TOLERANCE + Math.SQRT1_2 + 1e-9;

describe('whiteboard ink codec', () => {
  it('round-trips hand-like strokes within tolerance', () => {
    const rand = prng(7);
    for (let s = 0; s < 50; s++) {
      const pts = syntheticStroke(rand, false);
      const enc = encodeInk(pts);
      const dec = decodeInk(enc);
      expect(dec.error).toBeNull();
      expect(dec.points.length).toBeGreaterThan(1);
      expect(dec.points.length).toBeLessThanOrEqual(pts.length);
      for (const p of pts) {
        expect(distToPolyline(p, dec.points)).toBeLessThanOrEqual(MAX_ERR);
      }
      // Endpoints survive, rounded.
      expect(dec.points[0]).toEqual({
        x: Math.round(pts[0]!.x),
        y: Math.round(pts[0]!.y),
      });
      expect(dec.points.at(-1)).toEqual({
        x: Math.round(pts.at(-1)!.x),
        y: Math.round(pts.at(-1)!.y),
      });
    }
  });

  it('writes only base64url characters — fence- and line-safe', () => {
    const rand = prng(3);
    for (let s = 0; s < 20; s++) {
      expect(encodeInk(syntheticStroke(rand, s % 2 === 0))).toMatch(
        /^[A-Za-z0-9_-]+$/
      );
    }
  });

  it('carries pressure only when supplied, quantised', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 10, y: 5, pressure: 0.9 },
      { x: 20, y: -3, pressure: 0.5 },
    ];
    const withP = decodeInk(encodeInk(pts, { tolerance: 0 }));
    expect(withP.error).toBeNull();
    expect(withP.points).toHaveLength(3);
    withP.points.forEach((p, i) => {
      expect(p.pressure).toBeDefined();
      expect(Math.abs(p.pressure! - pts[i]!.pressure!)).toBeLessThanOrEqual(
        0.5 / INK_PRESSURE_LEVELS + 1e-9
      );
    });

    const noP = decodeInk(
      encodeInk(
        pts.map(({ x, y }) => ({ x, y })),
        { tolerance: 0 }
      )
    );
    expect(noP.points.every((p) => p.pressure === undefined)).toBe(true);
    // The pressure channel costs bytes only when present.
    expect(encodeInk(pts).length).toBeGreaterThan(
      encodeInk(pts.map(({ x, y }) => ({ x, y }))).length
    );
  });

  it('handles negative and large coordinates', () => {
    const pts = [
      { x: -50000, y: 123456 },
      { x: -49990, y: 123400 },
    ];
    expect(decodeInk(encodeInk(pts)).points).toEqual(pts);
  });

  it('encodes an empty stroke and a one-point stroke', () => {
    const empty = decodeInk(encodeInk([]));
    expect(empty.error).toBeNull();
    expect(empty.points).toEqual([]);

    const dot = decodeInk(encodeInk([{ x: 4.4, y: -2.6 }]));
    expect(dot.error).toBeNull();
    expect(dot.points).toEqual([{ x: 4, y: -3 }]);
  });

  it('drops consecutive duplicates after rounding', () => {
    const dec = decodeInk(
      encodeInk(
        [
          { x: 0, y: 0 },
          { x: 0.2, y: 0.1 },
          { x: 0.3, y: 0.2 },
          { x: 5, y: 5 },
        ],
        { tolerance: 0 }
      )
    );
    expect(dec.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it('reports corrupt input instead of throwing', () => {
    for (const bad of ['', '!!!', 'A', 'AAAAgA', '_____w', 'gICAgICAgICA']) {
      const r = decodeInk(bad);
      expect(r.error, bad).not.toBeNull();
      expect(r.points).toEqual([]);
    }
  });

  it('turns a corrupt payload into a parser warning, not a crash', () => {
    const parsed = parseWhiteboard(
      'whiteboard\nink red 3 !!!\nrectangle at: 0 0, size: 10 10'
    );
    expect(parsed.error).toBeNull();
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.diagnostics.map((d) => d.code)).toEqual([
      'W_WHITEBOARD_BAD_INK',
    ]);
  });

  it('keeps a realistic 200-stroke board under ~25 KB', () => {
    const board = syntheticBoard(200, (pts) => encodeInk(pts));
    const coarse = syntheticBoard(200, (pts) =>
      encodeInk(pts, { tolerance: 1 })
    );
    // Reported in the issue as the measured size of the format.
    console.warn(
      `[whiteboard] 200 strokes, ${board.rawPoints} raw points: ` +
        `${board.bytes} B at tolerance ${INK_DEFAULT_TOLERANCE}, ` +
        `${coarse.bytes} B at tolerance 1`
    );
    expect(board.bytes).toBeLessThanOrEqual(25 * 1024);
    const parsed = parseWhiteboard(board.source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.elements).toHaveLength(200);
  });
});
