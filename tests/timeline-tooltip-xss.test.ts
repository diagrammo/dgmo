// ============================================================
// Timeline hover-tooltip XSS lock-in (issue diagrammo/diagrammo#884)
// ============================================================
//
// The timeline is the one renderer that builds tooltip markup as a string:
// buildEventTooltipHtml() interpolates the event label into
// `<strong>…</strong><br>…`, and that string reaches the live DOM through
// showTooltip()'s `tooltip.innerHTML` (src/utils/d3-helpers.ts) from eight
// hover handlers across the three timeline render paths. Every other chart
// type puts labels in the DOM through d3 .text() / text nodes, which cannot
// carry markup — tests/in-arrow-label-xss.test.ts locks those in.
//
// For each render path and each payload this suite asserts:
//   1. the tooltip contains no <script>, <img> or <svg> element
//   2. no element inside it carries an on* handler attribute
//   3. its textContent carries the literal payload — the label is still shown,
//      as text, so escaping has not silently dropped it
//
// The render path is exercised end to end: a real hover on a real .tl-event,
// not a call to the string builder, because `tooltip.innerHTML` is the sink
// the finding is about.

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseVisualization, renderTimeline } from '../src/d3';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of [
    ['document', win.document],
    ['window', win],
    ['navigator', win.navigator],
    ['HTMLElement', win.HTMLElement],
    ['SVGElement', win.SVGElement],
    ['MouseEvent', win.MouseEvent],
  ] as const) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const palette = getPalette('nord').light;
const WIDTH = 1200;
const HEIGHT = 600;

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg/onload=alert(1)>',
  '</strong><a href=javascript:alert(1)>x</a>',
] as const;

// The three paths that reach showTooltip(): plain horizontal, grouped
// horizontal (swimlanes) and vertical. Each builder wraps the payload as an
// event label, passed through literally — no escaping at the source, so the
// raw payload flows parser → renderer → tooltip.
//
// `no-scale` is on every source and is load-bearing: `timelineScale` defaults
// to true (src/visualizations/parse.ts:99) and each hover handler shows the
// date on the scale INSTEAD of a tooltip while it is on. The hover tooltip is
// the no-scale timeline's only hover affordance, so a source without the
// directive never builds one and the suite would pass without testing anything.
const PATHS = [
  {
    name: 'horizontal',
    build: (label: string) => `timeline
no-scale
sort time
  2024-01 ${label}
  2024-04 Other event`,
  },
  {
    name: 'grouped horizontal (swimlanes)',
    build: (label: string) => `timeline
no-scale
[Alpha]
  2024-01 -> 2024-03 ${label}
[Beta]
  2024-04 -> 2024-06 Other event`,
  },
  {
    name: 'vertical',
    build: (label: string) => `timeline
no-scale
  2024-01 ${label}
  2024-04 Other event`,
    // renderTimelineVertical() owns two of the eight showTooltip() call sites
    // and no directive reaches it: `orientation` is set to 'vertical' only for
    // `arc` (src/visualizations/parse.ts:1038) and a parsed timeline always
    // carries the 'horizontal' default from :85. renderTimeline() reads the
    // field off the parsed object, so flipping it here is how a caller that
    // builds ParsedTimeline itself would select that path.
    mutate: (parsed: { orientation: 'horizontal' | 'vertical' }) => {
      parsed.orientation = 'vertical';
    },
  },
] as const;

function renderToContainer(
  src: string,
  mutate?: (parsed: { orientation: 'horizontal' | 'vertical' }) => void
): HTMLDivElement {
  const parsed = parseVisualization(src, palette);
  mutate?.(parsed as unknown as { orientation: 'horizontal' | 'vertical' });
  const container = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(container);
  renderTimeline(container, parsed, palette, false, undefined, {
    width: WIDTH,
    height: HEIGHT,
  });
  return container;
}

function hoverFirstEvent(container: HTMLDivElement): HTMLDivElement {
  const events = container.querySelectorAll<SVGGElement>('g.tl-event');
  // A path that rendered no hoverable event would pass every assertion below
  // without ever building a tooltip, so the count is checked first.
  expect(events.length).toBeGreaterThan(0);
  events[0]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

  const tooltip = container.querySelector<HTMLDivElement>('[data-d3-tooltip]');
  expect(tooltip).not.toBeNull();
  return tooltip!;
}

describe('timeline hover tooltip escapes its event label', () => {
  for (const path of PATHS) {
    for (const payload of PAYLOADS) {
      it(`${path.name}: ${payload} reaches the tooltip as text`, () => {
        const container = renderToContainer(
          path.build(payload),
          'mutate' in path ? path.mutate : undefined
        );
        const tooltip = hoverFirstEvent(container);

        // The tooltip was actually populated by the hover.
        expect(tooltip.innerHTML.length).toBeGreaterThan(0);

        expect(tooltip.querySelectorAll('script').length).toBe(0);
        expect(tooltip.querySelectorAll('img').length).toBe(0);
        expect(tooltip.querySelectorAll('svg').length).toBe(0);
        expect(tooltip.querySelectorAll('a').length).toBe(0);

        for (const el of tooltip.querySelectorAll('*')) {
          for (const attr of el.attributes) {
            expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
          }
        }

        // The label is still displayed — escaped, not dropped.
        expect(tooltip.textContent).toContain(payload);

        container.remove();
      });
    }
  }
});
