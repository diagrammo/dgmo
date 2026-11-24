// venn `proportional` (#1992): circle and overlap areas follow `size:`, and
// leader lines run outside every circle in both layouts.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { parseVisualization, renderVenn } from '../src/d3';
import { getPalette } from '../src/palettes';
import {
  distanceForOverlap,
  intersectionArea,
  lensArea,
  proportionalLayout,
} from '../src/venn/layout';

beforeAll(() => {
  const win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;
  for (const key of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? win : (win as never)[key],
      configurable: true,
    });
  }
});

const palette = getPalette('nord').light;
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

type C = { x: number; y: number; r: number };
type Seg = { x1: number; y1: number; x2: number; y2: number; text: string };

function render(source: string, dims = { width: 1000, height: 700 }) {
  const parsed = parseVisualization(source, palette);
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: dims.width });
  Object.defineProperty(container, 'clientHeight', { value: dims.height });
  document.body.appendChild(container);
  renderVenn(container, parsed as never, palette, false, undefined, dims);
  const circles: C[] = Array.from(
    container.querySelectorAll('circle[fill-opacity]')
  ).map((el) => ({
    x: Number(el.getAttribute('cx')),
    y: Number(el.getAttribute('cy')),
    r: Number(el.getAttribute('r')),
  }));
  const lines: Seg[] = Array.from(container.querySelectorAll('line')).map(
    (el) => ({
      x1: Number(el.getAttribute('x1')),
      y1: Number(el.getAttribute('y1')),
      x2: Number(el.getAttribute('x2')),
      y2: Number(el.getAttribute('y2')),
      text: el.parentElement?.textContent ?? '',
    })
  );
  return { parsed, circles, lines };
}

/** Region areas by sampling a fine grid, independent of the layout code. */
function sampledArea(circles: C[], member: boolean[]): number {
  const minX = Math.min(...circles.map((c) => c.x - c.r));
  const maxX = Math.max(...circles.map((c) => c.x + c.r));
  const minY = Math.min(...circles.map((c) => c.y - c.r));
  const maxY = Math.max(...circles.map((c) => c.y + c.r));
  const G = 500;
  const sx = (maxX - minX) / G;
  const sy = (maxY - minY) / G;
  let hits = 0;
  for (let i = 0; i < G; i++)
    for (let j = 0; j < G; j++) {
      const x = minX + (i + 0.5) * sx;
      const y = minY + (j + 0.5) * sy;
      if (
        circles.every(
          (c, k) => !member[k] || (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r ** 2
        )
      )
        hits++;
    }
  return hits * sx * sy;
}

/** Points of a segment strictly inside a circle (its two ends excluded). */
function crossings(seg: Seg, circles: C[]): number {
  let n = 0;
  for (let k = 1; k < 50; k++) {
    const t = k / 50;
    const x = seg.x1 + (seg.x2 - seg.x1) * t;
    const y = seg.y1 + (seg.y2 - seg.y1) * t;
    if (circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r - 0.5)) n++;
  }
  return n;
}

describe('venn layout geometry', () => {
  it('lens area runs from a whole circle to nothing', () => {
    expect(lensArea(2, 1, 0)).toBeCloseTo(Math.PI, 10);
    expect(lensArea(2, 1, 3)).toBe(0);
    const d = distanceForOverlap(3, 2, 4);
    expect(lensArea(3, 2, d)).toBeCloseTo(4, 6);
  });

  it('the polygon method agrees with the lens formula for two circles', () => {
    const a = { x: 0, y: 0, r: 3 };
    const b = { x: 3.5, y: 0, r: 2 };
    expect(intersectionArea([a, b])).toBeCloseTo(lensArea(3, 2, 3.5), 8);
  });

  it('a three-set layout lands every region near its size', () => {
    const c = proportionalLayout({
      sizes: [480, 360, 150],
      pairs: new Map([
        ['0-1', 140],
        ['1-2', 45],
        ['0-2', 60],
      ]),
      triple: 25,
    });
    const d = (i: number, j: number) =>
      Math.hypot(c[i]!.x - c[j]!.x, c[i]!.y - c[j]!.y);
    expect(lensArea(c[0]!.r, c[1]!.r, d(0, 1)) / 140).toBeCloseTo(1, 1);
    expect(intersectionArea(c) / 25).toBeGreaterThan(0.8);
    expect(intersectionArea(c) / 25).toBeLessThan(1.2);
  });
});

