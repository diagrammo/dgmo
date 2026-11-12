// The chart frame on every chart type (#1827).
//
// `subtitle`, `source`, `footnote` and `byline` are global: every chart type
// accepts them and draws them through the one shared component
// (`src/utils/chart-frame.ts`). This file pins both halves for each type the
// export dispatcher knows — the parser reads the four lines as the frame (no
// diagnostics, nothing left over as content), and the export draws them with
// the shared classes, the subtitle above the footer.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { DIAGRAM_EXPORT_HANDLERS, renderForExport } from '../src/d3';
import { parseDgmo } from '../src/dgmo-router';
import { supportsD3DataChart } from '../src/charts-d3';
import { growChartFrame, type ChartFrame } from '../src/utils/chart-frame';
import { getPalette } from '../src/palettes';

// One conformance fixture per chart type (tests/fixtures/conformance).
const FIXTURES = join(__dirname, 'fixtures/conformance');

const FRAME_LINES = [
  'subtitle The deck line under the title',
  'footnote Figures are provisional.',
  'source Internal survey',
  'byline Chart: Frame Test',
];

/**
 * Types left out here: `live-link` is a link card, not a chart; `map` needs
 * the basemap assets, so its frame is pinned in map-renderer.test.ts.
 */
const NOT_A_CHART = new Set(['live-link', 'map']);

