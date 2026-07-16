import { it, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseVisualization, renderTimeline } from '../src/d3';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const k of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ])
    Object.defineProperty(globalThis, k, {
      value: (win as any)[
        k === 'document' ? 'document' : k === 'window' ? 'window' : k
      ],
      configurable: true,
    });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
});

it('debug', () => {
  const palette = getPalette('nord').light;
  const src = `timeline
fill-outline
era 2024-01 -> 2024-06 Era One
marker 2024-03 Midpoint
[Alpha]
  2024-01 -> 2024-03 Task A
  2024-05 Point B
[Beta]
  2024-02 -> 2024-05? Task C`;
  const parsed = parseVisualization(src, palette);
  console.log(
    'fillMode',
    (parsed as any).fillMode,
    'uncertain flags',
    (parsed as any).timelineEvents.map((e: any) => [e.label, e.uncertain])
  );
  const container = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(container);
  renderTimeline(container, parsed as any, palette, false, undefined, {
    width: 1200,
    height: 600,
  });
  console.log(
    'gradients',
    [...container.querySelectorAll('linearGradient')].map((g) =>
      g.getAttribute('id')
    )
  );
  console.log(
    'bar fills',
    [...container.querySelectorAll('.tl-event rect')].map((r) =>
      r.getAttribute('fill')
    )
  );
});
