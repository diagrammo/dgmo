import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { stepTrace } from '../src/charts-d3/line';
import { flattenTabular } from './helpers/tabular-text';
import { labelBox, type LabelAnchor } from '../src/utils/place-labels';
import { ANNOTATION_FONT } from '../src/annotations/draw';
import { segmentRectOverlap, type LabelRect } from '../src/label-layout';

// A step line's labels sat on its risers and on the other series (#2369):
// the obstacle trace joined points with diagonals the chart never draws.
// The extremes' filled dots also read as a second, unexplained kind of point,
// and a low the line ends on was printed twice.

const DUTY = `line Port Royal Duty on Rum
step
series
  Port Royal red
  Nassau blue
y-axis Pieces of eight per barrel

1718-01 4 3
1718-04 5 3
1718-06 7 4.5
1719-02 7.5 4.5
1720-08 6 3.5
1720-11 5.5 3
`;

type Seg = [number, number, number, number];

/** The drawn segments of an SVG path made only of M / L / H / V commands. */
function segments(d: string): Seg[] {
  const out: Seg[] = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHV])([^MLHVZ]*)/g)) {
    const n = args!.split(/[ ,]+/).filter(Boolean).map(Number);
    const [nx, ny] =
      cmd === 'H' ? [n[0]!, y] : cmd === 'V' ? [x, n[0]!] : [n[0]!, n[1]!];
    if (cmd !== 'M') out.push([x, y, nx, ny]);
    x = nx;
    y = ny;
  }
  return out;
}

const core = (r: LabelRect): LabelRect => ({ ...r, y: r.y + 1, h: r.h - 2 });

async function render() {
  const svg = flattenTabular(await renderDataChartD3(DUTY, 'light'));
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const num = (el: Element, a: string) => Number(el.getAttribute(a));
  const lines = Array.from(doc.querySelectorAll('path.dgmo-series-line')).map(
    (p) => segments(p.getAttribute('d')!)
  );
  const box = (t: Element, size: number) =>
    core(
      labelBox(
        t.textContent!,
        {
          x: num(t, 'x'),
          y: num(t, 'y'),
          anchor: t.getAttribute('text-anchor') as LabelAnchor,
        },
        size,
        true
      )
    );
  const values = Array.from(doc.querySelectorAll('text'))
    .filter(
      (t) => !t.getAttribute('class') && t.getAttribute('font-size') === '12'
    )
    .map((t) => ({ text: t.textContent!, box: box(t, 12) }));
  const extremes = Array.from(
    doc.querySelectorAll('text.dgmo-overlay-extremes-label')
  ).map((t) => ({ text: t.textContent!, box: box(t, ANNOTATION_FONT) }));
  return { doc, lines, values, extremes };
}

describe('step line labels (#2369)', () => {
  it('traces a step as drawn: hold, then rise', () => {
    const pts: [number, number][] = [
      [0, 10],
      [5, 20],
    ];
    expect(stepTrace(pts, 'after')).toEqual([
      [0, 10],
      [5, 10],
      [5, 20],
    ]);
    expect(stepTrace(pts, 'before')).toEqual([
      [0, 10],
      [0, 20],
      [5, 20],
    ]);
    expect(stepTrace(pts, undefined)).toEqual(pts);
  });

  it('no label prints over a riser or a tread of either series', async () => {
    const g = await render();
    expect(g.lines).toHaveLength(2);
    const labels = [...g.values, ...g.extremes];
    expect(labels.length).toBeGreaterThan(0);
    const onLine = labels
      .filter((l) =>
        g.lines
          .flat()
          .some(([x0, y0, x1, y1]) => segmentRectOverlap(x0, y0, x1, y1, l.box))
      )
      .map((l) => l.text);
    expect(onLine).toEqual([]);
  });

  it('a low the line ends on prints once, as the latest value', async () => {
    const g = await render();
    const texts = [...g.values, ...g.extremes].map((l) => l.text);
    expect(texts.filter((t) => t === '3')).toHaveLength(1);
  });

  it('marks an extreme with the same open ring as every other point', async () => {
    const { doc } = await render();
    const marks = Array.from(
      doc.querySelectorAll('circle.dgmo-extreme-high, circle.dgmo-extreme-low')
    );
    expect(marks.length).toBeGreaterThan(0);
    const point = doc.querySelector('circle.dgmo-pt')!;
    for (const m of marks) {
      expect(m.getAttribute('fill')).toBe(point.getAttribute('fill'));
      expect(m.getAttribute('r')).toBe(point.getAttribute('r'));
    }
  });
});
