import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseGantt } from '../src/gantt/parser';
import { calculateSchedule } from '../src/gantt/calculator';
import { renderGantt, buildTagLaneRowList } from '../src/gantt/renderer';
import { getPalette } from '../src/palettes';
import type { GanttInteractiveOptions } from '../src/gantt/renderer';

const palette = getPalette('nord').light;

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

function makeContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '500px';
  Object.defineProperty(container, 'clientWidth', {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: 500,
    configurable: true,
  });
  document.body.appendChild(container);
  return container;
}

function renderFromInput(input: string, options?: GanttInteractiveOptions) {
  const parsed = parseGantt(input, palette);
  const resolved = calculateSchedule(parsed);
  const container = makeContainer();
  renderGantt(container, resolved, palette, false, options, {
    width: 800,
    height: 500,
  });
  return container;
}

function resolveFromInput(input: string) {
  const parsed = parseGantt(input, palette);
  return calculateSchedule(parsed);
}

// ── Test fixture for tag swimlane tests ──────────────────────

const TAG_SWIMLANE_INPUT = `gantt
title Tag Swimlane Test
start 2024-01-15
critical-path

tag Team t
  Engineering blue
  Design purple
  QA orange

tag Phase p
  Design green
  Build orange
  Test red

era 2024-01 -> 2024-06 Phase 1
marker 2024-03-01 Kickoff

[Backend]
  30bd Database Layer | t: Engineering, p: Build, 80%
  10bd Auth Module | t: Engineering, p: Build, 100%
    -> API Integration
  parallel
    5bd Load Testing | t: QA, p: Test
    5bd Security Audit | t: Design, p: Test

[Frontend]
  15bd Component Library | t: Design, p: Design
  10bd API Integration | t: Engineering, p: Build
  5bd Polish | t: Design, p: Build, 30%

[QA]
  10bd E2E Testing
  0d Release Candidate`;

