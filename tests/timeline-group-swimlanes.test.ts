import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseVisualization, renderTimeline } from '../src/d3';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const palette = getPalette('nord').light;
const WIDTH = 1200;
const HEIGHT = 600;

function renderToContainer(src: string): HTMLDivElement {
  const parsed = parseVisualization(src, palette);
  const container = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(container);
  renderTimeline(container, parsed, palette, false, undefined, {
    width: WIDTH,
    height: HEIGHT,
  });
  return container;
}

const GROUPED_SRC = `timeline
[Alpha]
  2024-01 -> 2024-03 Task A
  2024-04 -> 2024-06 Task B
[Beta]
  2024-02 -> 2024-05 Task C
  2024-07 -> 2024-09 Task D`;

describe('timeline group swimlanes', () => {
  it('renders groups as swimlane lanes by default (no sort group needed)', () => {
    const container = renderToContainer(GROUPED_SRC);
    const headers = container.querySelectorAll('.tl-group-header');
    expect(headers.length).toBe(2);

    const texts = Array.from(headers).map(
      (h) => h.querySelector('text')?.textContent ?? ''
    );
    expect(texts[0]).toContain('Alpha');
    expect(texts[1]).toContain('Beta');
  });

  it('renders header band background and accent for each group', () => {
    const container = renderToContainer(GROUPED_SRC);
    const bgRects = container.querySelectorAll('.tl-group-header-bg');
    const accentRects = container.querySelectorAll('.tl-group-header-accent');
    expect(bgRects.length).toBe(2);
    expect(accentRects.length).toBe(2);
  });

  it('renders toggle icon ▼ in expanded headers', () => {
    const container = renderToContainer(GROUPED_SRC);
    const headers = container.querySelectorAll('.tl-group-header text');
    const texts = Array.from(headers).map((h) => h.textContent ?? '');
    expect(texts.every((t) => t.startsWith('▼'))).toBe(true);
  });

  it('sort time opts out of swimlanes', () => {
    const src = `timeline
sort time
[Alpha]
  2024-01 -> 2024-03 Task A
[Beta]
  2024-02 -> 2024-05 Task B`;
    const container = renderToContainer(src);
    const headers = container.querySelectorAll('.tl-group-header');
    expect(headers.length).toBe(0);
  });

  it('renders swimlane background bands', () => {
    const container = renderToContainer(GROUPED_SRC);
    const swimlanes = container.querySelectorAll('.tl-swimlane');
    expect(swimlanes.length).toBe(2);
  });

  it('renders ungrouped events in (Other) lane', () => {
    const src = `timeline
[Alpha]
  2024-01 -> 2024-03 Task A
2024-06 -> 2024-08 Ungrouped Task`;
    const container = renderToContainer(src);
    const headers = container.querySelectorAll('.tl-group-header');
    const texts = Array.from(headers).map(
      (h) => h.querySelector('text')?.textContent ?? ''
    );
    expect(texts.some((t) => t.includes('(Other)'))).toBe(true);
  });

  it('does not show (Other) lane when all events are grouped', () => {
    const container = renderToContainer(GROUPED_SRC);
    const headers = container.querySelectorAll('.tl-group-header');
    const texts = Array.from(headers).map(
      (h) => h.querySelector('text')?.textContent ?? ''
    );
    expect(texts.some((t) => t.includes('(Other)'))).toBe(false);
  });

  it('tag swimlanes take priority over group swimlanes', () => {
    const src = `timeline
tag Team
  Frontend(red)
  Backend(blue)
[Alpha]
  2024-01 -> 2024-03 Task A | Team: Frontend
[Beta]
  2024-04 -> 2024-06 Task B | Team: Backend`;
    const parsed = parseVisualization(src, palette);
    const container = document.createElement('div') as HTMLDivElement;
    document.body.appendChild(container);
    renderTimeline(
      container,
      parsed,
      palette,
      false,
      undefined,
      {
        width: WIDTH,
        height: HEIGHT,
      },
      undefined,
      'Team'
    );
    const headers = container.querySelectorAll('.tl-group-header');
    const texts = Array.from(headers).map(
      (h) => h.querySelector('text')?.textContent ?? ''
    );
    expect(texts.some((t) => t.includes('Frontend'))).toBe(true);
    expect(texts.some((t) => t.includes('Backend'))).toBe(true);
    expect(texts.some((t) => t.includes('Alpha'))).toBe(false);
  });
});

