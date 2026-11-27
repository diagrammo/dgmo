// Scatter with 150-character labels (#2464): no point label or axis title may
// leave the canvas or touch another label, a point, an axis or a tick.
// Point labels move to a side with room, wrap to two lines, then end in `…`;
// axis titles wrap to two lines along their axis, then end in `…`.
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';
import { svgTextBoxes } from './stress/lint';

const palette = getPalette('nord').light;

const LONG = (lead: string) =>
  `${lead} ${'with a great many words that keep on going well past any sensible length '.repeat(2)}`
    .slice(0, 150)
    .trim();

// The owner's pressure file (scatter-pressure-08-break-long-labels), rebuilt
// inline: long title, axis titles, category and three point names.
const FIXTURE = `scatter ${LONG('Title')}
x-axis ${LONG('Horizontal axis title')}
y-axis ${LONG('Vertical axis title')}

[${LONG('Category')}] blue
  ${LONG('Point label')} 10 20
  ${LONG('Another')} 50 55
  Short 30 35
  ${LONG('Third long point')} 90 80`;

async function render(src: string) {
  const svg = await renderDataChartD3(src, 'light', palette, {
    width: 800,
    height: 500,
  });
  return svg;
}

type Box = ReturnType<typeof svgTextBoxes>[number];

/** Strict: any shared area, beyond rounding, is a collision. */
const EPS = 0.5;
const intersects = (a: Box, b: Box) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > EPS &&
  Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > EPS;
const hitsCircle = (b: Box, cx: number, cy: number, r: number) => {
  const nx = Math.max(b.x0, Math.min(cx, b.x1));
  const ny = Math.max(b.y0, Math.min(cy, b.y1));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < (r - EPS) ** 2;
};
const name = (b: Box) => JSON.stringify(b.text.slice(0, 24));

function collisions(svg: string): string[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const [vx, vy, vw, vh] = doc.documentElement
    .getAttribute('viewBox')!
    .split(/[\s,]+/)
    .map(Number);
  const boxes = svgTextBoxes(svg);
  const out: string[] = [];
  for (const b of boxes)
    if (
      b.x0 < vx! - EPS ||
      b.y0 < vy! - EPS ||
      b.x1 > vx! + vw! + EPS ||
      b.y1 > vy! + vh! + EPS
    )
      out.push(`${name(b)} leaves the canvas`);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (intersects(boxes[i]!, boxes[j]!))
        out.push(`${name(boxes[i]!)} hits ${name(boxes[j]!)}`);
  for (const c of Array.from(
    doc.querySelectorAll('circle[data-line-number]')
  )) {
    const [cx, cy, r] = ['cx', 'cy', 'r'].map((a) => Number(c.getAttribute(a)));
    for (const b of boxes)
      if (hitsCircle(b, cx!, cy!, r!)) out.push(`${name(b)} hits a point`);
  }
  return out;
}

describe('scatter long labels (#2464)', () => {
  it('keeps every text box on the canvas and clear of text and points', async () => {
    expect(collisions(await render(FIXTURE))).toEqual([]);
  });

  it('wraps a long point label to two lines, cuts it with an ellipsis and keeps the full name', async () => {
    const svg = await render(FIXTURE);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const labels = Array.from(doc.querySelectorAll('text.dgmo-ptlabel'));
    const long = labels.find((t) => t.textContent!.startsWith('Another'))!;
    const lines = Array.from(long.querySelectorAll('tspan'));
    expect(lines).toHaveLength(2);
    expect(lines[1]!.textContent!.endsWith('…')).toBe(true);
    expect(long.getAttribute('data-full-text')).toBe(LONG('Another'));
    expect(long.querySelector('title')).toBeNull();
    const short = labels.find((t) => t.textContent === 'Short')!;
    expect(short.querySelector('tspan')).toBeNull();
    expect(short.hasAttribute('data-full-text')).toBe(false);
  });

  it('wraps a long x-axis title to two lines, then cuts it, keeping the full text', async () => {
    const svg = await render(FIXTURE);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const title = Array.from(doc.querySelectorAll('text')).find((t) =>
      t.textContent!.startsWith('Horizontal')
    )!;
    // 150 characters fit in two lines of the plot's width: wrapped, not cut.
    expect(title.querySelectorAll('tspan')).toHaveLength(2);
    expect(title.hasAttribute('data-full-text')).toBe(false);

    const huge = LONG('Horizontal').repeat(3);
    const cut = await render(FIXTURE.replace(/^x-axis .*$/m, `x-axis ${huge}`));
    expect(collisions(cut)).toEqual([]);
    const cdoc = new DOMParser().parseFromString(cut, 'image/svg+xml');
    const ct = Array.from(cdoc.querySelectorAll('text')).find(
      (t) => t.getAttribute('data-full-text') === huge
    )!;
    const lines = Array.from(ct.querySelectorAll('tspan'));
    expect(lines).toHaveLength(2);
    expect(lines[1]!.textContent!.endsWith('…')).toBe(true);
    expect(ct.querySelector('title')).toBeNull();
  });

  it('leaves short labels on one line', async () => {
    const svg = await render(`scatter Small
x-axis Width
y-axis Height

A 10 20
B 50 55`);
    expect(collisions(svg)).toEqual([]);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelectorAll('text.dgmo-ptlabel tspan')).toHaveLength(0);
    expect(svg).not.toContain('data-full-text');
  });
});