describe('venn parser — size and proportional', () => {
  it('reads size on set and overlap lines, alias before colour', () => {
    const p = parseVisualization(
      read('gallery/fixtures/venn-proportional.dgmo')
    );
    expect(p.proportional).toBe(true);
    expect(p.vennSets.map((s) => [s.name, s.alias, s.size])).toEqual([
      ['iOS', 'ios', 620],
      ['Android', 'droid', 340],
    ]);
    expect(p.vennSets[0]!.color).not.toBeNull();
    expect(p.vennOverlaps[0]).toMatchObject({ label: 'Use both', size: 110 });
    expect(p.diagnostics).toEqual([]);
  });

  const codes = (src: string) =>
    parseVisualization(src).diagnostics.map((d) => d.code);

  it('warns when a proportional line has no size', () => {
    expect(codes('venn\nproportional\nA size: 4\nB\nA + B Both')).toEqual([
      'W_VENN_SIZE_MISSING',
      'W_VENN_SIZE_MISSING',
    ]);
  });

  it('warns on a size that is not a count, once', () => {
    expect(codes('venn\nproportional\nA size: lots\nB size: 3')).toEqual([
      'W_VENN_SIZE_INVALID',
    ]);
  });

  it('warns and clamps an overlap larger than its set', () => {
    const p = parseVisualization(
      'venn\nproportional\nA size: 4\nB size: 9\nA + B Both size: 6'
    );
    expect(p.diagnostics.map((d) => d.code)).toEqual(['W_VENN_SIZE_TOO_LARGE']);
    expect(p.vennOverlaps[0]!.size).toBe(4);
  });

  it('warns once that sizes need proportional', () => {
    expect(codes('venn\nA size: 4\nB size: 9')).toEqual(['W_VENN_SIZE_UNUSED']);
  });
});

describe('venn proportional — areas follow sizes', () => {
  it('two sets: radii and overlap in the ratio of their sizes', () => {
    const { circles } = render(read('gallery/fixtures/venn-proportional.dgmo'));
    const [a, b] = circles as [C, C];
    expect(a.r / b.r).toBeCloseTo(Math.sqrt(620 / 340), 3);
    const lens = sampledArea(circles, [true, true]);
    expect(lens / (Math.PI * a.r * a.r)).toBeCloseTo(110 / 620, 2);
  });

  it('three sets: radii exact, overlaps approximate', () => {
    const { circles } = render(
      read('gallery/fixtures/venn-proportional-3.dgmo')
    );
    const [py, js, go] = circles as [C, C, C];
    expect(py.r / js.r).toBeCloseTo(Math.sqrt(480 / 360), 3);
    expect(py.r / go.r).toBeCloseTo(Math.sqrt(480 / 150), 3);
    const unit = (Math.PI * py.r * py.r) / 480;
    const share = (m: boolean[], size: number) =>
      sampledArea(circles, m) / unit / size;
    for (const [m, size] of [
      [[true, true, false], 140],
      [[false, true, true], 45],
      [[true, false, true], 60],
      [[true, true, true], 25],
    ] as const) {
      const r = share([...m], size);
      expect(r).toBeGreaterThan(0.8);
      expect(r).toBeLessThan(1.2);
    }
  });

  it('equal layout is unchanged without the flag', () => {
    const { circles } = render(read('gallery/fixtures/venn.dgmo'));
    expect(new Set(circles.map((c) => c.r.toFixed(6))).size).toBe(1);
  });
});

describe('venn leaders stay outside every circle', () => {
  const sources: Array<[string, string, string | null]> = [
    ['gallery venn', read('gallery/fixtures/venn.dgmo'), 'Full Stack'],
    [
      'gallery proportional',
      read('gallery/fixtures/venn-proportional.dgmo'),
      null,
    ],
    [
      'gallery proportional-3',
      read('gallery/fixtures/venn-proportional-3.dgmo'),
      'All three',
    ],
    [
      'stress long labels',
      read('stress/venn/long-labels--research-skills.dgmo'),
      'Translational research teams that ship evidence to clinicians',
    ],
    [
      'stress skew',
      read('stress/venn/extreme-values--proportional-skew.dgmo'),
      'Used every channel',
    ],
    [
      'unequal two sets',
      'venn\nproportional\nBig as b size: 900\nSmall as s size: 100\nb + s Shared size: 60',
      null,
    ],
  ];
  for (const dims of [
    { width: 1000, height: 700 },
    { width: 600, height: 420 },
  ])
    for (const [name, src, tripleLabel] of sources) {
      it(`${name} at ${dims.width}x${dims.height}`, () => {
        const { lines, circles } = render(src, dims);
        expect(lines.length).toBeGreaterThan(0);
        // The all-sets region is enclosed by every circle, so its leader is
        // the one that has to cross from the middle (spec §16.4).
        const checked = lines.filter(
          (l) =>
            !tripleLabel ||
            l.text.replace(/\s/g, '') !== tripleLabel.replace(/\s/g, '')
        );
        for (const l of checked) expect(crossings(l, circles), l.text).toBe(0);
      });
    }
});
