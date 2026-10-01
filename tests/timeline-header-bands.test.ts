/**
 * Timeline header bands in a scaled (on-screen) layout.
 *
 * A wide timeline in a narrow pane shrinks its layout (ScaleContext), but the
 * title, the legends and the tick labels are drawn at full size. Their bands
 * must not shrink with it, or the top tick labels land on the title / legend
 * and the bottom ones fall off the SVG (#997 follow-up, 2026-09-30).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseVisualization, renderTimeline } from '../src/d3';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [k, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, k, { value, configurable: true });
  }
});

const palette = getPalette('nord').light;

function render(src: string): SVGSVGElement {
  const container = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(container);
  for (const [k, v] of [
    ['clientWidth', 600],
    ['clientHeight', 500],
  ] as const) {
    Object.defineProperty(container, k, { value: v, configurable: true });
  }
  renderTimeline(
    container,
    parseVisualization(src, palette) as never,
    palette,
    false
  );
  return container.querySelector('svg')!;
}

/** y of the plot group (the `<g>` every tick label hangs off). */
function plotTop(svg: SVGSVGElement): number {
  const tick = svg.querySelector('text.tl-scale-tick')!;
  const g = tick.closest('g[transform]')!;
  return Number(/,\s*([\d.]+)\)/.exec(g.getAttribute('transform')!)![1]);
}

const TOP_LABEL_H = 20; // label baseline sits 10px above the plot, 10px font
const TITLE_BOTTOM = 36; // TITLE_Y (30) + descent

function events(group: string, n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) =>
      `  2026-10-05 ${String(9 + (i % 8)).padStart(2, '0')}:00 ${group} task ${i} duration: 1h, r: Crew`
  );
}

const TAGS = 'tag Role as r\n  Command red\n  Crew blue\n';
const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F']
  .flatMap((g) => [`[${g}]`, ...events(g, 6)])
  .join('\n');

describe('timeline header bands under a scaled layout', () => {
  it('swimlanes: top tick labels clear the title', () => {
    const svg = render(`timeline Title\n${GROUPS}`);
    expect(plotTop(svg) - TOP_LABEL_H).toBeGreaterThanOrEqual(TITLE_BOTTOM);
  });

  it('swimlanes: top tick labels clear the tag legend', () => {
    const svg = render(`timeline Title\n${TAGS}${GROUPS}`);
    // Tag legend row starts at y=50 and is reserved 36px.
    expect(plotTop(svg) - TOP_LABEL_H).toBeGreaterThanOrEqual(50 + 36 - 8);
  });

  it('time sort: top tick labels clear the group legend', () => {
    const svg = render(`timeline Title\nsort time\n${GROUPS}`);
    // Group legend pills sit 35px above the top-scale band.
    const pills = [...svg.querySelectorAll('rect')].filter(
      (r) => r.closest('g[transform]') && Number(r.getAttribute('height')) > 0
    );
    expect(pills.length).toBeGreaterThan(0);
    expect(plotTop(svg) - TOP_LABEL_H).toBeGreaterThanOrEqual(104 - 8);
  });

  it('keeps room under the bottom tick labels', () => {
    const svg = render(`timeline Title\n${GROUPS}`);
    const [, , , vbH] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const top = plotTop(svg);
    const bottomBaseline = Math.max(
      ...[...svg.querySelectorAll('text.tl-scale-tick')].map(
        (t) => top + Number(t.getAttribute('y'))
      )
    );
    expect(vbH - bottomBaseline).toBeGreaterThanOrEqual(8);
  });

  it('group toggle sits inside its band, clear of the accent', () => {
    const svg = render(`timeline Title\n${GROUPS}`);
    const accent = svg.querySelector('rect.tl-group-header-accent')!;
    const label = svg.querySelector('g.tl-group-header text')!;
    const accentRight =
      Number(accent.getAttribute('x')) + Number(accent.getAttribute('width'));
    expect(Number(label.getAttribute('x'))).toBeGreaterThan(accentRight);
  });
});