describe('gantt renderer', () => {
  it('renders SVG element', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\n10d Task A\n5d Task B'
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders task bars with data-line-number', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\n10d Task A\n5d Task B'
    );
    const tasks = container.querySelectorAll('.gantt-task');
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    // Each task group should have a data-line-number
    tasks.forEach((t) => {
      expect(t.getAttribute('data-line-number')).toBeTruthy();
    });
  });

  it('renders milestone diamonds', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\n10d Work\n0d Done'
    );
    const milestones = container.querySelectorAll('.gantt-milestone');
    expect(milestones.length).toBeGreaterThanOrEqual(1);
  });

  it('renders group labels', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\n[Backend]\n  10d Task'
    );
    const labels = container.querySelectorAll('.gantt-group-label');
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels[0].textContent).toContain('Backend');
  });

  it('renders title when present', () => {
    const container = renderFromInput(
      'gantt\ntitle My Plan\nstart 2024-01-15\n10d Task'
    );
    const texts = Array.from(container.querySelectorAll('text'));
    expect(texts.some((t) => t.textContent === 'My Plan')).toBe(true);
  });

  it('renders today marker when enabled', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\ntoday-marker 2024-01-20\n10d Task'
    );
    const todayLine = container.querySelector('.gantt-today');
    expect(todayLine).not.toBeNull();
  });

  it('renders scale ticks', () => {
    const container = renderFromInput('gantt\nstart 2024-01-15\n30d Long Task');
    const ticks = container.querySelectorAll('.gantt-scale-tick');
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('does not render when there is an error', () => {
    const parsed = parseGantt('timeline\n10d Task', palette);
    const resolved = calculateSchedule(parsed);
    const container = makeContainer();
    renderGantt(container, resolved, palette, false);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('sets data-tag attributes on task elements', () => {
    const input =
      'gantt\ntag Team t\n  Engineering blue\nstart 2024-01-15\n10d Task | t: Engineering';
    const container = renderFromInput(input);
    const task = container.querySelector('.gantt-task');
    expect(task).not.toBeNull();
    expect(task?.getAttribute('data-tag-team')).toBe('engineering');
  });

  // ── Phase 2 tests ────────────────────────────────────────

  it('renders weekend bands', () => {
    const container = renderFromInput('gantt\nstart 2024-01-15\n14d Two Weeks');
    const weekendBands = container.querySelectorAll('.gantt-weekend-band');
    expect(weekendBands.length).toBeGreaterThanOrEqual(1);
  });

  it('renders holiday bands for named holidays', () => {
    const input =
      'gantt\nstart 2024-01-15\nholiday\n  2024-01-20 Special Day\n14d Task';
    const container = renderFromInput(input);
    const holidayBands = container.querySelectorAll('.gantt-holiday-band');
    expect(holidayBands.length).toBeGreaterThanOrEqual(1);
  });

  it('renders progress fill on bar', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\n10d Task | 60%'
    );
    const progressFill = container.querySelector('.gantt-progress');
    expect(progressFill).not.toBeNull();
  });

  it('renders critical path styling when enabled', () => {
    const input =
      'gantt\nstart 2024-01-15\ncritical-path\n10d Task A\n5d Task B';
    const container = renderFromInput(input);
    const tasks = container.querySelectorAll('.gantt-task');
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it('renders uncertain gradient', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\n30d? Uncertain Task'
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const gradients = container.querySelectorAll('linearGradient');
    expect(gradients.length).toBeGreaterThanOrEqual(1);
  });

  it('renders dependency arrows when enabled', () => {
    const input = `gantt
start 2024-01-15
parallel
  10d Task A
    -> Task B
  10d Task B`;
    const container = renderFromInput(input);
    const arrows = container.querySelectorAll('.gantt-dep-arrow');
    expect(arrows.length).toBeGreaterThanOrEqual(1);
  });

  it('renders labeled dependency arrow with text element', () => {
    const input = `gantt
start 2024-01-15
parallel
  10d Task A
    -blocks-> Task B
  10d Task B`;
    const container = renderFromInput(input);
    const labels = container.querySelectorAll('.gantt-dep-label');
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels[0].textContent).toBe('blocks');
  });

  // ── Phase 3 tests ────────────────────────────────────────

  it('renders era backgrounds', () => {
    const input =
      'gantt\nstart 2024-01-15\nera 2024-01 -> 2024-06 Phase 1\n30d Task';
    const container = renderFromInput(input);
    const eras = container.querySelectorAll('.gantt-era');
    expect(eras.length).toBeGreaterThanOrEqual(1);
  });

  it('renders marker lines', () => {
    const input =
      'gantt\nstart 2024-01-15\nmarker 2024-02-01 Kickoff\n30d Task';
    const container = renderFromInput(input);
    const markers = container.querySelectorAll('.gantt-marker');
    expect(markers.length).toBeGreaterThanOrEqual(1);
  });

  it('supports collapse/expand via collapsedGroups', () => {
    const input =
      'gantt\nstart 2024-01-15\n[Backend]\n  10d Task A\n  5d Task B';
    const container = renderFromInput(input, {
      collapsedGroups: new Set(['Backend']),
    });

    // Should have group summary but fewer task bars
    const summaries = container.querySelectorAll('.gantt-group-summary');
    expect(summaries.length).toBeGreaterThanOrEqual(1);
    const tasks = container.querySelectorAll('.gantt-task');
    expect(tasks.length).toBe(0); // tasks hidden when group collapsed
  });

  it('renders task-id data attribute for hover', () => {
    const container = renderFromInput('gantt\nstart 2024-01-15\n10d Task A');
    const task = container.querySelector('.gantt-task');
    expect(task?.getAttribute('data-task-id')).toBeTruthy();
  });

  it('leaves marker labels intact when markers are far apart', () => {
    // Markers placed well inside the chart and far from each other —
    // both should keep their full labels.
    const input = `gantt
start 2024-01-01
marker 2024-03-01 Mid one
marker 2024-05-01 Mid two
200d Long Task`;
    const container = renderFromInput(input);
    const labels = Array.from(
      container.querySelectorAll('.gantt-marker-label')
    );
    const texts = labels.map((l) => l.textContent ?? '');
    expect(texts).toContain('Mid one');
    expect(texts).toContain('Mid two');
    expect(texts.every((t) => !t.endsWith('…'))).toBe(true);
  });

  it('truncates crowded marker labels with an ellipsis', () => {
    // Markers ~10 days apart on a 60-day chart — gap is enough for the
    // ellipsis plus a few characters but not the full label.
    const input = `gantt
start 2024-01-01
marker 2024-01-20 Final tune-up time trial
marker 2024-01-30 Race Day Celebration
60d Long Task`;
    const container = renderFromInput(input);
    const labels = Array.from(
      container.querySelectorAll('.gantt-marker-label')
    );
    const texts = labels.map((l) => l.textContent ?? '');
    expect(texts.length).toBe(2);
    expect(texts.every((t) => t.endsWith('…'))).toBe(true);
    // Truncated text should retain at least one real character, not be
    // just an ellipsis.
    expect(texts.every((t) => t.length > 1)).toBe(true);
  });

  it('truncates era labels that overflow their span', () => {
    // A 6-day era with a long label — should not fit within the span.
    const input = `gantt
start 2024-01-01
era 2024-06-15 -> 2024-06-21 Taper and Race Week
200d Long Task`;
    const container = renderFromInput(input);
    const eraLabel = container.querySelector('.gantt-era-label');
    expect(eraLabel).not.toBeNull();
    expect(eraLabel?.textContent?.endsWith('…')).toBe(true);
  });

  it('keeps wide-era labels intact', () => {
    const input = `gantt
start 2024-01-01
era 2024-01-01 -> 2024-06-30 Phase One
200d Long Task`;
    const container = renderFromInput(input);
    const eraLabel = container.querySelector('.gantt-era-label');
    expect(eraLabel?.textContent).toBe('Phase One');
  });

  it('restores full marker label on hover and re-truncates on leave', () => {
    const input = `gantt
start 2024-01-01
marker 2024-01-20 Final tune-up time trial
marker 2024-01-30 Race Day Celebration
60d Long Task`;
    const container = renderFromInput(input);
    const markerGroups = Array.from(
      container.querySelectorAll<SVGGElement>('.gantt-marker-group')
    );
    expect(markerGroups.length).toBe(2);

    const firstGroup = markerGroups[0];
    const firstLabel = firstGroup.querySelector('.gantt-marker-label');
    expect(firstLabel?.textContent?.endsWith('…')).toBe(true);
    const truncated = firstLabel?.textContent ?? '';

    firstGroup.dispatchEvent(new window.Event('mouseenter'));
    expect(firstLabel?.textContent).toBe('Final tune-up time trial');

    firstGroup.dispatchEvent(new window.Event('mouseleave'));
    expect(firstLabel?.textContent).toBe(truncated);
  });
});

