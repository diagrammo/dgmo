import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseKanban } from '../src/kanban/parser';
import { renderKanban } from '../src/kanban/renderer';
import { getPalette } from '../src/palettes';

// Set up jsdom globals
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

const palette = getPalette('nord');

// ============================================================
// legend entry hover attributes
// ============================================================

describe('legend entry hover attributes', () => {
  const input = `chart: kanban

tag: Priority
  High(red)
  Medium(yellow)
  Low(green)

[To Do]
  Fix login bug | priority: High
  Update docs | priority: Low

[Done]
  Refactor API | priority: Medium`;

  it('wraps legend entries in g[data-legend-entry]', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(
      container, parsed, palette.light, false,
      undefined, undefined, 'priority'
    );

    const entries = container.querySelectorAll('[data-legend-entry]');
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const values = Array.from(entries).map((e) =>
      e.getAttribute('data-legend-entry')
    );
    expect(values).toContain('high');
    expect(values).toContain('medium');
    expect(values).toContain('low');
  });

  it('legend entry contains circle and text children', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(
      container, parsed, palette.light, false,
      undefined, undefined, 'priority'
    );

    const entry = container.querySelector('[data-legend-entry="high"]');
    expect(entry).toBeTruthy();
    expect(entry!.querySelector('circle')).toBeTruthy();
    expect(entry!.querySelector('text')).toBeTruthy();
  });

  it('legend entry has cursor pointer', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(
      container, parsed, palette.light, false,
      undefined, undefined, 'priority'
    );

    const entry = container.querySelector('[data-legend-entry="high"]');
    expect(entry).toBeTruthy();
    expect((entry as HTMLElement).style.cursor).toBe('pointer');
  });

  it('adds data-tag-* on cards when activeTagGroup is set', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(
      container, parsed, palette.light, false,
      undefined, undefined, 'priority'
    );

    const highCard = container.querySelector('.kanban-card[data-tag-priority="high"]');
    const lowCard = container.querySelector('.kanban-card[data-tag-priority="low"]');
    const medCard = container.querySelector('.kanban-card[data-tag-priority="medium"]');
    expect(highCard).toBeTruthy();
    expect(lowCard).toBeTruthy();
    expect(medCard).toBeTruthy();
  });

  it('does not add data-tag-* when no activeTagGroup', () => {
    const parsed = parseKanban(input, palette.light);
    const container = document.createElement('div');
    renderKanban(container, parsed, palette.light, false);

    const tagged = container.querySelector('[data-tag-priority]');
    expect(tagged).toBeNull();
  });
});
