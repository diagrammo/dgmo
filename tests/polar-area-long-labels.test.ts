// polar-area-long-labels.test.ts — no polar-area label leaves the canvas:
// the ring shrinks first, then labels wrap, then they are cut with `…`
// (#2458).
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { measureText } from '../src/utils/text-measure';
import { FULL_TEXT_ATTR } from '../src/utils/full-text';

const FONT = 13;

/** The owner's fixture: 30 wedges, each name about 30 characters. */
const longLabels = (
  n: number,
  name = (i: number) =>
    `Wedge label number ${String(i + 1).padStart(2, '0')} extended`
) =>
  [
    'polar-area Long wedge labels',
    '',
    ...Array.from({ length: n }, (_, i) => `${name(i)} ${((i * 37) % 60) + 3}`),
  ].join('\n');

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  text: string;
}

/** Every wedge label's box, in canvas coordinates. */
function labelBoxes(svg: string): {
  boxes: Box[];
  width: number;
  height: number;
} {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const width = Number(root.getAttribute('width'));
  const height = Number(root.getAttribute('height'));
  const boxes: Box[] = [];
  for (const g of Array.from(
    doc.querySelectorAll('g[transform^="translate("]')
  )) {
    if (!g.querySelector('path[data-line-number]')) continue;
    const [cx, cy] = g
      .getAttribute('transform')!
      .match(/translate\(([^,]+),([^)]+)\)/)!
      .slice(1)
      .map(Number) as [number, number];
    for (const t of Array.from(g.querySelectorAll(':scope > text'))) {
      const x = Number(t.getAttribute('x'));
      const y = Number(t.getAttribute('y'));
      const end = t.getAttribute('text-anchor') === 'end';
      const spans = Array.from(t.querySelectorAll('tspan'));
      const lines = spans.length
        ? spans.map((s) => s.textContent ?? '')
        : [t.textContent ?? ''];
      const dy = spans.reduce(
        (a, s) => a + Number(s.getAttribute('dy') ?? 0),
        0
      );
      const w = Math.max(...lines.map((l) => measureText(l, FONT)));
      boxes.push({
        x0: cx + (end ? x - w : x),
        x1: cx + (end ? x : x + w),
        y0: cy + y - FONT + 4,
        y1: cy + y + dy + 4,
        text: lines.join(' '),
      });
    }
  }
  return { boxes, width, height };
}

function expectInside(svg: string): Box[] {
  const { boxes, width, height } = labelBoxes(svg);
  expect(width).toBeGreaterThan(0);
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.x0, b.text).toBeGreaterThanOrEqual(0);
    expect(b.x1, b.text).toBeLessThanOrEqual(width);
    expect(b.y0, b.text).toBeGreaterThanOrEqual(0);
    expect(b.y1, b.text).toBeLessThanOrEqual(height);
  }
  return boxes;
}

describe('polar-area long labels', () => {
  it('the 30-wedge long-label fixture keeps every label on the canvas', async () => {
    expectInside(await renderDataChartD3(longLabels(30), 'light'));
  });

  it('at a narrow canvas the labels wrap and still stay on it', async () => {
    const svg = await renderDataChartD3(longLabels(24), 'light', undefined, {
      width: 600,
      height: 500,
    });
    expect(svg).toContain('<tspan');
    expectInside(svg);
  });

  it('a wrapped label keeps its value line whole', async () => {
    const svg = await renderDataChartD3(longLabels(24), 'light', undefined, {
      width: 600,
      height: 500,
    });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const wrapped = Array.from(doc.querySelectorAll('text')).filter((t) =>
      t.querySelector('tspan')
    );
    expect(wrapped.length).toBeGreaterThan(0);
    for (const t of wrapped) {
      const last = Array.from(t.querySelectorAll('tspan')).at(-1)!.textContent!;
      expect(last).toMatch(/^\d+ \(\d+%\)$/);
    }
  });

  it('a word too wide for any room is cut with … and keeps its full text', async () => {
    const giant = 'Supercalifragilisticexpialidocious'.repeat(4);
    const svg = await renderDataChartD3(
      longLabels(12, (i) => (i === 3 ? giant : `Short ${i}`)),
      'light',
      undefined,
      { width: 600, height: 500 }
    );
    const boxes = expectInside(svg);
    expect(boxes.some((b) => b.text.includes('…'))).toBe(true);
    expect(svg).toContain(`${FULL_TEXT_ATTR}="${giant} —`);
    expect(svg).not.toContain('<title');
  });

  it('crowded labels move apart instead of overprinting', async () => {
    const short = [
      'polar-area Many short wedges',
      '',
      ...Array.from({ length: 24 }, (_, i) => `W${i + 1} ${(i % 9) + 1}`),
    ].join('\n');
    for (const svg of [
      await renderDataChartD3(longLabels(30), 'light'),
      await renderDataChartD3(short, 'light'),
    ]) {
      const boxes = expectInside(svg);
      for (let a = 0; a < boxes.length; a++)
        for (let b = a + 1; b < boxes.length; b++) {
          const p = boxes[a]!;
          const q = boxes[b]!;
          const hit = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
          expect(hit, `${p.text} / ${q.text}`).toBe(false);
        }
    }
  });
});