// ── buildTagLaneRowList unit tests ──────────────────────────

describe('buildTagLaneRowList', () => {
  it('buckets tasks by tag value correctly (case-insensitive)', () => {
    const resolved = resolveFromInput(TAG_SWIMLANE_INPUT);
    const rows = buildTagLaneRowList(resolved, 'Team');
    expect(rows).not.toBeNull();

    const laneHeaders = rows!.filter((r) => r.type === 'lane-header');
    expect(
      laneHeaders.map((h) => h.type === 'lane-header' && h.laneName)
    ).toEqual(expect.arrayContaining(['Engineering', 'Design', 'QA']));

    // Engineering lane should contain Database Layer, Auth Module, API Integration
    const engIdx = rows!.findIndex(
      (r) => r.type === 'lane-header' && r.laneName === 'Engineering'
    );
    const designIdx = rows!.findIndex(
      (r) => r.type === 'lane-header' && r.laneName === 'Design'
    );
    const engTasks = rows!
      .slice(engIdx + 1, designIdx)
      .filter((r) => r.type === 'task');
    expect(engTasks.length).toBeGreaterThanOrEqual(3);
  });

  it('lane ordering follows tag entry declaration order', () => {
    const resolved = resolveFromInput(TAG_SWIMLANE_INPUT);
    const rows = buildTagLaneRowList(resolved, 'Team')!;
    const laneNames = rows
      .filter((r) => r.type === 'lane-header')
      .map((r) => (r.type === 'lane-header' ? r.laneName : ''));
    // Entries: Engineering, Design, QA — plus possibly "No Team"
    expect(laneNames[0]).toBe('Engineering');
    expect(laneNames[1]).toBe('Design');
    expect(laneNames[2]).toBe('QA');
  });

  it('untagged tasks go to No {GroupName} lane (last position)', () => {
    const resolved = resolveFromInput(TAG_SWIMLANE_INPUT);
    const rows = buildTagLaneRowList(resolved, 'Team')!;
    const laneNames = rows
      .filter((r) => r.type === 'lane-header')
      .map((r) => (r.type === 'lane-header' ? r.laneName : ''));
    // E2E Testing and Release Candidate have no team tag
    if (laneNames.includes('No Team')) {
      expect(laneNames[laneNames.length - 1]).toBe('No Team');
    }
  });

  it('invalid swimlane group returns null', () => {
    const resolved = resolveFromInput(TAG_SWIMLANE_INPUT);
    const rows = buildTagLaneRowList(resolved, 'NonExistent');
    expect(rows).toBeNull();
  });

  it('empty lane (tag entry with no matching tasks) — skipped entirely', () => {
    // Tag entries with no tasks should not appear as swimlanes
    const input = `gantt
start 2024-01-15
tag Status
  Active green
  Deferred gray
10d Task A | Status: Active`;
    const resolved = resolveFromInput(input);
    const rows = buildTagLaneRowList(resolved, 'Status')!;
    const deferredHeader = rows.find(
      (r) => r.type === 'lane-header' && r.laneName === 'Deferred'
    );
    expect(deferredHeader).toBeUndefined();
    const activeHeader = rows.find(
      (r) => r.type === 'lane-header' && r.laneName === 'Active'
    );
    expect(activeHeader).toBeDefined();
  });

  it('all tasks untagged → default tag value applied (first entry)', () => {
    const input = `gantt
start 2024-01-15
tag Team
  Engineering blue
  Design purple
10d Task A
5d Task B`;
    const resolved = resolveFromInput(input);
    const rows = buildTagLaneRowList(resolved, 'Team')!;
    const laneHeaders = rows.filter((r) => r.type === 'lane-header');
    // First tag entry (Engineering) is the default — all untagged tasks go there
    expect(laneHeaders.length).toBe(1);
    expect(
      laneHeaders[0].type === 'lane-header' &&
        laneHeaders[0].laneName === 'Engineering'
    ).toBe(true);
    const taskRows = rows.filter((r) => r.type === 'task');
    expect(taskRows.length).toBe(2);
  });

  it('flat chart (no groups) + tag swimlanes works correctly', () => {
    const input = `gantt
start 2024-01-15
tag Team
  A blue
  B red
10d Task 1 | Team: A
5d Task 2 | Team: B`;
    const resolved = resolveFromInput(input);
    const rows = buildTagLaneRowList(resolved, 'Team')!;
    expect(rows).not.toBeNull();
    const laneHeaders = rows.filter((r) => r.type === 'lane-header');
    expect(laneHeaders.length).toBe(2); // A and B
  });

  it('aggregate progress is duration-weighted across all tasks (missing progress = 0%)', () => {
    const input = `gantt
start 2024-01-15
tag Team
  Eng blue
10d Task A | Team: Eng, 80%
10d Task B | Team: Eng, 40%
10d Task C | Team: Eng`;
    const resolved = resolveFromInput(input);
    const rows = buildTagLaneRowList(resolved, 'Team')!;
    const header = rows.find(
      (r) => r.type === 'lane-header' && r.laneName === 'Eng'
    );
    expect(header).toBeDefined();
    if (header?.type === 'lane-header') {
      // (80*10 + 40*10 + 0*10) / (10+10+10) = 40
      expect(header.aggregateProgress).toBe(40);
    }
  });

  it('default tag entry set → no No {GroupName} lane', () => {
    const resolved = resolveFromInput(TAG_SWIMLANE_INPUT);
    // Phase tag has "Test" as default
    const rows = buildTagLaneRowList(resolved, 'Phase')!;
    const laneNames = rows
      .filter((r) => r.type === 'lane-header')
      .map((r) => (r.type === 'lane-header' ? r.laneName : ''));
    expect(laneNames).not.toContain('No Phase');
  });
});

