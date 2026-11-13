// The shared title band on every chart type (#1838).
//
// Every chart type draws its title at one size and height, on one edge: left
// by default (owner, 2026-11-13), or wherever `align` / `<part>-align` puts
// it. The subtitle, footer and legend follow. This walks every chart type the
// export dispatcher knows plus every data chart, so a new chart type is
// checked the moment it registers — nobody has to remember to add it.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { DIAGRAM_EXPORT_HANDLERS, renderForExport } from '../src/d3';
import { chartTypes } from '../src/chart-types';
import {
  FRAME_INSET,
  HERO_TITLE_TYPES,
  TITLE_FONT_SIZE,
  TITLE_Y,
} from '../src/utils/title-constants';
import {
  IDENTITY,
  multiply,
  parseTransform,
  type Matrix,
} from '../src/utils/export-fit';
import { drawingEdges } from '../src/utils/chart-frame';
import { measureText } from '../src/utils/text-measure';

const FIXTURES = join(__dirname, 'fixtures/conformance');

/** `live-link` is a link card; `map` needs basemap assets (map tests pin it). */
const SKIP = new Set(['live-link', 'map']);

const TYPES = [
  ...new Set([
    ...Object.keys(DIAGRAM_EXPORT_HANDLERS),
    ...chartTypes.map((c) => c.id),
  ]),
]
  .filter((t) => !SKIP.has(t))
  .sort();

function fixtureFor(type: string): string {
  return readFileSync(join(FIXTURES, `${type}.dgmo`), 'utf8');
}

/** The fixture with frame lines added after its first line. */
function withLines(content: string, lines: string[]): string {
  const [head, ...rest] = content.split('\n');
  return [head, ...lines, ...rest].join('\n');
}

/** The element's transform to root units. */
function ctm(el: Element): Matrix {
  const chain: Element[] = [];
  for (
    let e: Element | null = el;
    e && e.tagName !== 'svg';
    e = e.parentElement
  )
    chain.unshift(e);
  let m: Matrix = IDENTITY;
  for (const e of chain) {
    const t = e.getAttribute('transform');
    if (t) m = multiply(m, parseTransform(t) ?? IDENTITY);
  }
  return m;
}

interface Placed {
  x: number;
  y: number;
  anchor: string;
  size: number;
  bold: boolean;
}

function place(el: Element): Placed {
  const m = ctm(el);
  const x = Number(el.getAttribute('x') ?? 0);
  const y = Number(el.getAttribute('y') ?? 0);
  const weight = el.getAttribute('font-weight') ?? '';
  return {
    x: m[0] * x + m[4],
    y: m[3] * y + m[5],
    anchor: el.getAttribute('text-anchor') ?? 'start',
    size: Number(el.getAttribute('font-size')) * m[3],
    bold: weight === 'bold' || Number(weight) >= 600,
  };
}

async function draw(content: string) {
  const svg = await renderForExport(content, 'light');
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const root = doc.documentElement;
  const vb = (root.getAttribute('viewBox') ?? '0 0 0 0')
    .split(/[\s,]+/)
    .map(Number);
  return { doc, vbX: vb[0]!, vbW: vb[2]! };
}

const ANCHOR: Record<string, string> = {
  left: 'start',
  center: 'middle',
  right: 'end',
};

/** Where the legend's edge for `align` sits, in root units, or null. */
function legendAt(doc: Document, align: string): number | null {
  const g = doc.querySelector('g.dgmo-legend, g.chart-legend');
  if (!g || !g.querySelector('[data-legend-group]')) return null;
  const lo = Number(g.getAttribute('data-legend-left'));
  const hi = Number(g.getAttribute('data-legend-right'));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const m = ctm(g);
  const at = align === 'center' ? (lo + hi) / 2 : align === 'right' ? hi : lo;
  return m[0] * at + m[4];
}

