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

const KANBAN = `kanban

tag Team
  Frontend blue
  Backend green

[Backlog]
  Redesign team: Frontend
  Caching team: Backend`;

const GANTT = `gantt
start 2024-01-15

tag Team as t
  Engineering blue
  Design purple

[Backend]
  Database Layer duration: 30bd, t: Engineering
  Polish duration: 5bd, t: Design`;

const TIMELINE = `timeline

tag Status
  Done green
  Active blue

2024-01-01 -> 2024-06-01: Feature A | status: Done
2024-03-01 -> 2024-12-01: Feature B | status: Active`;

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

function expectNamedButton(icon: Element | null, group: string): void {
  expect(icon).not.toBeNull();
  expect(icon!.getAttribute('role')).toBe('button');
  expect(icon!.getAttribute('tabindex')).toBe('0');
  expect(icon!.getAttribute('aria-label')).toBe(`Group by ${group}`);
  expect(icon!.getAttribute('aria-pressed')).toMatch(/^(true|false)$/);
}

/** The icon is a named, focusable button; Enter and Space do what a click does. */
function expectKeyboardButton(
  icon: Element | null,
  group: string,
  activated: () => number
): void {
  expectNamedButton(icon, group);
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
    const onSwimlaneChange = vi.fn();
    const c = container();
    renderKanban(c, parseKanban(KANBAN, palette), palette, false, {
      onSwimlaneChange,
    });
    expectKeyboardButton(
      c.querySelector('.kanban-swimlane-icon'),
      'Team',
      () => onSwimlaneChange.mock.calls.length
    );
    expect(onSwimlaneChange).toHaveBeenLastCalledWith('Team');
  });

  it('gantt', () => {
    const onSwimlaneChange = vi.fn();
    const c = container();
    renderGantt(
      c,
      calculateSchedule(parseGantt(GANTT, palette)),
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
    const onTagStateChange = vi.fn();
    const c = container();
    renderTimeline(
      c,
      parseVisualization(TIMELINE, palette),
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

  // A live timeline toggles lanes by itself, callback or not, so its icon is a
  // button either way.
  it('timeline with no onTagStateChange', () => {
    const c = container();
    renderTimeline(
      c,
      parseVisualization(TIMELINE, palette),
      palette,
      false,
      undefined,
      undefined,
      'Status'
    );
    const icon = c.querySelector('.tl-swimlane-icon');
    expectNamedButton(icon, 'Status');
    expect(icon!.getAttribute('aria-pressed')).toBe('false');
    press(icon!, 'Enter');
    expect(
      c.querySelector('.tl-swimlane-icon')!.getAttribute('aria-pressed')
    ).toBe('true');
  });
});

// Enter re-renders the chart — the timeline itself, the app on its callback.
// Focus must land back on the toggle, now pressed, not drop to the page.
describe('swimlane icon keeps focus across the re-render (#952)', () => {
  it('timeline', () => {
    const c = container();
    renderTimeline(
      c,
      parseVisualization(TIMELINE, palette),
      palette,
      false,
      undefined,
      undefined,
      'Status',
      undefined,
      () => {}
    );
    const icon = c.querySelector<SVGElement>('.tl-swimlane-icon')!;
    icon.focus();
    expect(document.activeElement).toBe(icon);
    press(icon, 'Enter');
    const after = document.activeElement!;
    expect(icon.isConnected).toBe(false);
    expect(after.classList.contains('tl-swimlane-icon')).toBe(true);
    expect(after.getAttribute('aria-pressed')).toBe('true');
  });

  it('gantt, re-rendered by its caller', () => {
    const resolved = calculateSchedule(parseGantt(GANTT, palette));
    const c = container();
    const draw = (lane: string | null) =>
      renderGantt(
        c,
        resolved,
        palette,
        false,
        {
          currentActiveGroup: 'Team',
          currentSwimlaneGroup: lane,
          onSwimlaneChange: draw,
        },
        { width: 800, height: 500 }
      );
    draw(null);
    const icon = c.querySelector<SVGElement>('.gantt-swimlane-icon')!;
    icon.focus();
    press(icon, 'Enter');
    const after = document.activeElement!;
    expect(icon.isConnected).toBe(false);
    expect(after.classList.contains('gantt-swimlane-icon')).toBe(true);
    expect(after.getAttribute('aria-pressed')).toBe('true');
  });

  it('kanban, re-rendered by its caller', () => {
    const parsed = parseKanban(KANBAN, palette);
    const c = container();
    const draw = (lane: string | null) =>
      renderKanban(c, parsed, palette, false, {
        currentSwimlaneGroup: lane,
        onSwimlaneChange: draw,
      });
    draw(null);
    const icon = c.querySelector<SVGElement>('.kanban-swimlane-icon')!;
    icon.focus();
    press(icon, 'Enter');
    const after = document.activeElement!;
    expect(icon.isConnected).toBe(false);
    expect(after.classList.contains('kanban-swimlane-icon')).toBe(true);
    expect(after.getAttribute('aria-label')).toBe('Group by Team');
    expect(after.getAttribute('aria-pressed')).toBe('true');
  });
});

// A render nobody can act on — export, a static docs embed — draws an icon
// with no live handler behind it. It keeps the hover <title> but must not
// announce a button that does nothing.
describe('swimlane icon stays inert when nothing can act on it (#952)', () => {
  function expectInert(icon: Element | null, group: string) {
    expect(icon).not.toBeNull();
    expect(icon!.querySelector('title')?.textContent).toBe(`Group by ${group}`);
    for (const attr of ['role', 'tabindex', 'aria-label', 'aria-pressed']) {
      expect(icon!.hasAttribute(attr)).toBe(false);
    }
  }

  it('gantt with no onSwimlaneChange', () => {
    const c = container();
    renderGantt(
      c,
      calculateSchedule(parseGantt(GANTT, palette)),
      palette,
      false,
      { currentActiveGroup: 'Team' },
      { width: 800, height: 500 }
    );
    expectInert(c.querySelector('.gantt-swimlane-icon'), 'Team');
  });

  it('timeline rendered for export', () => {
    const c = container();
    renderTimeline(
      c,
      parseVisualization(TIMELINE, palette),
      palette,
      false,
      undefined,
      { width: 800, height: 400 },
      'Status'
    );
    expectInert(c.querySelector('.tl-swimlane-icon'), 'Status');
  });
});
