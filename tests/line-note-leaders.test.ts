// A line chart's note leaders cross no other leader, no other note's text
// and no high/low value label (#2385). The fixture is the reporter's source,
// byte for byte: a label's length is what makes the crossing appear.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';
import { NOTE_FONT } from '../src/annotations/notes';
import { segmentRectOverlap, segmentsCross } from '../src/label-layout';
import { measureText } from '../src/utils/text-measure';
import { ANNOTATION_FONT } from '../src/annotations/draw';

const palette = getPalette('nord').light;
const src = readFileSync(
  join(__dirname, 'fixtures', 'line-notes-2385.dgmo'),
  'utf8'
);

type Box = { x: number; y: number; w: number; h: number };
type Seg = readonly [number, number, number, number];

function geometry(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const num = (e: Element, a: string) => Number(e.getAttribute(a));
  const notes = [...doc.querySelectorAll('g.dgmo-chart-note')].map((g) => {
    const texts = [...g.querySelectorAll('text')];
    const xs = texts.map((t) => num(t, 'x'));
    const ys = texts.map((t) => num(t, 'y'));
    const box: Box = {
      x: Math.min(...xs),
      y: Math.min(...ys) - NOTE_FONT * 0.95,
      w: Math.max(
        ...texts.map((t) => measureText(t.textContent ?? '', NOTE_FONT))
      ),
      h: Math.max(...ys) - Math.min(...ys) + NOTE_FONT * 1.3,
    };
    const l = g.querySelector('line.dgmo-chart-note-leader');
    const leader: Seg | null = l
      ? [num(l, 'x1'), num(l, 'y1'), num(l, 'x2'), num(l, 'y2')]
      : null;
    return { box, leader, text: texts.map((t) => t.textContent).join(' ') };
  });
  const values: Box[] = [
    ...doc.querySelectorAll('text.dgmo-overlay-extremes-label'),
  ].map((t) => {
    const w = measureText(t.textContent ?? '', ANNOTATION_FONT, {
      bold: true,
    });
    const a = t.getAttribute('text-anchor');
    const x = num(t, 'x') - (a === 'end' ? w : a === 'middle' ? w / 2 : 0);
    return { x, y: num(t, 'y') - ANNOTATION_FONT, w, h: ANNOTATION_FONT + 2 };
  });
  return { notes, values };
}

/** Every crossing a note's leader makes, described. */
function crossings(svg: string): string[] {
  const { notes, values } = geometry(svg);
  const out: string[] = [];
  notes.forEach(({ leader, text }, i) => {
    if (!leader) return;
    notes.forEach((o, j) => {
      if (j === i) return;
      if (o.leader && j > i && segmentsCross(...leader, ...o.leader))
        out.push(`"${text}" leader × "${o.text}" leader`);
      if (segmentRectOverlap(...leader, o.box))
        out.push(`"${text}" leader × "${o.text}" text`);
    });
    for (const v of values)
      if (segmentRectOverlap(...leader, v))
        out.push(`"${text}" leader × value label at ${v.x},${v.y}`);
  });
  return out;
}

describe('line note leaders (#2385)', () => {
  // The four sizes that crossed before the fix, then four that did not.
  const sizes = [
    [786, 500],
    [786, 600],
    [1000, 600],
    [1200, 800],
    [786, 400],
    [786, 700],
    [786, 900],
    [600, 450],
  ] as const;
  for (const [width, height] of sizes)
    it(`no leader crosses a leader, a note or a value label at ${width}×${height}`, async () => {
      const svg = await renderDataChartD3(src, 'light', palette, {
        width,
        height,
      });
      const { notes, values } = geometry(svg);
      // Every note is still drawn, and the high value label is there.
      expect(notes).toHaveLength(9);
      expect(values.length).toBeGreaterThan(0);
      expect(crossings(svg)).toEqual([]);
    });
});