// ── Tag swimlane rendering tests ────────────────────────────

describe('tag swimlane rendering', () => {
  it('renders lane headers with data-lane attributes', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const laneHeaders = container.querySelectorAll('.gantt-lane-header');
    expect(laneHeaders.length).toBeGreaterThanOrEqual(3);
    const laneNames = Array.from(laneHeaders).map((h) =>
      h.getAttribute('data-lane')
    );
    expect(laneNames).toContain('Engineering');
    expect(laneNames).toContain('Design');
    expect(laneNames).toContain('QA');
  });

  it('hides group labels when swimlane active', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const groupLabels = container.querySelectorAll('.gantt-group-label');
    expect(groupLabels.length).toBe(0);
  });

  it('renders dependency arrows when swimlane active', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const arrows = container.querySelectorAll('.gantt-dep-arrow');
    expect(arrows.length).toBeGreaterThanOrEqual(1);
  });

  it('renders task elements with data-tag attributes in tag mode', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const tasks = container.querySelectorAll('.gantt-task');
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    // Tasks should still have tag attributes
    const taskWithTag = Array.from(tasks).find((t) =>
      t.getAttribute('data-tag-team')
    );
    expect(taskWithTag).toBeDefined();
  });

  it('renders critical path attributes in tag mode', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const criticalTasks = container.querySelectorAll('[data-critical-path]');
    expect(criticalTasks.length).toBeGreaterThanOrEqual(1);
  });

  it('renders progress fill in tag mode', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const progressBars = container.querySelectorAll('.gantt-progress');
    expect(progressBars.length).toBeGreaterThanOrEqual(1);
  });

  it('renders swimlane icon when a tag group is active', () => {
    // Per spec §1.3, tag groups are collapsed-by-default. The swimlane
    // icon lives inside the active capsule, so coloring/expansion
    // requires an explicit `currentActiveGroup` (mirroring an
    // `active-tag` directive or user click).
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentActiveGroup: 'Team',
      currentSwimlaneGroup: 'Team',
    });
    const icons = container.querySelectorAll('.gantt-swimlane-icon');
    expect(icons.length).toBeGreaterThanOrEqual(1);
  });

  it('hides swimlane icon when viewMode is true', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, { viewMode: true });
    const icons = container.querySelectorAll('.gantt-swimlane-icon');
    expect(icons.length).toBe(0);
  });

  it('no tag groups → identical output, no icons', () => {
    const input = 'gantt\nstart 2024-01-15\n10d Task A\n5d Task B';
    const container = renderFromInput(input);
    const icons = container.querySelectorAll('.gantt-swimlane-icon');
    expect(icons.length).toBe(0);
    const laneHeaders = container.querySelectorAll('.gantt-lane-header');
    expect(laneHeaders.length).toBe(0);
  });

  it('structural fallback — invalid currentSwimlaneGroup renders group headers', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'NonExistent',
    });
    const groupLabels = container.querySelectorAll('.gantt-group-label');
    expect(groupLabels.length).toBeGreaterThanOrEqual(1);
    const laneHeaders = container.querySelectorAll('.gantt-lane-header');
    expect(laneHeaders.length).toBe(0);
  });

  it('renders eras and markers in tag mode', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const eras = container.querySelectorAll('.gantt-era');
    expect(eras.length).toBeGreaterThanOrEqual(1);
    const markers = container.querySelectorAll('.gantt-marker');
    expect(markers.length).toBeGreaterThanOrEqual(1);
  });

  it('collapsed lane hides task rows but keeps header', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
      collapsedLanes: new Set(['Engineering']),
    });
    const laneHeaders = container.querySelectorAll('.gantt-lane-header');
    expect(laneHeaders.length).toBeGreaterThanOrEqual(3);
    // Engineering header should still be present
    const engHeader = Array.from(laneHeaders).find(
      (h) => h.getAttribute('data-lane') === 'Engineering'
    );
    expect(engHeader).toBeDefined();
    // But Engineering tasks should be hidden — only non-Engineering tasks rendered
    const tasks = container.querySelectorAll('.gantt-task');
    const engTasks = Array.from(tasks).filter(
      (t) => t.getAttribute('data-tag-team') === 'engineering'
    );
    expect(engTasks.length).toBe(0);
  });

  it('collapsed lane shows toggle icon ▶', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
      collapsedLanes: new Set(['Engineering']),
    });
    const engHeader = Array.from(
      container.querySelectorAll('.gantt-lane-header')
    ).find((h) => h.getAttribute('data-lane') === 'Engineering');
    expect(engHeader?.textContent).toContain('▶');
  });

  it('expanded lane shows toggle icon ▼', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const engHeader = Array.from(
      container.querySelectorAll('.gantt-lane-header')
    ).find((h) => h.getAttribute('data-lane') === 'Engineering');
    expect(engHeader?.textContent).toContain('▼');
  });
});