/** Where `align` puts a part on the drawing's own edges. */
function expectedX(doc: Document, align: string): number {
  const root = doc.documentElement as unknown as SVGSVGElement;
  const vb = (root.getAttribute('viewBox') ?? '0 0 0 0')
    .split(/[\s,]+/)
    .map(Number);
  const e = drawingEdges(root, {
    x: vb[0]!,
    y: vb[1]!,
    width: vb[2]!,
    height: vb[3]!,
  });
  return align === 'center'
    ? (e.left + e.right) / 2
    : align === 'right'
      ? e.right
      : e.left;
}

/** A title too wide for the drawing slides inside the canvas instead. */
function titleWidth(el: Element): number {
  const spans = Array.from(el.querySelectorAll('tspan'));
  const texts = spans.length
    ? spans.map((t) => t.textContent ?? '')
    : [el.textContent ?? ''];
  return Math.max(
    ...texts.map((t) => measureText(t, TITLE_FONT_SIZE, { bold: true }))
  );
}

describe('title band on every chart type (#1838)', () => {
  it('checks every fixture it names', () => {
    const missing = TYPES.filter(
      (t) => !existsSync(join(FIXTURES, `${t}.dgmo`))
    );
    expect(missing).toEqual([]);
  });

  for (const type of TYPES) {
    if (HERO_TITLE_TYPES.includes(type)) continue;

    for (const align of ['left', 'center', 'right'] as const) {
      it(`${type}: title, subtitle and footer sit ${align}`, async () => {
        const lines = [
          ...(align === 'left' ? [] : [`align ${align}`]),
          'subtitle The deck line',
        ];
        const content = `${withLines(fixtureFor(type), lines).trimEnd()}\n\nsource Frame test\n`;
        const { doc, vbX, vbW } = await draw(content);
        const title = doc.querySelector('text.chart-title');
        expect(title, 'a text.chart-title').not.toBeNull();
        const t = place(title!);
        expect(t.size, 'title size').toBeCloseTo(TITLE_FONT_SIZE, 1);
        expect(t.bold, 'title bold').toBe(true);
        expect(t.y, 'title baseline').toBeCloseTo(TITLE_Y, 0);
        expect(t.anchor, 'title anchor').toBe(ANCHOR[align]);
        const want = expectedX(doc, align);
        // Inside the canvas, less the inset, always.
        const w = titleWidth(title!);
        const start =
          align === 'left' ? t.x : align === 'center' ? t.x - w / 2 : t.x - w;
        expect(start - vbX, 'title starts inside').toBeGreaterThanOrEqual(
          FRAME_INSET - 0.5
        );
        if (start + w <= vbX + vbW - FRAME_INSET)
          expect(start + w, 'title ends inside').toBeLessThanOrEqual(
            vbX + vbW - FRAME_INSET + 0.5
          );
        // On the drawing's edge, unless it had to slide to fit: then it
        // rests on an inset edge of the canvas.
        if (Math.abs(t.x - want) > 0.5) {
          const atLeft = Math.abs(start - (vbX + FRAME_INSET)) < 0.5;
          const atRight = Math.abs(start + w - (vbX + vbW - FRAME_INSET)) < 0.5;
          expect(atLeft || atRight, `title at ${t.x}, edge ${want}`).toBe(true);
        }
        for (const sel of ['text.chart-subtitle', 'text.chart-source']) {
          const el = doc.querySelector(sel);
          expect(el, sel).not.toBeNull();
          const p = place(el!);
          expect(p.anchor, `${sel} anchor`).toBe(ANCHOR[align]);
          expect(p.x, `${sel} x`).toBeCloseTo(want, 0);
        }
        const lx = legendAt(doc, align);
        if (lx !== null) expect(lx, 'legend edge').toBeCloseTo(want, 0);
      });
    }

    it(`${type}: one part overrides the frame`, async () => {
      const content = withLines(fixtureFor(type), [
        'align center',
        'title-align left',
      ]);
      const { doc } = await draw(content);
      const title = doc.querySelector('text.chart-title')!;
      const t = place(title);
      expect(t.anchor).toBe('start');
      const want = expectedX(doc, 'left');
      if (Math.abs(t.x - want) > 0.5)
        expect(titleWidth(title)).toBeGreaterThan(
          expectedX(doc, 'right') - want
        );
    });
  }
});
