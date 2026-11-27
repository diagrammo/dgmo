// boxplot-crowded-groups.test.ts — a box plot draws at most BOXPLOT_MAX_GROUPS
// groups, its group names never collide, and hovering a box prints its
// name on the axis (#2424).

import { describe, it, expect, afterEach } from 'vitest';
import { parseBoxplot } from '../src/data-chart-parser';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { attachDataChartInteractions } from '../src/charts-d3/interactions';
import { BOXPLOT_MAX_GROUPS } from '../src/charts-d3/boxplot-parse';
import { LABEL_ROTATE_DEG, TICK_FONT } from '../src/charts-d3/shared';
import { measureText } from '../src/utils/text-measure';

const CODE = 'E_BOXPLOT_TOO_MANY_GROUPS';
const NAME = (i: number) => `Group ${i} of the fleet`;
/** `n` groups of 12 values, each with one high outlier. */
const groups = (n: number, header = 'boxplot Fleet') =>
  [
    header,
    ...Array.from(
      { length: n },
      (_, i) =>
        `[${NAME(i)}]\n${Array.from({ length: 11 }, (_, k) => 10 + i + k).join(' ')} ${200 + i}`
    ),
  ].join('\n');

let host: HTMLDivElement | undefined;
let detach: { destroy: () => void } | undefined;
afterEach(() => {
  detach?.destroy();
  host?.remove();
  host = undefined;
  detach = undefined;
});

async function mount(src: string, width = 800, height = 500) {
  host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = await renderDataChartD3(src, 'light', undefined, {
    width,
    height,
  });
  const svg = host.querySelector('svg')!;
  detach = attachDataChartInteractions(svg, {});
  return svg;
}

/** The group-name texts drawn, with their anchor and rotation. */
function nameLabels(svg: SVGSVGElement) {
  return [...svg.querySelectorAll<SVGTextElement>('text.dgmo-tick')]
    .filter((t) => /^Group /.test(t.textContent ?? ''))
    .map((t) => {
      const tr = /translate\(([-\d.]+),([-\d.]+)\)/.exec(
        t.getAttribute('transform') ?? ''
      );
      return {
        text: t.textContent!,
        x: tr ? +tr[1]! : +t.getAttribute('x')!,
        y: tr ? +tr[2]! : +t.getAttribute('y')!,
        rotated: !!tr,
        anchor: t.getAttribute('text-anchor'),
      };
    });
}

/** Assert no two drawn names overlap along the group axis. */
function expectNoOverlap(labels: ReturnType<typeof nameLabels>) {
  const sorted = [...labels].sort((a, b) => a.x - b.x);
  const rad = (LABEL_ROTATE_DEG * Math.PI) / 180;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (a.rotated && b.rotated) {
      // Parallel slanted lines: their distance across the slant must hold
      // one line of text.
      expect((b.x - a.x) * Math.sin(rad)).toBeGreaterThanOrEqual(TICK_FONT);
    } else {
      const half = (l: typeof a) => measureText(l.text, TICK_FONT) / 2;
      expect(a.x + half(a)).toBeLessThanOrEqual(b.x - half(b));
    }
  }
}

