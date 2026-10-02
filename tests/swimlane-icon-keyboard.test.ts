// A legend pill's swimlane ("Group by") icon is a button a keyboard and a
// screen reader can reach (#952). It used to take only a click and carry its
// name only in a hover <title>, so Tab never stopped on it.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseKanban } from '../src/kanban/parser';
import { renderKanban } from '../src/kanban/renderer';
import { parseGantt } from '../src/gantt/parser';
import { calculateSchedule } from '../src/gantt/calculator';
import { renderGantt } from '../src/gantt/renderer';
import { parseVisualization, renderTimeline } from '../src/d3';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const key of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? win : win[key],
      configurable: true,
    });
  }
});

const palette = getPalette('nord').light;

function container(): HTMLDivElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 800 });
  Object.defineProperty(c, 'clientHeight', { value: 500 });
  document.body.appendChild(c);
  return c;
}

function press(el: Element, key: string): void {
  el.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    })
  );
}

/** The icon is a named, focusable button; Enter and Space do what a click does. */
function expectKeyboardButton(
  icon: Element | null,
  group: string,
  activated: () => number
) {
  expect(icon).not.toBeNull();
  expect(icon!.getAttribute('role')).toBe('button');
  expect(icon!.getAttribute('tabindex')).toBe('0');
  expect(icon!.getAttribute('aria-label')).toBe(`Group by ${group}`);
  expect(icon!.getAttribute('aria-pressed')).toMatch(/^(true|false)$/);

  const before = activated();
  press(icon!, 'Enter');
  expect(activated()).toBe(before + 1);
  press(icon!, ' ');
  expect(activated()).toBe(before + 2);
  // Any other key is left alone.
  press(icon!, 'a');
  expect(activated()).toBe(before + 2);
}

describe('swimlane icon is a keyboard button (#952)', () => {
  it('kanban', () => {
    const parsed = parseKanban(
      `kanban

tag Team
  Frontend blue
  Backend green

[Backlog]
  Redesign team: Frontend
  Caching team: Backend`,
      palette
    );
    const onSwimlaneChange = vi.fn();
    const c = container();
    renderKanban(c, parsed, palette, false, { onSwimlaneChange });
    expectKeyboardButton(
      c.querySelector('.kanban-swimlane-icon'),
      'Team',
      () => onSwimlaneChange.mock.calls.length
    );
    expect(onSwimlaneChange).toHaveBeenLastCalledWith('Team');
  });

  it('gantt', () => {
    const parsed = parseGantt(
      `gantt
start 2024-01-15

tag Team as t
  Engineering blue
  Design purple

[Backend]
  Database Layer duration: 30bd, t: Engineering
  Polish duration: 5bd, t: Design`,
      palette
    );
    const onSwimlaneChange = vi.fn();
    const c = container();
    renderGantt(
      c,
      calculateSchedule(parsed),
      palette,
      false,
      { onSwimlaneChange, currentActiveGroup: 'Team' },
      { width: 800, height: 500 }
    );
    expectKeyboardButton(
      c.querySelector('.gantt-swimlane-icon'),
      'Team',
      () => onSwimlaneChange.mock.calls.length
    );
  });

  it('timeline', () => {
    const parsed = parseVisualization(
      `timeline

tag Status
  Done green
  Active blue

2024-01-01 -> 2024-06-01: Feature A | status: Done
2024-03-01 -> 2024-12-01: Feature B | status: Active`,
      palette
    );
    const onTagStateChange = vi.fn();
    const c = container();
    renderTimeline(
      c,
      parsed,
      palette,
      false,
      undefined,
      undefined,
      'Status',
      undefined,
      onTagStateChange
    );
    expectKeyboardButton(
      c.querySelector('.tl-swimlane-icon'),
      'Status',
      () => onTagStateChange.mock.calls.length
    );
  });
});

// A render nobody can act on — export, a static docs embed — passes no
// callback. Its icon keeps the hover <title> but must not announce a button
// that does nothing.
describe('swimlane icon stays inert when nothing can act on it (#952)', () => {
  function expectInert(icon: Element | null, group: string) {
    expect(icon).not.toBeNull();
    expect(icon!.querySelector('title')?.textContent).toBe(`Group by ${group}`);
    for (const attr of ['role', 'tabindex', 'aria-label', 'aria-pressed']) {
      expect(icon!.hasAttribute(attr)).toBe(false);
    }
  }

  it('gantt with no onSwimlaneChange', () => {
    const parsed = parseGantt(
      `gantt
start 2024-01-15

tag Team as t
  Engineering blue
  Design purple

[Backend]
  Database Layer duration: 30bd, t: Engineering
  Polish duration: 5bd, t: Design`,
      palette
    );
    const c = container();
    renderGantt(
      c,
      calculateSchedule(parsed),
      palette,
      false,
      { currentActiveGroup: 'Team' },
      { width: 800, height: 500 }
    );
    expectInert(c.querySelector('.gantt-swimlane-icon'), 'Team');
  });

  it('timeline with no onTagStateChange', () => {
    const parsed = parseVisualization(
      `timeline

tag Status
  Done green
  Active blue

2024-01-01 -> 2024-06-01: Feature A | status: Done
2024-03-01 -> 2024-12-01: Feature B | status: Active`,
      palette
    );
    const c = container();
    renderTimeline(
      c,
      parsed,
      palette,
      false,
      undefined,
      { width: 800, height: 400 },
      'Status'
    );
    expectInert(c.querySelector('.tl-swimlane-icon'), 'Status');
  });
});