// ── buildTagLaneRowList collapse tests ──────────────────────

describe('buildTagLaneRowList with collapsedLanes', () => {
  it('collapsed lane emits header but no task rows', () => {
    const resolved = resolveFromInput(TAG_SWIMLANE_INPUT);
    const rows = buildTagLaneRowList(
      resolved,
      'Team',
      new Set(['Engineering'])
    )!;
    const engIdx = rows.findIndex(
      (r) => r.type === 'lane-header' && r.laneName === 'Engineering'
    );
    expect(engIdx).toBeGreaterThanOrEqual(0);
    // Next row should NOT be a task — should be another lane-header or end
    const nextRow = rows[engIdx + 1];
    expect(nextRow?.type).not.toBe('task');
  });

  it('isCollapsed flag set correctly', () => {
    const resolved = resolveFromInput(TAG_SWIMLANE_INPUT);
    const rows = buildTagLaneRowList(
      resolved,
      'Team',
      new Set(['Engineering'])
    )!;
    const engHeader = rows.find(
      (r) => r.type === 'lane-header' && r.laneName === 'Engineering'
    );
    const designHeader = rows.find(
      (r) => r.type === 'lane-header' && r.laneName === 'Design'
    );
    expect(engHeader?.type === 'lane-header' && engHeader.isCollapsed).toBe(
      true
    );
    expect(
      designHeader?.type === 'lane-header' && designHeader.isCollapsed
    ).toBe(false);
  });
});