describe('box plot group limit (#2424)', () => {
  it(`${BOXPLOT_MAX_GROUPS} groups raise nothing and draw every box`, async () => {
    const src = groups(BOXPLOT_MAX_GROUPS);
    const p = parseBoxplot(src);
    expect(p.diagnostics.filter((d) => d.code === CODE)).toEqual([]);
    expect(p.boxplotGroups).toHaveLength(BOXPLOT_MAX_GROUPS);
    const svg = await mount(src);
    expect(svg.querySelectorAll('.dgmo-boxplot-box')).toHaveLength(
      BOXPLOT_MAX_GROUPS
    );
  });

  it(`one past the limit draws ${BOXPLOT_MAX_GROUPS} and raises one error`, () => {
    const n = BOXPLOT_MAX_GROUPS + 1;
    const p = parseBoxplot(groups(n));
    const hits = p.diagnostics.filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('error');
    // Header line 1, then two lines per group: the first group left out
    // opens on line 2 + 2 × BOXPLOT_MAX_GROUPS.
    expect(hits[0]!.line).toBe(2 + 2 * BOXPLOT_MAX_GROUPS);
    expect(hits[0]!.message).toContain(`${n} groups`);
    expect(hits[0]!.message).toContain(`first ${BOXPLOT_MAX_GROUPS}`);
    expect(p.boxplotGroups).toHaveLength(BOXPLOT_MAX_GROUPS);
    expect(p.error).toBeFalsy();
  });

  it('80 groups: 50 boxes, one error naming the count, names never overlap', async () => {
    const src = groups(80);
    const p = parseBoxplot(src);
    const hits = p.diagnostics.filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('80 groups');
    const svg = await mount(src);
    expect(svg.querySelectorAll('.dgmo-boxplot-box')).toHaveLength(
      BOXPLOT_MAX_GROUPS
    );
    const labels = nameLabels(svg);
    expect(labels.length).toBeGreaterThan(1);
    expectNoOverlap(labels);
    // The n lines would collide: they move to the hover.
    expect(svg.querySelectorAll('.dgmo-boxplot-n')).toHaveLength(0);
  });

  for (const [w, n] of [
    [800, 14],
    [600, 8],
    [1200, 30],
  ] as const) {
    it(`${n} groups at ${w}px: names never overlap`, async () => {
      const svg = await mount(groups(n), w, 500);
      expectNoOverlap(nameLabels(svg));
    });
  }

  it('horizontal: crowded names thin to one per line', async () => {
    const svg = await mount(
      groups(BOXPLOT_MAX_GROUPS, 'boxplot Fleet\norientation-horizontal')
    );
    const ys = [...svg.querySelectorAll<SVGTextElement>('text.dgmo-tick')]
      .filter((t) => /^Group /.test(t.textContent ?? ''))
      .map((t) => +t.getAttribute('y')!)
      .sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThan(1);
    for (let i = 1; i < ys.length; i++)
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(TICK_FONT);
  });

  it('few groups keep their n lines under the names', async () => {
    const svg = await mount(groups(3));
    expect(svg.querySelectorAll('.dgmo-boxplot-n')).toHaveLength(3);
    expect(nameLabels(svg).every((l) => !l.rotated)).toBe(true);
  });
});

describe('box plot hover names the group (#2424)', () => {
  const hover = (el: Element) =>
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  const overlayText = (svg: SVGSVGElement) =>
    svg.querySelector('.dgmo-hover-layer')?.textContent ?? '';

  it('hovering a box, its whisker strip or an outlier prints its full name', async () => {
    const svg = await mount(groups(3));
    const g = svg.querySelectorAll('.dgmo-boxplot-group')[1]!;
    hover(g.querySelector('.dgmo-boxplot-box')!);
    expect(overlayText(svg)).toBe(NAME(1));
    // The other names recede.
    const ticks = [...svg.querySelectorAll('.dgmo-tick')];
    expect(ticks.every((t) => t.classList.contains('dgmo-faded'))).toBe(true);

    hover(svg); // leave the box
    hover(g.querySelector('.dgmo-datum-hit')!);
    expect(overlayText(svg)).toBe(NAME(1));

    hover(svg);
    hover(g.querySelector('.dgmo-boxplot-outlier')!);
    expect(overlayText(svg)).toBe(NAME(1));
  });

  it('a thinned name shows on hover, with n when n is hover-only', async () => {
    const svg = await mount(groups(80));
    const drawn = new Set(nameLabels(svg).map((l) => l.text));
    const boxes = [...svg.querySelectorAll('.dgmo-boxplot-box')];
    const i = boxes.findIndex((_, k) => !drawn.has(NAME(k)));
    expect(i).toBeGreaterThan(-1);
    hover(boxes[i]!);
    expect(overlayText(svg)).toBe(`${NAME(i)} · n = 12`);
  });
});
