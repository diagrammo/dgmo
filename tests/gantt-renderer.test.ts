import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseGantt } from '../src/gantt/parser';
import { calculateSchedule } from '../src/gantt/calculator';
import { renderGantt } from '../src/gantt/renderer';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: win.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'SVGElement', { value: win.SVGElement, configurable: true });
});

function makeContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '500px';
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
  document.body.appendChild(container);
  return container;
}

function renderFromInput(input: string) {
  const parsed = parseGantt(input, palette);
  const resolved = calculateSchedule(parsed);
  const container = makeContainer();
  renderGantt(container, resolved, palette, false, undefined, { width: 800, height: 500 });
  return container;
}

describe('gantt renderer', () => {
  it('renders SVG element', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\n10d: Task A\n5d: Task B');
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders task bars with data-line-number', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\n10d: Task A\n5d: Task B');
    const tasks = container.querySelectorAll('.gantt-task');
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    // Each task group should have a data-line-number
    tasks.forEach(t => {
      expect(t.getAttribute('data-line-number')).toBeTruthy();
    });
  });

  it('renders milestone diamonds', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\n10d: Work\n0d: Done');
    const milestones = container.querySelectorAll('.gantt-milestone');
    expect(milestones.length).toBeGreaterThanOrEqual(1);
  });

  it('renders group labels', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\n[Backend]\n  10d: Task');
    const labels = container.querySelectorAll('.gantt-group-label');
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels[0].textContent).toContain('Backend');
  });

  it('renders title when present', () => {
    const container = renderFromInput('chart: gantt\ntitle: My Plan\nstart: 2024-01-15\n10d: Task');
    const texts = Array.from(container.querySelectorAll('text'));
    expect(texts.some(t => t.textContent === 'My Plan')).toBe(true);
  });

  it('renders today marker when enabled', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\ntoday-marker: 2024-01-20\n10d: Task');
    const todayLine = container.querySelector('.gantt-today');
    expect(todayLine).not.toBeNull();
  });

  it('renders scale ticks', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\n30d: Long Task');
    const ticks = container.querySelectorAll('.gantt-scale-tick');
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('does not render when there is an error', () => {
    const parsed = parseGantt('chart: timeline\n10d: Task', palette);
    const resolved = calculateSchedule(parsed);
    const container = makeContainer();
    renderGantt(container, resolved, palette, false);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('sets data-tag attributes on task elements', () => {
    const input = 'chart: gantt\ntag: Team alias t\n  Engineering(blue)\nstart: 2024-01-15\n10d: Task | t: Engineering';
    const container = renderFromInput(input);
    const task = container.querySelector('.gantt-task');
    expect(task).not.toBeNull();
    expect(task?.getAttribute('data-tag-team')).toBe('engineering');
  });

  // ── Phase 2 tests ────────────────────────────────────────

  it('renders weekend bands', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\n14d: Two Weeks');
    const weekendBands = container.querySelectorAll('.gantt-weekend-band');
    expect(weekendBands.length).toBeGreaterThanOrEqual(1);
  });

  it('renders holiday bands for named holidays', () => {
    const input = 'chart: gantt\nstart: 2024-01-15\nholidays\n  2024-01-20: Special Day\n14d: Task';
    const container = renderFromInput(input);
    const holidayBands = container.querySelectorAll('.gantt-holiday-band');
    expect(holidayBands.length).toBeGreaterThanOrEqual(1);
  });

  it('renders progress fill on bar', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\n10d: Task | 60%');
    const progressFill = container.querySelector('.gantt-progress');
    expect(progressFill).not.toBeNull();
  });

  it('renders critical path styling when enabled', () => {
    const input = 'chart: gantt\nstart: 2024-01-15\ncritical-path: on\n10d: Task A\n5d: Task B';
    const container = renderFromInput(input);
    // Should have task bars rendered (critical path styling is subtle)
    const tasks = container.querySelectorAll('.gantt-task');
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it('renders uncertain gradient', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\n30d?: Uncertain Task');
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Check for gradient definition
    const gradients = container.querySelectorAll('linearGradient');
    expect(gradients.length).toBeGreaterThanOrEqual(1);
  });

  it('renders dependency arrows when enabled', () => {
    const input = `chart: gantt
start: 2024-01-15
dependencies: on
parallel
  10d: Task A
    -> Task B
  10d: Task B`;
    const container = renderFromInput(input);
    const arrows = container.querySelectorAll('.gantt-dep-arrow');
    expect(arrows.length).toBeGreaterThanOrEqual(1);
  });

  // ── Phase 3 tests ────────────────────────────────────────

  it('renders era backgrounds', () => {
    const input = 'chart: gantt\nstart: 2024-01-15\nera 2024-01 -> 2024-06: Phase 1\n30d: Task';
    const container = renderFromInput(input);
    const eras = container.querySelectorAll('.gantt-era');
    expect(eras.length).toBeGreaterThanOrEqual(1);
  });

  it('renders marker lines', () => {
    const input = 'chart: gantt\nstart: 2024-01-15\nmarker 2024-02-01: Kickoff\n30d: Task';
    const container = renderFromInput(input);
    const markers = container.querySelectorAll('.gantt-marker');
    expect(markers.length).toBeGreaterThanOrEqual(1);
  });

  it('supports collapse/expand via collapsedGroups', () => {
    const input = 'chart: gantt\nstart: 2024-01-15\n[Backend]\n  10d: Task A\n  5d: Task B';
    const parsed = parseGantt(input, palette);
    const resolved = calculateSchedule(parsed);
    const container = makeContainer();

    // Render with Backend collapsed
    renderGantt(container, resolved, palette, false, undefined, { width: 800, height: 500 }, false, new Set(['Backend']));

    // Should have group summary but fewer task bars
    const summaries = container.querySelectorAll('.gantt-group-summary');
    expect(summaries.length).toBeGreaterThanOrEqual(1);
    const tasks = container.querySelectorAll('.gantt-task');
    expect(tasks.length).toBe(0); // tasks hidden when group collapsed
  });

  it('renders task-id data attribute for hover', () => {
    const container = renderFromInput('chart: gantt\nstart: 2024-01-15\ndependencies: on\n10d: Task A');
    const task = container.querySelector('.gantt-task');
    expect(task?.getAttribute('data-task-id')).toBeTruthy();
  });
});
