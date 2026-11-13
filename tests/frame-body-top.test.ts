// Where the drawing starts under the title, on every chart type (#1838).
//
// A chart with a title starts its drawing FRAME_BODY_TOP from the top of the
// canvas; with a legend above the drawing, LEGEND_BODY_GAP under the legend.
// This walks every registered chart type, so a new one is held to it the
// moment it registers.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { DIAGRAM_EXPORT_HANDLERS } from '../src/d3';
import { chartTypes } from '../src/chart-types';
import { render } from '../src/render';
import { measureSvgContent } from '../src/utils/export-fit';
import {
  FRAME_BODY_TOP,
  HERO_TITLE_TYPES,
  LEGEND_BODY_GAP,
} from '../src/utils/title-constants';

const FIXTURES = join(__dirname, 'fixtures/conformance');

/** `live-link` is a link card; `map` needs basemap assets (map tests pin it). */
const SKIP = new Set(['live-link', 'map']);

const TYPES = [
  ...new Set([
    ...Object.keys(DIAGRAM_EXPORT_HANDLERS),
    ...chartTypes.map((c) => c.id),
  ]),
]
  .filter((t) => !SKIP.has(t) && !HERO_TITLE_TYPES.includes(t))
  .sort();

const FRAME_PARTS = [
  'text.chart-title',
  '.chart-subtitle',
  '.chart-footnote',
  '.chart-source',
  '.chart-byline',
  '.dgmo-legend',
  '.chart-legend',
  '[data-chart-header]',
  '[data-frame-legend]',
  '[data-frame-part]',
].join(',');

const LEGEND = '.dgmo-legend, .chart-legend';

/** Half the widest stroke a drawing's top edge carries. */
const TOLERANCE = 1.5;

interface Bands {
  /** Top of the drawing, root units from the top of the canvas. */
  top: number;
  /** Bottom of the legend above the drawing, or null. */
  legendBottom: number | null;
}

function parse(svg: string) {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const root = doc.documentElement;
  const vb = (root.getAttribute('viewBox') ?? '0 0 0 0')
    .split(/[\s,]+/)
    .map(Number);
  return { root, vb };
}

function bands(svg: string): Bands {
  const { root, vb } = parse(svg);
  for (const c of Array.from(root.children))
    if (c.tagName === 'rect' && Number(c.getAttribute('width')) >= vb[2]! - 1)
      c.remove();
  for (const el of Array.from(root.querySelectorAll(FRAME_PARTS))) el.remove();
  // The export fit pads any path with an arrowhead by a fixed allowance, a
  // safety margin rather than ink; an arrowhead sits at a path's end, inside
  // the box the path already gives.
  for (const el of Array.from(
    root.querySelectorAll('[marker-start],[marker-end],[marker-mid]')
  ))
    for (const a of ['marker-start', 'marker-end', 'marker-mid'])
      el.removeAttribute(a);
  const body = measureSvgContent(root.outerHTML).box;

  let legendBottom: number | null = null;
  const l = parse(svg);
  const keep = l.root.querySelector(LEGEND);
  if (keep && keep.querySelector('[data-legend-group]')) {
    const line = new Set<Element>();
    for (let e: Element | null = keep; e; e = e.parentElement) line.add(e);
    const prune = (e: Element) => {
      for (const c of Array.from(e.children)) {
        if (c === keep) continue;
        if (line.has(c)) prune(c);
        else c.remove();
      }
    };
    prune(l.root);
    const box = measureSvgContent(l.root.outerHTML).box;
    if (box) legendBottom = box.y1 - vb[1]!;
  }
  return { top: (body?.y0 ?? NaN) - vb[1]!, legendBottom };
}

/**
 * A second source per type that draws a tag legend: the first gallery or
 * stress fixture of that type with a `tag` block. Conformance fixtures mostly
 * carry none, and a legend above the drawing is where the band slips.
 */
function legendCase(type: string): { file: string; src: string } | null {
  for (const dir of ['gallery/fixtures', `stress/${type}`]) {
    const abs = join(__dirname, '..', dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).sort()) {
      if (!f.endsWith('.dgmo')) continue;
      const src = readFileSync(join(abs, f), 'utf8');
      const first = src
        .split('\n')
        .find((l) => l.trim() && !l.startsWith('//'));
      if (first?.split(/\s+/)[0] !== type) continue;
      if (
        /^tag\s/m.test(src) &&
        !/^(no-legend|no-title|legend-inline)\b/m.test(src)
      )
        return { file: `${dir}/${f}`, src };
    }
  }
  return null;
}

describe('the drawing starts on the shared band (#1838)', () => {
  for (const type of TYPES) {
    const cases: [string, string][] = [
      [type, readFileSync(join(FIXTURES, `${type}.dgmo`), 'utf8')],
    ];
    const lc = legendCase(type);
    if (lc) cases.push([`${type} with a legend (${lc.file})`, lc.src]);
    for (const [name, src] of cases)
      it(name, async () => {
        const { svg } = await render(src);
        const { top, legendBottom } = bands(svg);
        // A stroke straddles its edge, so a 1.5 stroke reads 0.75 high.
        if (legendBottom !== null && legendBottom < top)
          expect(
            Math.abs(top - legendBottom - LEGEND_BODY_GAP),
            `gap under the legend: ${(top - legendBottom).toFixed(2)}`
          ).toBeLessThanOrEqual(TOLERANCE);
        else
          expect(
            Math.abs(top - FRAME_BODY_TOP),
            `drawing top: ${top.toFixed(2)}`
          ).toBeLessThanOrEqual(TOLERANCE);
      });
  }
});