// ── Dependency arrows in tag mode ────────────────────────────

describe('dependency arrows in tag mode', () => {
  it('arrows present in tag mode with dependencies on', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const arrows = container.querySelectorAll('.gantt-dep-arrow');
    expect(arrows.length).toBeGreaterThanOrEqual(1);
  });

  it('arrowheads count matches arrow count', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const arrows = container.querySelectorAll('.gantt-dep-arrow');
    const arrowheads = container.querySelectorAll('.gantt-dep-arrowhead');
    expect(arrowheads.length).toBe(arrows.length);
  });

  it('no arrows when dependencies off', () => {
    const input = TAG_SWIMLANE_INPUT.replace(
      'critical-path',
      'critical-path\nno-dependencies'
    );
    const container = renderFromInput(input, { currentSwimlaneGroup: 'Team' });
    const arrows = container.querySelectorAll('.gantt-dep-arrow');
    expect(arrows.length).toBe(0);
  });

  it('collapsed lane redirects arrows to lane header position', () => {
    // Cross-lane dep: Task A (Alpha) -> Task B (Beta) — collapsing Beta redirects target
    const input = `gantt
start 2024-01-15
tag Lane
  Alpha blue
  Beta red
parallel
  10d Task A | Lane: Alpha
    -> Task B
  10d Task B | Lane: Beta`;
    const container = renderFromInput(input, {
      currentSwimlaneGroup: 'Lane',
      collapsedLanes: new Set(['Beta']),
    });
    const arrows = container.querySelectorAll('.gantt-dep-arrow');
    expect(arrows.length).toBeGreaterThanOrEqual(1);
  });

  it('structural mode regression — arrows still render', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT);
    const arrows = container.querySelectorAll('.gantt-dep-arrow');
    expect(arrows.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Hover Date Indicators ─────────────────────────────────────

describe('hover date indicators', () => {
  it('shows dashed lines and date labels on task bar hover', () => {
    const container = renderFromInput('gantt\nstart 2024-01-15\n10d Task A');
    const task = container.querySelector('.gantt-task');
    expect(task).toBeTruthy();

    // Dispatch mouseenter
    task!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    // Should have gantt-hover-date elements (lines + text labels)
    const hoverDates = container.querySelectorAll('.gantt-hover-date');
    expect(hoverDates.length).toBeGreaterThanOrEqual(3); // 1 line + 2 labels for start, same for end

    // Scale ticks should be faded
    const scaleTick = container.querySelector('.gantt-scale-tick');
    if (scaleTick) {
      expect(Number(scaleTick.getAttribute('opacity'))).toBeLessThan(0.1);
    }

    // Dispatch mouseleave — should clean up
    task!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    const hoverDatesAfter = container.querySelectorAll('.gantt-hover-date');
    expect(hoverDatesAfter.length).toBe(0);
  });

  it('shows single indicator line on milestone hover', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\n0d Milestone A'
    );
    const milestone = container.querySelector('.gantt-milestone');
    expect(milestone).toBeTruthy();

    milestone!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const hoverDates = container.querySelectorAll('.gantt-hover-date');
    // Wrapper <g> + 1 line + 2 labels = 4
    expect(hoverDates.length).toBe(4);
  });

  it('shows indicators on group bar hover', () => {
    const container = renderFromInput(
      'gantt\nstart 2024-01-15\n\n[Backend]\n  5d Task A\n  5d Task B'
    );
    const groupBar = container.querySelector('.gantt-group-bar');
    expect(groupBar).toBeTruthy();

    groupBar!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const hoverDates = container.querySelectorAll('.gantt-hover-date');
    expect(hoverDates.length).toBeGreaterThanOrEqual(3);
  });
});

