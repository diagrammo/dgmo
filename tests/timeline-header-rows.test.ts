/**
 * Timeline header-row reservation + label collision tests.
 *
 * Verifies that horizontal timelines reserve a dedicated row above the
 * chart for eras and markers (only when present), that crowded labels
 * truncate with an ellipsis, and that hover restores the full text.
 */
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

function eraLabelTexts(container: HTMLDivElement): string[] {
  return Array.from(container.querySelectorAll('.tl-era text')).map(
    (el) => el.textContent ?? ''
  );
}

function markerLabelTexts(container: HTMLDivElement): string[] {
  return Array.from(container.querySelectorAll('.tl-marker text')).map(
    (el) => el.textContent ?? ''
  );
}

describe('timeline horizontal header rows', () => {
  it('places era and marker labels on distinct rows above the chart', () => {
    const src = `timeline
era 2024-01 -> 2024-06 Phase A
marker 2024-03 Mid milestone
2024-01 -> 2024-04 Event A
2024-04 -> 2024-06 Event B`;
    const container = renderToContainer(src);
    const eraEl = container.querySelector('.tl-era text');
    const markerEl = container.querySelector('.tl-marker text');
    expect(eraEl).not.toBeNull();
    expect(markerEl).not.toBeNull();
    const eraY = parseFloat(eraEl!.getAttribute('y') ?? '0');
    const markerY = parseFloat(markerEl!.getAttribute('y') ?? '0');
    // Both above the chart (negative y in g-coords) and era is above marker.
    expect(eraY).toBeLessThan(0);
    expect(markerY).toBeLessThan(0);
    expect(eraY).toBeLessThan(markerY);
  });

  it('does not reserve an era row when no eras are present', () => {
    const noEraSrc = `timeline
marker 2024-03 Mid milestone
2024-01 -> 2024-06 Event A`;
    const noEra = renderToContainer(noEraSrc);
    const noEraMarkerY = parseFloat(
      noEra.querySelector('.tl-marker text')!.getAttribute('y') ?? '0'
    );

    const withEraSrc = `timeline
era 2024-01 -> 2024-06 Phase A
marker 2024-03 Mid milestone
2024-01 -> 2024-06 Event A`;
    const withEra = renderToContainer(withEraSrc);
    const withEraMarkerY = parseFloat(
      withEra.querySelector('.tl-marker text')!.getAttribute('y') ?? '0'
    );
    // Marker Y is the same regardless of era presence — eras only push the
    // chart further down by reserving their own row, they don't shift the
    // marker label row.
    expect(noEraMarkerY).toBe(withEraMarkerY);
  });

  it('truncates era labels that overflow their span', () => {
    const src = `timeline
era 2024-01 -> 2024-12 First Long Phase
era 2024-12 -> 2025-01 Tiny Transition Window
era 2025-01 -> 2025-12 Second Long Phase
2024-01 -> 2025-12 Long Event`;
    const container = renderToContainer(src);
    const labels = eraLabelTexts(container);
    expect(labels.length).toBe(3);
    // Tiny transition (1 month span) should be truncated.
    const tiny = labels.find((t) => t.startsWith('Tiny'));
    expect(tiny).toBeTruthy();
    expect(tiny!.endsWith('…')).toBe(true);
    // Wide eras keep their full labels.
    expect(labels).toContain('First Long Phase');
    expect(labels).toContain('Second Long Phase');
  });

  it('truncates crowded marker labels symmetrically', () => {
    const src = `timeline
marker 2024-06 First Important Quarterly Milestone
marker 2024-08 Beta Release Candidate Two
marker 2024-09 Production Launch Day Celebration
2024-01 -> 2025-01 Long Event`;
    const container = renderToContainer(src);
    const labels = markerLabelTexts(container);
    expect(labels.length).toBe(3);
    // All three crowded labels truncate.
    expect(labels.every((t) => t.endsWith('…'))).toBe(true);
    // Truncated labels keep at least one character + ellipsis.
    expect(labels.every((t) => t.length > 1)).toBe(true);
  });

  it('keeps far-apart marker labels intact', () => {
    const src = `timeline
marker 2024-03 Mid one
marker 2024-09 Mid two
2024-01 -> 2025-01 Long Event`;
    const container = renderToContainer(src);
    const labels = markerLabelTexts(container);
    expect(labels).toContain('Mid one');
    expect(labels).toContain('Mid two');
    expect(labels.every((t) => !t.endsWith('…'))).toBe(true);
  });

  it('fades other markers, eras, and events when hovering a marker', () => {
    const src = `timeline
era 2024-01 -> 2024-12 Phase A
marker 2024-03 First milestone
marker 2024-09 Second milestone
2024-01 -> 2024-12 Background event`;
    const container = renderToContainer(src);
    const markerGroups = Array.from(
      container.querySelectorAll<SVGGElement>('.tl-marker')
    );
    const eraGroup = container.querySelector<SVGGElement>('.tl-era');
    const eventGroup = container.querySelector<SVGGElement>('.tl-event');
    expect(markerGroups.length).toBe(2);
    expect(eraGroup).not.toBeNull();
    expect(eventGroup).not.toBeNull();

    const [first, second] = markerGroups;

    // Pre-hover: everything at full opacity (no opacity attr or "1").
    expect(second.getAttribute('opacity')).not.toBe('0.1');

    first.dispatchEvent(new window.Event('mouseenter'));
    // Hovered marker stays prominent, the other one fades.
    expect(first.getAttribute('opacity')).toBe('1');
    expect(second.getAttribute('opacity')).toBe('0.1');
    // Eras and events also fade.
    expect(eraGroup!.getAttribute('opacity')).toBe('0.1');
    expect(eventGroup!.getAttribute('opacity')).toBe('0.1');

    first.dispatchEvent(new window.Event('mouseleave'));
    // Reset.
    expect(first.getAttribute('opacity')).toBe('1');
    expect(second.getAttribute('opacity')).toBe('1');
    expect(eraGroup!.getAttribute('opacity')).toBe('1');
    expect(eventGroup!.getAttribute('opacity')).toBe('1');
  });

  it('restores full marker label on hover and re-truncates on leave', () => {
    const src = `timeline
marker 2024-06 First Important Quarterly Milestone
marker 2024-08 Beta Release Candidate Two
2024-01 -> 2025-01 Long Event`;
    const container = renderToContainer(src);
    const markerGroups = Array.from(
      container.querySelectorAll<SVGGElement>('.tl-marker')
    );
    expect(markerGroups.length).toBe(2);
    const firstGroup = markerGroups[0];
    const firstLabel = firstGroup.querySelector('text');
    expect(firstLabel?.textContent?.endsWith('…')).toBe(true);
    const truncated = firstLabel?.textContent ?? '';

    firstGroup.dispatchEvent(new window.Event('mouseenter'));
    expect(firstLabel?.textContent).toBe('First Important Quarterly Milestone');

    firstGroup.dispatchEvent(new window.Event('mouseleave'));
    expect(firstLabel?.textContent).toBe(truncated);
  });
});
