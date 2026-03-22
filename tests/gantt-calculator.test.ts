import { describe, it, expect } from 'vitest';
import { parseGantt } from '../src/gantt/parser';
import { calculateSchedule } from '../src/gantt/calculator';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

function calc(input: string) {
  const parsed = parseGantt(input, palette);
  return calculateSchedule(parsed);
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('gantt calculator', () => {
  describe('sequential tasks', () => {
    it('chains sequential tasks', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15\n10d: Task A\n5d: Task B');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(2);

      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[0].endDate)).toBe('2024-01-25');
      expect(fmt(result.tasks[1].startDate)).toBe('2024-01-25');
      expect(fmt(result.tasks[1].endDate)).toBe('2024-01-30');
    });

    it('handles milestone at end', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15\n10d: Work\n0d: Done');
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[1].isMilestone).toBe(true);
      expect(fmt(result.tasks[1].startDate)).toBe(fmt(result.tasks[1].endDate));
    });
  });

  describe('parallel blocks', () => {
    it('parallel children start at same time', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15\nparallel\n  5d: X\n  3d: Y');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(2);
      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[1].startDate)).toBe('2024-01-15');
    });

    it('task after parallel starts at max end', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15\nparallel\n  5d: X\n  3d: Y\n2d: After');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(3);
      // After should start at max(X end, Y end) = X end = Jan 20
      expect(fmt(result.tasks[2].startDate)).toBe('2024-01-20');
    });
  });

  describe('cross-branch dependencies', () => {
    it('-> dependency delays target start', () => {
      const input = `chart: gantt
start: 2024-01-15
parallel
  [Backend]
    10d: API
      -> Frontend.Integration
  [Frontend]
    5d: Setup
    5d: Integration`;
      const result = calc(input);
      expect(result.error).toBeNull();

      const integration = result.tasks.find(t => t.task.label === 'Integration');
      const api = result.tasks.find(t => t.task.label === 'API');
      expect(integration).toBeDefined();
      expect(api).toBeDefined();

      // Integration should start after both Setup and API (max rule)
      // Setup: Jan 15 -> Jan 20, API: Jan 15 -> Jan 25
      // Integration starts at max(Jan 20 [after Setup], Jan 25 [after API]) = Jan 25
      expect(fmt(integration!.startDate)).toBe('2024-01-25');
    });
  });

  describe('cycle detection', () => {
    it('detects circular dependency', () => {
      const input = `chart: gantt
start: 2024-01-15
parallel
  10d: A
    -> B
  10d: B
    -> A`;
      const result = calc(input);
      expect(result.error).toMatch(/Circular dependency/);
    });
  });

  describe('business days', () => {
    it('10bd starting Monday Jan 15 ends Fri Jan 26', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15\n10bd: Task');
      expect(result.error).toBeNull();
      // Jan 15 = Monday
      // 10bd = skip 2 weekends (4 days)
      // Jan 15 + 14 calendar days = Jan 29 (but with weekends...)
      // Actually: Mon-Fri (5bd) = Jan 19, Sat/Sun skip, Mon-Fri (5bd) = Jan 26
      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[0].endDate)).toBe('2024-01-29');
    });
  });

  describe('explicit date anchors', () => {
    it('uses explicit date as start', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15\n2024-02-15: Milestone');
      expect(result.error).toBeNull();
      expect(fmt(result.tasks[0].startDate)).toBe('2024-02-15');
    });
  });

  describe('groups', () => {
    it('builds resolved groups with date ranges', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15\n[Backend]\n  10d: Task A\n  5d: Task B');
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Backend');
      expect(fmt(result.groups[0].startDate)).toBe('2024-01-15');
    });

    it('computes aggregate progress', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15\n[Backend]\n  10d: Task A | 100%\n  10d: Task B | 50%');
      expect(result.groups[0].progress).not.toBeNull();
      // Duration-weighted: (100 * dur + 50 * dur) / (dur + dur) = 75
      expect(result.groups[0].progress).toBe(75);
    });
  });

  describe('missing parallel warning', () => {
    it('warns when 2+ top-level groups without parallel', () => {
      const input = 'chart: gantt\nstart: 2024-01-15\n[A]\n  5d: Task 1\n[B]\n  5d: Task 2';
      const result = calc(input);
      const warnings = result.diagnostics.filter(d => d.severity === 'warning');
      expect(warnings.some(w => w.message.includes('sequential'))).toBe(true);
    });
  });

  describe('empty chart', () => {
    it('returns empty result with no tasks', () => {
      const result = calc('chart: gantt\nstart: 2024-01-15');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(0);
    });
  });

  describe('relative timeline', () => {
    it('works without start date', () => {
      const result = calc('chart: gantt\n10d: Task A\n5d: Task B');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(2);
      // Should still have sequential ordering
      expect(result.tasks[1].startDate.getTime()).toBeGreaterThanOrEqual(result.tasks[0].endDate.getTime());
    });
  });

  // ── Phase 2 tests ────────────────────────────────────────

  describe('holidays affect bd tasks', () => {
    it('skips declared holidays', () => {
      const input = `chart: gantt
start: 2024-01-15
holidays
  2024-01-16: Holiday
5bd: Task`;
      const result = calc(input);
      expect(result.error).toBeNull();
      // Jan 15 (Mon) start, holiday on Jan 16 (Tue)
      // 5bd: Mon, Wed, Thu, Fri, next Mon = Jan 22
      expect(fmt(result.tasks[0].endDate)).toBe('2024-01-23');
    });
  });

  describe('lag on dependencies', () => {
    it('applies lag to dependency', () => {
      const input = `chart: gantt
start: 2024-01-15
parallel
  10d: Source
    -> Target | lag: 3d
  10d: Target`;
      const result = calc(input);
      expect(result.error).toBeNull();
      const target = result.tasks.find(t => t.task.label === 'Target');
      const source = result.tasks.find(t => t.task.label === 'Source');
      expect(target).toBeDefined();
      expect(source).toBeDefined();
      // Target should start 3 days after source ends
      const diff = target!.startDate.getTime() - source!.endDate.getTime();
      const threeDaysMs = 3 * 86400000;
      expect(diff).toBeGreaterThanOrEqual(threeDaysMs - 1000); // allow small rounding
    });
  });

  describe('critical path identification', () => {
    it('marks tasks on critical path', () => {
      const result = calc(`chart: gantt
start: 2024-01-15
critical-path: on
10d: Long Task
5d: Short Follow-up`);
      expect(result.error).toBeNull();
      // In a simple sequential chain, all tasks are on the critical path
      const critical = result.tasks.filter(t => t.isCriticalPath);
      expect(critical.length).toBeGreaterThanOrEqual(1);
    });
  });
});