describe('left panel visual enhancements', () => {
  const groupedInput = `gantt
start 2024-01-15
tag Team t
  Engineering blue
  Design purple

[Backend]
  10d Database Layer | t: Engineering
  5d Auth Module | t: Engineering

[Frontend]
  10d Component Library | t: Design
  0d Release Milestone`;

  it('renders group band background and accent rects', () => {
    const container = renderFromInput(groupedInput);
    const bgBands = container.querySelectorAll('.gantt-group-band-bg');
    const accentBands = container.querySelectorAll('.gantt-group-band-accent');
    expect(bgBands.length).toBe(2); // Backend + Frontend
    expect(accentBands.length).toBe(2);
  });

  it('group band rects have pointer-events none', () => {
    const container = renderFromInput(groupedInput);
    const bg = container.querySelector('.gantt-group-band-bg') as SVGElement;
    expect(bg).toBeTruthy();
    expect(bg.style.pointerEvents).toBe('none');
  });

  it('group band rects have data-group attribute', () => {
    const container = renderFromInput(groupedInput);
    const bgs = container.querySelectorAll('.gantt-group-band-bg');
    const groups = Array.from(bgs).map((el) => el.getAttribute('data-group'));
    expect(groups).toContain('Backend');
    expect(groups).toContain('Frontend');
  });

  it('renders task labels with icon tspan', () => {
    const container = renderFromInput(groupedInput);
    const label = container.querySelector('.gantt-task-label');
    expect(label).toBeTruthy();
    const tspans = label!.querySelectorAll('tspan');
    expect(tspans.length).toBe(2);
    expect(tspans[0].textContent).toBe('●');
  });

  it('renders milestone labels with diamond icon', () => {
    const container = renderFromInput(groupedInput);
    const labels = container.querySelectorAll('.gantt-task-label');
    const milestoneTspans = Array.from(labels).find(
      (l) => l.querySelector('tspan')?.textContent === '◆'
    );
    expect(milestoneTspans).toBeTruthy();
  });

  it('renders lane band in swimlane mode', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const bgBands = container.querySelectorAll('.gantt-lane-band-bg');
    const accentBands = container.querySelectorAll('.gantt-lane-band-accent');
    expect(bgBands.length).toBeGreaterThan(0);
    expect(accentBands.length).toBeGreaterThan(0);
  });

  it('lane band rects have data-lane attribute', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const bgs = container.querySelectorAll('.gantt-lane-band-bg');
    const lanes = Array.from(bgs).map((el) => el.getAttribute('data-lane'));
    expect(lanes).toContain('Engineering');
    expect(lanes).toContain('Design');
  });

  it('task icons use tspan in swimlane mode too', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const label = container.querySelector('.gantt-task-label');
    expect(label).toBeTruthy();
    const tspans = label!.querySelectorAll('tspan');
    expect(tspans.length).toBe(2);
    expect(['●', '◆']).toContain(tspans[0].textContent);
  });

  it('ungrouped flat tasks get dot icon with no bands', () => {
    const flatInput = `gantt
start 2024-01-15

5d Task A
5d Task B`;
    const container = renderFromInput(flatInput);
    expect(container.querySelectorAll('.gantt-group-band-bg').length).toBe(0);
    const label = container.querySelector('.gantt-task-label');
    const tspans = label!.querySelectorAll('tspan');
    expect(tspans.length).toBe(2);
    expect(tspans[0].textContent).toBe('●');
  });

  it('deep nesting reduces indent step at depth 3+', () => {
    // Depth 0→2 uses 14px per level; depth 3+ uses 8px per level
    // At depth 2: 6 + 2*14 = 34
    // At depth 3: 6 + 2*14 + 1*8 = 42 (not 6 + 3*14 = 48)
    const deepInput = `gantt
start 2024-01-15

[Level0]
  [Level1]
    [Level2]
      5d Deep Task`;
    const container = renderFromInput(deepInput);
    const taskLabel = container.querySelector('.gantt-task-label');
    expect(taskLabel).toBeTruthy();
    const x = Number(taskLabel!.getAttribute('x'));
    // depth=3 → 6 + 2*14 + 1*8 = 42
    expect(x).toBe(42);
  });
});