describe('timeline group collapse', () => {
  it('clicking header toggles collapse (summary bar appears, events hidden)', () => {
    const container = renderToContainer(GROUPED_SRC);
    const alphaHeader = container.querySelector(
      '.tl-group-header[data-group="Alpha"]'
    ) as SVGGElement;
    expect(alphaHeader).not.toBeNull();

    let events = container.querySelectorAll('.tl-event[data-group="Alpha"]');
    let summary = container.querySelector(
      '.tl-group-summary[data-group="Alpha"]'
    );
    expect(events.length).toBe(2);
    expect(summary).toBeNull();

    alphaHeader.dispatchEvent(new window.Event('click'));

    events = container.querySelectorAll('.tl-event[data-group="Alpha"]');
    summary = container.querySelector('.tl-group-summary[data-group="Alpha"]');
    expect(events.length).toBe(0);
    expect(summary).not.toBeNull();
  });

  it('collapsed header shows ▶ icon', () => {
    const container = renderToContainer(GROUPED_SRC);
    const alphaHeader = container.querySelector(
      '.tl-group-header[data-group="Alpha"]'
    ) as SVGGElement;
    alphaHeader.dispatchEvent(new window.Event('click'));

    const headerText = container.querySelector(
      '.tl-group-header[data-group="Alpha"] text'
    );
    expect(headerText?.textContent).toMatch(/^▶/);
  });

  it('collapsed summary bar shows group name and event count', () => {
    const container = renderToContainer(GROUPED_SRC);
    const alphaHeader = container.querySelector(
      '.tl-group-header[data-group="Alpha"]'
    ) as SVGGElement;
    alphaHeader.dispatchEvent(new window.Event('click'));

    const summaryText = container.querySelector(
      '.tl-group-summary[data-group="Alpha"] text'
    );
    expect(summaryText?.textContent).toBe('Alpha (2 events)');
  });

  it('collapse state persists across re-renders on same container', () => {
    const container = renderToContainer(GROUPED_SRC);
    const alphaHeader = container.querySelector(
      '.tl-group-header[data-group="Alpha"]'
    ) as SVGGElement;
    alphaHeader.dispatchEvent(new window.Event('click'));

    // Re-render on same container — collapse state should persist
    const parsed = parseVisualization(GROUPED_SRC, palette);
    renderTimeline(container, parsed, palette, false, undefined, {
      width: WIDTH,
      height: HEIGHT,
    });

    const events = container.querySelectorAll('.tl-event[data-group="Alpha"]');
    const summary = container.querySelector(
      '.tl-group-summary[data-group="Alpha"]'
    );
    expect(events.length).toBe(0);
    expect(summary).not.toBeNull();
  });

  it('clicking collapsed header expands it again', () => {
    const container = renderToContainer(GROUPED_SRC);

    // Collapse
    const header1 = container.querySelector(
      '.tl-group-header[data-group="Alpha"]'
    ) as SVGGElement;
    header1.dispatchEvent(new window.Event('click'));
    let events = container.querySelectorAll('.tl-event[data-group="Alpha"]');
    expect(events.length).toBe(0);

    // Expand (re-query after re-render)
    const header2 = container.querySelector(
      '.tl-group-header[data-group="Alpha"]'
    ) as SVGGElement;
    header2.dispatchEvent(new window.Event('click'));

    events = container.querySelectorAll('.tl-event[data-group="Alpha"]');
    expect(events.length).toBe(2);
  });

  it('summary bar has minimum width for point-only groups', () => {
    const src = `timeline
[Points]
  2024-06-15 Single point
[Range]
  2024-01 -> 2024-12 Long range`;
    const container = renderToContainer(src);

    const pointsHeader = container.querySelector(
      '.tl-group-header[data-group="Points"]'
    ) as SVGGElement;
    pointsHeader.dispatchEvent(new window.Event('click'));

    const summaryRect = container.querySelector(
      '.tl-group-summary[data-group="Points"] rect'
    );
    expect(summaryRect).not.toBeNull();
    const width = parseFloat(summaryRect!.getAttribute('width') ?? '0');
    expect(width).toBeGreaterThanOrEqual(20);
  });
});
