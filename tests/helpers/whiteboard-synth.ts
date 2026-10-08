// Deterministic synthetic hand-drawn strokes for the whiteboard ink tests.
//
// Each stroke is what a pointer reports at ~60 Hz while a hand writes: a
// smoothly turning path (curvature drifts, so loops and S-bends happen), speed
// that rises and falls, 2-6 px between samples, and sub-pixel jitter on every
// coordinate. 30-150 raw points per stroke.

import type { InkPoint } from '../../src/whiteboard/ink-codec';

/** mulberry32 — a small seeded PRNG so every run measures the same board. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticStroke(
  rand: () => number,
  withPressure: boolean
): InkPoint[] {
  const n = 30 + Math.floor(rand() * 121);
  let x = rand() * 1600 - 400;
  let y = rand() * 1000 - 200;
  let heading = rand() * Math.PI * 2;
  let curvature = (rand() - 0.5) * 0.3;
  let pressure = 0.3 + rand() * 0.4;
  const pts: InkPoint[] = [];
  for (let i = 0; i < n; i++) {
    const phase = i / n;
    const speed = 2 + 4 * Math.sin(Math.PI * phase) * (0.6 + rand() * 0.4);
    curvature += (rand() - 0.5) * 0.08;
    curvature = Math.max(-0.35, Math.min(0.35, curvature));
    heading += curvature;
    x += Math.cos(heading) * speed;
    y += Math.sin(heading) * speed;
    pressure = Math.max(0.05, Math.min(1, pressure + (rand() - 0.5) * 0.08));
    const jx = (rand() - 0.5) * 0.6;
    const jy = (rand() - 0.5) * 0.6;
    pts.push(
      withPressure
        ? { x: x + jx, y: y + jy, pressure }
        : { x: x + jx, y: y + jy }
    );
  }
  return pts;
}

const COLORS = ['ink', 'ink', 'ink', 'red', 'blue', 'green', 'purple'];
const WIDTHS = ['2', '2.5', '3', '4', '6'];

/** A whiteboard source holding `count` ink strokes, plus its byte size. */
export function syntheticBoard(
  count: number,
  encode: (pts: InkPoint[]) => string,
  seed = 1138
): { source: string; bytes: number; rawPoints: number } {
  const rand = prng(seed);
  const lines = ['whiteboard Synthetic ink'];
  let rawPoints = 0;
  for (let i = 0; i < count; i++) {
    // Roughly a third of strokes come from a pressure-reporting pen.
    const pts = syntheticStroke(rand, rand() < 0.33);
    rawPoints += pts.length;
    const color = COLORS[Math.floor(rand() * COLORS.length)]!;
    const width = WIDTHS[Math.floor(rand() * WIDTHS.length)]!;
    lines.push(`ink ${color} ${width} ${encode(pts)}`);
  }
  const source = lines.join('\n') + '\n';
  return { source, bytes: Buffer.byteLength(source, 'utf8'), rawPoints };
}