function fixtureFor(type: string): string | null {
  const file = join(FIXTURES, `${type}.dgmo`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function withFrame(content: string): string {
  // The frame lines go last, after a blank line, the way an author writes a
  // footer; the subtitle is allowed anywhere, so it rides along.
  return `${content.trimEnd()}\n\n${FRAME_LINES.join('\n')}\n`;
}

const TYPES = [...Object.keys(DIAGRAM_EXPORT_HANDLERS), 'sequence'].filter(
  (t) => !NOT_A_CHART.has(t)
);

describe('chart frame on every chart type (#1827)', () => {
  for (const type of TYPES) {
    const base = fixtureFor(type);
    it.skipIf(base === null)(
      `${type}: parses and draws the frame`,
      async () => {
        const content = withFrame(base!);
        const parsed = parseDgmo(content) as {
          diagnostics?: { line: number; message: string }[];
        };
        const frameLines = new Set(
          content
            .split('\n')
            .map((l, i) => [l, i + 1] as const)
            .filter(([l]) => /^(subtitle|footnote|source|byline) /.test(l))
            .map(([, n]) => n)
        );
        const onFrame = (parsed.diagnostics ?? []).filter((d) =>
          frameLines.has(d.line)
        );
        expect(onFrame).toEqual([]);

        const svg = await renderForExport(content, 'light');
        const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window
          .document;
        const text = (sel: string) =>
          Array.from(doc.querySelectorAll(sel)).map((e) => e.textContent);
        // A narrow chart wraps the subtitle (two lines at most).
        expect(text('.chart-subtitle').join(' ')).toBe(
          'The deck line under the title'
        );
        expect(text('.chart-footnote')).toEqual(['Figures are provisional.']);
        expect(text('.chart-source')).toEqual(['Source: Internal survey']);
        expect(text('.chart-byline')).toEqual(['Chart: Frame Test']);
        const y = (sel: string) =>
          Number(doc.querySelector(sel)!.getAttribute('y'));
        expect(y('.chart-subtitle')).toBeLessThan(y('.chart-footnote'));
        expect(y('.chart-footnote')).toBeLessThan(y('.chart-source'));
        expect(y('.chart-source')).toBeLessThan(y('.chart-byline'));
      }
    );
  }

  it('covers every chart type the dispatcher knows, data charts aside', () => {
    const missing = TYPES.filter((t) => fixtureFor(t) === null);
    expect(missing).toEqual([]);
    expect(TYPES.some((t) => supportsD3DataChart(t))).toBe(false);
  });
});

describe('growChartFrame', () => {
  const palette = getPalette('nord').light;
  const frame: ChartFrame = {
    subtitle: 'Deck',
    subtitleLineNumber: 2,
    footnotes: [{ text: 'A footnote', lineNumber: 3 }],
    source: 'Somewhere',
    sourceLineNumber: 4,
  };

  function svgOf(markup: string): SVGSVGElement {
    const dom = new JSDOM(`<div>${markup}</div>`);
    return dom.window.document.querySelector('svg')!;
  }

  it('does nothing without a frame', () => {
    const svg = svgOf(
      '<svg viewBox="0 0 400 300" width="400" height="300"><rect x="10" y="40" width="50" height="50"/></svg>'
    );
    const before = svg.outerHTML;
    growChartFrame(svg, undefined, palette);
    growChartFrame(svg, {}, palette);
    expect(svg.outerHTML).toBe(before);
  });

  it('opens the subtitle band under the title and puts the footer under the drawing', () => {
    const svg = svgOf(
      '<svg viewBox="0 0 400 300" width="400" height="300">' +
        '<text class="chart-title" x="200" y="30" text-anchor="middle">T</text>' +
        '<rect x="10" y="50" width="50" height="100"/></svg>'
    );
    growChartFrame(svg, frame, palette);
    const sub = svg.querySelector('.chart-subtitle')!;
    expect(sub.getAttribute('x')).toBe('200');
    expect(sub.getAttribute('text-anchor')).toBe('middle');
    expect(Number(sub.getAttribute('y'))).toBeGreaterThan(30);
    // The drawing moved down; the title did not.
    expect(svg.querySelector('.chart-frame-body rect')).not.toBeNull();
    expect(svg.querySelector('.chart-frame-body .chart-title')).toBeNull();
    // The footer sits under the drawing (which ended at 150 + the band),
    // inside the room the canvas already had, so the canvas did not grow.
    const foot = Number(
      svg.querySelector('.chart-footnote')!.getAttribute('y')
    );
    expect(foot).toBeGreaterThan(150);
    expect(foot).toBeLessThan(300);
    expect(svg.getAttribute('viewBox')).toBe('0 0 400 300');
  });

  it('grows a canvas the drawing fills, and its height with it', () => {
    const svg = svgOf(
      '<svg viewBox="0 0 400 200" width="400" height="200">' +
        '<rect class="dgmo-canvas-bg" x="0" y="0" width="400" height="200"/>' +
        '<rect x="0" y="0" width="400" height="200" fill="red"/></svg>'
    );
    growChartFrame(svg, frame, palette);
    const [, , , h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(h).toBeGreaterThan(200);
    expect(Number(svg.getAttribute('height'))).toBe(Math.round(h!));
    // The background stays put and covers the new canvas.
    const bg = svg.querySelector(':scope > rect.dgmo-canvas-bg')!;
    expect(Number(bg.getAttribute('height'))).toBe(h);
  });

  it('keeps a caller-sized canvas and scales the drawing into it', () => {
    const svg = svgOf(
      '<svg viewBox="0 0 400 200" width="400" height="200">' +
        '<rect x="0" y="0" width="400" height="200" fill="red"/></svg>'
    );
    growChartFrame(svg, frame, palette, { size: 'fit' });
    expect(svg.getAttribute('height')).toBe('200');
    expect(svg.getAttribute('viewBox')).not.toBe('0 0 400 200');
  });

  it('follows a title scaled with the drawing', () => {
    const svg = svgOf(
      '<svg viewBox="0 0 400 300" width="400" height="300">' +
        '<g transform="translate(10,0) scale(0.5)">' +
        '<text class="chart-title" x="100" y="40" text-anchor="middle">T</text>' +
        '<rect x="0" y="60" width="50" height="50"/></g></svg>'
    );
    growChartFrame(svg, frame, palette);
    const sub = svg.querySelector('.chart-subtitle')!;
    expect(Number(sub.getAttribute('x'))).toBe(60);
    expect(Number(sub.getAttribute('font-size'))).toBe(7.5);
    // The title is held where it was drawn.
    const title = svg.querySelector('.chart-title')!;
    expect(title.getAttribute('transform')).toMatch(/^translate\(0,-/);
  });
});