// ── Controls Group (Gantt integration) ───────────────────────

describe('gantt controls group', () => {
  it('renders controls group gear pill when critical path is present', () => {
    const input =
      'gantt\nstart 2024-01-15\ncritical-path\n10d Task A\n5d Task B';
    const container = renderFromInput(input);
    const controls = container.querySelector('[data-legend-controls]');
    expect(controls).not.toBeNull();
  });

  it('does not render controls group when no critical path or dependencies', () => {
    const input =
      'gantt\nstart 2024-01-15\nno-critical-path\nno-dependencies\n10d Task A\n5d Task B';
    const container = renderFromInput(input);
    const controls = container.querySelector('[data-legend-controls]');
    expect(controls).toBeNull();
  });

  it('standalone critical path pill class is removed', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT);
    const oldPill = container.querySelector('.gantt-legend-critical-path');
    expect(oldPill).toBeNull();
  });

  it('renders controls group in tag mode with critical path', () => {
    const container = renderFromInput(TAG_SWIMLANE_INPUT, {
      currentSwimlaneGroup: 'Team',
    });
    const controls = container.querySelector('[data-legend-controls]');
    expect(controls).not.toBeNull();
  });

  it('suppresses the inline gear when controlsHost is "app"', () => {
    const input =
      'gantt\nstart 2024-01-15\ncritical-path\n10d Task A\n5d Task B';
    const inline = renderFromInput(input);
    expect(inline.querySelector('[data-legend-controls]')).not.toBeNull();

    const appHosted = renderFromInput(input, { controlsHost: 'app' });
    expect(appHosted.querySelector('[data-legend-controls]')).toBeNull();
    expect(appHosted.querySelector('.controls-gear-pill')).toBeNull();
  });

  it('applies seeded critical-path highlight on first draw under app host', () => {
    const input =
      'gantt\nstart 2024-01-15\ncritical-path\n10d Task A\n5d Task B';
    const container = renderFromInput(input, {
      controlsHost: 'app',
      criticalPathActive: true,
    });
    // No inline gear, but the highlight effect is applied at render time.
    expect(container.querySelector('[data-legend-controls]')).toBeNull();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-critical-path-active')).not.toBeNull();
  });
});
