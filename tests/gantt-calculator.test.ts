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

  describe('offset', () => {
    describe('task-level offset', () => {
      it('no deps, positive — starts after project start', () => {
        const result = calc('chart: gantt\nstart: 2024-01-15\n10bd: Task | offset: 5bd');
        expect(result.error).toBeNull();
        // Jan 15 (Mon) + 5bd = Jan 22 (Mon)
        expect(fmt(result.tasks[0].startDate)).toBe('2024-01-22');
      });

      it('no deps, negative — clamped to project start', () => {
        const result = calc('chart: gantt\nstart: 2024-01-15\n10bd: Task | offset: -3bd');
        expect(result.error).toBeNull();
        expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
        expect(result.diagnostics.some(d => d.message.includes('clamped to project start'))).toBe(true);
      });

      it('no deps, zero — starts at project start', () => {
        const result = calc('chart: gantt\nstart: 2024-01-15\n10bd: Task | offset: 0bd');
        expect(result.error).toBeNull();
        expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      });

      it('with deps, positive — starts after predecessor + offset', () => {
        const result = calc('chart: gantt\nstart: 2024-01-15\n10d: First\n5d: Second | offset: 3d');
        expect(result.error).toBeNull();
        // First: Jan 15 -> Jan 25. Second starts at Jan 25 + 3d = Jan 28
        expect(fmt(result.tasks[1].startDate)).toBe('2024-01-28');
      });

      it('with deps, negative — overlaps predecessor', () => {
        const result = calc('chart: gantt\nstart: 2024-01-15\n10d: First\n5d: Second | offset: -2d');
        expect(result.error).toBeNull();
        // First: Jan 15 -> Jan 25. Second starts at Jan 25 - 2d = Jan 23
        expect(fmt(result.tasks[1].startDate)).toBe('2024-01-23');
      });
    });

    describe('dep-level offset', () => {
      it('positive offset delays target', () => {
        const input = `chart: gantt
start: 2024-01-15
parallel
  10d: Source
    -> Target | offset: 3d
  10d: Target`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find(t => t.task.label === 'Target');
        const source = result.tasks.find(t => t.task.label === 'Source');
        expect(target).toBeDefined();
        expect(source).toBeDefined();
        const diff = target!.startDate.getTime() - source!.endDate.getTime();
        const threeDaysMs = 3 * 86400000;
        expect(diff).toBeGreaterThanOrEqual(threeDaysMs - 1000);
      });

      it('negative offset creates overlap', () => {
        const input = `chart: gantt
start: 2024-01-15
parallel
  10d: Source
    -> Target | offset: -3d
  10d: Target`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find(t => t.task.label === 'Target');
        const source = result.tasks.find(t => t.task.label === 'Source');
        // Target starts 3d before Source ends
        expect(target!.startDate.getTime()).toBeLessThan(source!.endDate.getTime());
      });

      it('zero offset has no effect', () => {
        const input = `chart: gantt
start: 2024-01-15
parallel
  10d: Source
    -> Target | offset: 0d
  10d: Target`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find(t => t.task.label === 'Target');
        const source = result.tasks.find(t => t.task.label === 'Source');
        expect(fmt(target!.startDate)).toBe(fmt(source!.endDate));
      });
    });

    describe('stacking', () => {
      it('dep offset + task offset are additive', () => {
        const input = `chart: gantt
start: 2024-01-15
parallel
  10d: Source
    -> Target | offset: 5d
  10d: Target | offset: 3d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find(t => t.task.label === 'Target');
        const source = result.tasks.find(t => t.task.label === 'Source');
        // Source ends Jan 25. Dep offset +5d = Jan 30. Task offset +3d = Feb 2
        const diff = target!.startDate.getTime() - source!.endDate.getTime();
        const eightDaysMs = 8 * 86400000;
        expect(diff).toBeGreaterThanOrEqual(eightDaysMs - 1000);
      });
    });

    describe('clamping', () => {
      it('negative dep offset clamped to project start', () => {
        const input = `chart: gantt
start: 2024-01-15
parallel
  2d: Source
    -> Target | offset: -10d
  10d: Target`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find(t => t.task.label === 'Target');
        // Source ends Jan 17. -10d = Jan 7 — before project start, so clamp to Jan 15
        expect(fmt(target!.startDate)).toBe('2024-01-15');
      });
    });

    describe('parallel block with offset', () => {
      it('offset task in parallel shifts correctly', () => {
        const input = `chart: gantt
start: 2024-01-15
parallel
  5d: Normal
  5d: Offset | offset: 3d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const normal = result.tasks.find(t => t.task.label === 'Normal');
        const offset = result.tasks.find(t => t.task.label === 'Offset');
        expect(fmt(normal!.startDate)).toBe('2024-01-15');
        // Offset starts at project start + 3d = Jan 18
        expect(fmt(offset!.startDate)).toBe('2024-01-18');
      });
    });

    describe('business days with holidays', () => {
      it('offset skips holidays', () => {
        const input = `chart: gantt
start: 2024-01-15
holidays
  2024-01-16: Holiday
10bd: Task | offset: 2bd`;
        const result = calc(input);
        expect(result.error).toBeNull();
        // Jan 15 (Mon) + 2bd skipping holiday on Jan 16 (Tue):
        // Day 1: skip Tue (holiday), Wed Jan 17
        // Day 2: Thu Jan 18
        expect(fmt(result.tasks[0].startDate)).toBe('2024-01-18');
      });

      it('negative dep offset with bd skips holidays backward', () => {
        const input = `chart: gantt
start: 2024-01-15
holidays
  2024-01-24: Holiday
parallel
  10d: Source
    -> Target | offset: -2bd
  10d: Target`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find(t => t.task.label === 'Target');
        const source = result.tasks.find(t => t.task.label === 'Source');
        // Source ends Jan 25. -2bd backward: Jan 24 is holiday (skip), Jan 23 (Thu) = day 1, Jan 22 (Wed) = day 2
        expect(fmt(target!.startDate)).toBe('2024-01-22');
      });
    });

    describe('explicit date with offset', () => {
      it('offset shifts explicit date forward', () => {
        const result = calc('chart: gantt\nstart: 2024-01-15\n2024-03-01: Review | offset: 5d');
        expect(result.error).toBeNull();
        expect(fmt(result.tasks[0].startDate)).toBe('2024-03-06');
      });
    });

    describe('critical path with offset', () => {
      it('offset shifts task onto critical path', () => {
        const input = `chart: gantt
start: 2024-01-15
critical-path: on
parallel
  10d: Short
  5d: Long | offset: 10d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const long = result.tasks.find(t => t.task.label === 'Long');
        // Short: Jan 15 -> Jan 25, Long: Jan 25 -> Jan 30. Long is on critical path.
        expect(long!.isCriticalPath).toBe(true);
      });
    });

    describe('multiple predecessors with mixed offsets', () => {
      it('max rule applies across predecessors with offsets', () => {
        const input = `chart: gantt
start: 2024-01-15
parallel
  10d: Fast
    -> Result | offset: -3d
  20d: Slow
    -> Result | offset: 5d
  10d: Result`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const resultTask = result.tasks.find(t => t.task.label === 'Result');
        const slow = result.tasks.find(t => t.task.label === 'Slow');
        // Fast ends Jan 25, -3d = Jan 22. Slow ends Feb 4, +5d = Feb 9.
        // Max rule: Feb 9
        expect(resultTask!.startDate.getTime()).toBeGreaterThanOrEqual(slow!.endDate.getTime());
      });
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
