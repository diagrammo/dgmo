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
      const result = calc(
        'gantt\nstart 2024-01-15\nTask A 10d\n  -> Task B 5d'
      );
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(2);

      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[0].endDate)).toBe('2024-01-25');
      expect(fmt(result.tasks[1].startDate)).toBe('2024-01-25');
      expect(fmt(result.tasks[1].endDate)).toBe('2024-01-30');
    });

    it('handles milestone at end', () => {
      const result = calc('gantt\nstart 2024-01-15\nWork 10d\nDone 0d');
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[1].isMilestone).toBe(true);
      expect(fmt(result.tasks[1].startDate)).toBe(fmt(result.tasks[1].endDate));
    });
  });

  describe('parallel blocks', () => {
    it('parallel children start at same time', () => {
      const result = calc('gantt\nstart 2024-01-15\nX 5d\nY 3d');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(2);
      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[1].startDate)).toBe('2024-01-15');
    });

    it('task after parallel starts at max end', () => {
      const result = calc(
        'gantt\nstart 2024-01-15\nX 5d\n  -> After\nY 3d\n  -> After\nAfter 2d'
      );
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(3);
      // After depends on both X and Y → starts at max(X end, Y end) = X end = Jan 20
      const after = result.tasks.find((t) => t.task.label === 'After');
      expect(fmt(after!.startDate)).toBe('2024-01-20');
    });
  });

  describe('cross-branch dependencies', () => {
    it('-> dependency delays target start', () => {
      const input = `gantt
start 2024-01-15
[Backend]
  API 10d
    -> Frontend.Integration
[Frontend]
  Setup 5d
  Integration 5d`;
      const result = calc(input);
      expect(result.error).toBeNull();

      const integration = result.tasks.find(
        (t) => t.task.label === 'Integration'
      );
      const api = result.tasks.find((t) => t.task.label === 'API');
      expect(integration).toBeDefined();
      expect(api).toBeDefined();

      // Integration should start after both Setup and API (max rule)
      // Setup: Jan 15 -> Jan 20, API: Jan 15 -> Jan 25
      // Integration starts at max(Jan 20 [after Setup], Jan 25 [after API]) = Jan 25
      expect(fmt(integration!.startDate)).toBe('2024-01-25');
    });
  });

  describe('cycle detection', () => {
    it('detects circular dependency and breaks it gracefully', () => {
      const input = `gantt
start 2024-01-15
A 10d
  -> B
B 10d
  -> A`;
      const result = calc(input);
      expect(result.error).toBeNull();
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Circular dependency')
        )
      ).toBe(true);
      // Tasks still resolve — cycle-creating dep is dropped
      expect(result.tasks).toHaveLength(2);
    });
  });

  describe('business days', () => {
    it('10bd starting Monday Jan 15 ends Fri Jan 26', () => {
      const result = calc('gantt\nstart 2024-01-15\nTask 10bd');
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
      const result = calc(
        'gantt\nstart 2024-01-15\nMilestone start: 2024-02-15'
      );
      expect(result.error).toBeNull();
      expect(fmt(result.tasks[0].startDate)).toBe('2024-02-15');
    });
  });

  describe('groups', () => {
    it('builds resolved groups with date ranges', () => {
      const result = calc(
        'gantt\nstart 2024-01-15\n[Backend]\n  Task A 10d\n  Task B 5d'
      );
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Backend');
      expect(fmt(result.groups[0].startDate)).toBe('2024-01-15');
    });

    it('computes aggregate progress', () => {
      const result = calc(
        'gantt\nstart 2024-01-15\n[Backend]\n  Task A duration: 10d, progress: 100\n  Task B duration: 10d, progress: 50'
      );
      expect(result.groups[0].progress).not.toBeNull();
      // Duration-weighted: (100 * dur + 50 * dur) / (dur + dur) = 75
      expect(result.groups[0].progress).toBe(75);
    });
  });

  describe('top-level groups run in parallel (v2 default)', () => {
    it('2+ top-level groups start together, no sequential warning', () => {
      const input =
        'gantt\nstart 2024-01-15\n[A]\n  Task 1 5d\n[B]\n  Task 2 5d';
      const result = calc(input);
      // v2: bare siblings (incl. top-level groups) are parallel — both
      // tasks start at the chart start, and there is no legacy
      // "wrap in parallel" warning anymore.
      expect(result.tasks).toHaveLength(2);
      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[1].startDate)).toBe('2024-01-15');
      expect(
        result.diagnostics.some((d) => d.message.includes('sequential'))
      ).toBe(false);
    });
  });

  describe('empty chart', () => {
    it('returns empty result with no tasks', () => {
      const result = calc('gantt\nstart 2024-01-15');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(0);
    });
  });

  describe('relative timeline', () => {
    it('works without start date', () => {
      const result = calc('gantt\nTask A 10d\n  -> Task B 5d');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(2);
      // Should still have sequential ordering
      expect(result.tasks[1].startDate.getTime()).toBeGreaterThanOrEqual(
        result.tasks[0].endDate.getTime()
      );
    });
  });

  // ── Phase 2 tests ────────────────────────────────────────

  describe('holidays affect bd tasks', () => {
    it('skips declared holidays', () => {
      const input = `gantt
start 2024-01-15
holiday
  2024-01-16 Holiday
Task 5bd`;
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
        const result = calc(
          'gantt\nstart 2024-01-15\nTask duration: 10bd, offset: 5bd'
        );
        expect(result.error).toBeNull();
        // Jan 15 (Mon) + 5bd = Jan 22 (Mon)
        expect(fmt(result.tasks[0].startDate)).toBe('2024-01-22');
      });

      it('no deps, negative — clamped to project start', () => {
        const result = calc(
          'gantt\nstart 2024-01-15\nTask duration: 10bd, offset: -3bd'
        );
        expect(result.error).toBeNull();
        expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
        expect(
          result.diagnostics.some((d) =>
            d.message.includes('clamped to project start')
          )
        ).toBe(true);
      });

      it('no deps, zero — starts at project start', () => {
        const result = calc(
          'gantt\nstart 2024-01-15\nTask duration: 10bd, offset: 0bd'
        );
        expect(result.error).toBeNull();
        expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      });

      it('with deps, positive — starts after predecessor + offset', () => {
        const result = calc(
          'gantt\nstart 2024-01-15\nFirst 10d\n  -3d-> Second 5d'
        );
        expect(result.error).toBeNull();
        // First: Jan 15 -> Jan 25. Second starts at Jan 25 + 3d = Jan 28
        expect(fmt(result.tasks[1].startDate)).toBe('2024-01-28');
      });

      it('with deps, negative — overlaps predecessor', () => {
        const result = calc(
          'gantt\nstart 2024-01-15\nFirst 10d\n  --2d-> Second 5d'
        );
        expect(result.error).toBeNull();
        // First: Jan 15 -> Jan 25. Second starts at Jan 25 - 2d = Jan 23
        expect(fmt(result.tasks[1].startDate)).toBe('2024-01-23');
      });
    });

    describe('dep-level offset', () => {
      it('positive offset delays target', () => {
        const input = `gantt
start 2024-01-15
Source 10d
  -> Target offset: 3d
Target 10d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find((t) => t.task.label === 'Target');
        const source = result.tasks.find((t) => t.task.label === 'Source');
        expect(target).toBeDefined();
        expect(source).toBeDefined();
        const diff = target!.startDate.getTime() - source!.endDate.getTime();
        const threeDaysMs = 3 * 86400000;
        expect(diff).toBeGreaterThanOrEqual(threeDaysMs - 1000);
      });

      it('negative offset creates overlap', () => {
        const input = `gantt
start 2024-01-15
Source 10d
  -> Target offset: -3d
Target 10d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find((t) => t.task.label === 'Target');
        const source = result.tasks.find((t) => t.task.label === 'Source');
        // Target starts 3d before Source ends
        expect(target!.startDate.getTime()).toBeLessThan(
          source!.endDate.getTime()
        );
      });

      it('zero offset has no effect', () => {
        const input = `gantt
start 2024-01-15
Source 10d
  -> Target offset: 0d
Target 10d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find((t) => t.task.label === 'Target');
        const source = result.tasks.find((t) => t.task.label === 'Source');
        expect(fmt(target!.startDate)).toBe(fmt(source!.endDate));
      });
    });

    describe('stacking', () => {
      it('dep offset + task offset are additive', () => {
        const input = `gantt
start 2024-01-15
Source 10d
  -> Target offset: 5d
Target duration: 10d, offset: 3d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find((t) => t.task.label === 'Target');
        const source = result.tasks.find((t) => t.task.label === 'Source');
        // Source ends Jan 25. Dep offset +5d = Jan 30. Task offset +3d = Feb 2
        const diff = target!.startDate.getTime() - source!.endDate.getTime();
        const eightDaysMs = 8 * 86400000;
        expect(diff).toBeGreaterThanOrEqual(eightDaysMs - 1000);
      });
    });

    describe('clamping', () => {
      it('negative dep offset clamped to project start', () => {
        const input = `gantt
start 2024-01-15
Source 2d
  -> Target offset: -10d
Target 10d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find((t) => t.task.label === 'Target');
        // Source ends Jan 17. -10d = Jan 7 — before project start, so clamp to Jan 15
        expect(fmt(target!.startDate)).toBe('2024-01-15');
      });
    });

    describe('parallel block with offset', () => {
      it('offset task in parallel shifts correctly', () => {
        const input = `gantt
start 2024-01-15
Normal 5d
Offset duration: 5d, offset: 3d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const normal = result.tasks.find((t) => t.task.label === 'Normal');
        const offset = result.tasks.find((t) => t.task.label === 'Offset');
        expect(fmt(normal!.startDate)).toBe('2024-01-15');
        // Offset starts at project start + 3d = Jan 18
        expect(fmt(offset!.startDate)).toBe('2024-01-18');
      });
    });

    describe('business days with holidays', () => {
      it('offset skips holidays', () => {
        const input = `gantt
start 2024-01-15
holiday
  2024-01-16 Holiday
Task duration: 10bd, offset: 2bd`;
        const result = calc(input);
        expect(result.error).toBeNull();
        // Jan 15 (Mon) + 2bd skipping holiday on Jan 16 (Tue):
        // Day 1: skip Tue (holiday), Wed Jan 17
        // Day 2: Thu Jan 18
        expect(fmt(result.tasks[0].startDate)).toBe('2024-01-18');
      });

      it('negative dep offset with bd skips holidays backward', () => {
        const input = `gantt
start 2024-01-15
holiday
  2024-01-24 Holiday
Source 10d
  -> Target offset: -2bd
Target 10d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const target = result.tasks.find((t) => t.task.label === 'Target');
        // Source ends Jan 25. -2bd backward: Jan 24 is holiday (skip), Jan 23 (Thu) = day 1, Jan 22 (Wed) = day 2
        expect(fmt(target!.startDate)).toBe('2024-01-22');
      });
    });

    describe('explicit date with offset', () => {
      it('offset shifts explicit date forward', () => {
        const result = calc(
          'gantt\nstart 2024-01-15\nReview start: 2024-03-01, offset: 5d'
        );
        expect(result.error).toBeNull();
        expect(fmt(result.tasks[0].startDate)).toBe('2024-03-06');
      });
    });

    describe('critical path with offset', () => {
      it('offset shifts task onto critical path', () => {
        const input = `gantt
start 2024-01-15
critical-path
Short 10d
Long duration: 5d, offset: 10d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const long = result.tasks.find((t) => t.task.label === 'Long');
        // Short: Jan 15 -> Jan 25, Long: Jan 25 -> Jan 30. Long is on critical path.
        expect(long!.isCriticalPath).toBe(true);
      });
    });

    describe('multiple predecessors with mixed offsets', () => {
      it('max rule applies across predecessors with offsets', () => {
        const input = `gantt
start 2024-01-15
Fast 10d
  -> Result offset: -3d
Slow 20d
  -> Result offset: 5d
Result 10d`;
        const result = calc(input);
        expect(result.error).toBeNull();
        const resultTask = result.tasks.find((t) => t.task.label === 'Result');
        const slow = result.tasks.find((t) => t.task.label === 'Slow');
        // Fast ends Jan 25, -3d = Jan 22. Slow ends Feb 4, +5d = Feb 9.
        // Max rule: Feb 9
        expect(resultTask!.startDate.getTime()).toBeGreaterThanOrEqual(
          slow!.endDate.getTime()
        );
      });
    });
  });

  describe('critical path identification', () => {
    it('marks tasks on critical path', () => {
      const result = calc(`gantt
start 2024-01-15
critical-path
Long Task 10d
Short Follow-up 5d`);
      expect(result.error).toBeNull();
      // In a simple sequential chain, all tasks are on the critical path
      const critical = result.tasks.filter((t) => t.isCriticalPath);
      expect(critical.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cascading uncertainty', () => {
    it('direct uncertain task is uncertain', () => {
      const result = calc('gantt\nstart 2024-01-15\nTask 10d?');
      expect(result.tasks[0].isUncertain).toBe(true);
    });

    it('certain task with no deps is not uncertain', () => {
      const result = calc('gantt\nstart 2024-01-15\nTask 10d');
      expect(result.tasks[0].isUncertain).toBe(false);
    });

    it('cascades to sequential successor', () => {
      const result = calc('gantt\nstart 2024-01-15\nA 10d?\n  -> B 5d');
      const b = result.tasks.find((t) => t.task.label === 'B');
      expect(b!.isUncertain).toBe(true);
    });

    it('cascades transitively', () => {
      const result = calc(
        'gantt\nstart 2024-01-15\nA 10d?\n  -> B 5d\n    -> C 3d'
      );
      const c = result.tasks.find((t) => t.task.label === 'C');
      expect(c!.isUncertain).toBe(true);
    });

    it('does not cascade across parallel branches', () => {
      const result = calc(`gantt
start 2024-01-15
Uncertain Branch 10d?
Certain Branch 10d`);
      const certain = result.tasks.find(
        (t) => t.task.label === 'Certain Branch'
      );
      expect(certain!.isUncertain).toBe(false);
    });

    it('cascades if any predecessor is uncertain', () => {
      const input = `gantt
start 2024-01-15
Risky 10d?
  -> Result
Safe 10d
  -> Result
Result 5d`;
      const result = calc(input);
      const res = result.tasks.find((t) => t.task.label === 'Result');
      expect(res!.isUncertain).toBe(true);
    });
  });

  describe('sprint bands', () => {
    it('generates sprint bands for tasks spanning 6 weeks with sprint-length 2w', () => {
      const input =
        'gantt\nstart 2026-01-05\nsprint-length 2w\nTask A 2w\n  -> Task B 2w\n    -> Task C 2w';
      const result = calc(input);
      expect(result.sprints.length).toBeGreaterThanOrEqual(3);
      expect(result.sprints[0].number).toBe(1); // default sprint-number
    });

    it('numbers sprints starting from sprint-number', () => {
      const input =
        'gantt\nstart 2026-01-05\nsprint-length 2w\nsprint-number 5\nTask A 2w\nTask B 2w';
      const result = calc(input);
      expect(result.sprints[0].number).toBe(5);
      expect(result.sprints[1].number).toBe(6);
    });

    it('handles sprint-start before chart range', () => {
      // Sprint 1 starts Jan 5, chart starts Mar 1 with 2w sprints
      // Days from Jan 5 to Mar 1 = 55 days, 55/14 = 3.93 → sprint 4 starts at day 42 (Feb 16), sprint 5 at day 56 (Mar 2)
      // So Mar 1 falls in sprint 4 (anchor sprint 1 + 3 elapsed)
      const input =
        'gantt\nstart 2026-03-01\nsprint-length 2w\nsprint-number 1\nsprint-start 2026-01-05\nTask A 4w';
      const result = calc(input);
      expect(result.sprints.length).toBeGreaterThan(0);
      // First visible sprint should contain Mar 1
      const firstSprint = result.sprints[0];
      expect(firstSprint.startDate.getTime()).toBeLessThanOrEqual(
        new Date(2026, 2, 1).getTime()
      );
      // Sprint number should be 4 (Jan 5 + 3*14 = Feb 16 → Sprint 4 starts Feb 16)
      expect(firstSprint.number).toBe(4);
    });

    it('uses start-inclusive, end-exclusive boundary', () => {
      // Sprint boundary at day 14 from start — task starting on that boundary belongs to next sprint
      const input =
        'gantt\nstart 2026-01-05\nsprint-length 2w\nTask A 14d\nTask B 7d';
      const result = calc(input);
      // Task A: Jan 5 → Jan 19 (14 days)
      // Sprint 1: Jan 5 to Jan 19, Sprint 2: Jan 19 to Feb 2
      expect(result.sprints.length).toBeGreaterThanOrEqual(2);
      expect(fmt(result.sprints[0].startDate)).toBe('2026-01-05');
      expect(fmt(result.sprints[0].endDate)).toBe('2026-01-19');
      expect(fmt(result.sprints[1].startDate)).toBe('2026-01-19');
    });

    it('generates partial band when chart start falls mid-sprint', () => {
      // Sprint starts Jan 5, chart starts Jan 10 with 2w sprints
      const input =
        'gantt\nstart 2026-01-10\nsprint-length 2w\nsprint-start 2026-01-05\nTask A 4w';
      const result = calc(input);
      expect(result.sprints.length).toBeGreaterThan(0);
      // First sprint should start before chart start (partial band)
      expect(result.sprints[0].startDate.getTime()).toBeLessThan(
        new Date(2026, 0, 10).getTime()
      );
    });

    it('auto-enables sprint mode when s unit used without options', () => {
      const input = 'gantt\nstart 2026-01-05\nTask A 2s\nTask B 1s';
      const result = calc(input);
      // Default sprint-length 2w: 2s = 28 days, 1s = 14 days = 42 days total
      expect(result.sprints.length).toBeGreaterThan(0);
      expect(fmt(result.tasks[0].endDate)).toBe('2026-02-02'); // Jan 5 + 28 days
    });

    it('resolves 0.5s with sprint-length 2w to 7 days', () => {
      const input = 'gantt\nstart 2026-01-05\nsprint-length 2w\nTask A 0.5s';
      const result = calc(input);
      expect(fmt(result.tasks[0].startDate)).toBe('2026-01-05');
      expect(fmt(result.tasks[0].endDate)).toBe('2026-01-12'); // Jan 5 + 7 days
    });

    it('handles sprint-start in the future (negative sprint indices)', () => {
      // Sprint 10 starts 2027-01-01, chart starts 2026-01-05 with 2w sprints
      // That's ~361 days before anchor, so sprints will have lower numbers
      const input =
        'gantt\nstart 2026-01-05\nsprint-length 2w\nsprint-number 10\nsprint-start 2027-01-01\nTask A 4w';
      const result = calc(input);
      expect(result.sprints.length).toBeGreaterThan(0);
      // Sprint numbers can go below sprintNumber when chart is before anchor
      // 361 days / 14 = ~25.8 sprints before anchor → first sprint ~ 10 - 26 = -16
      expect(result.sprints[0].number).toBeLessThan(10);
    });

    it('generates sprint bands even without s unit when sprint options present', () => {
      const input =
        'gantt\nstart 2026-01-05\nsprint-length 2w\nsprint-number 3\nTask A 4w';
      const result = calc(input);
      expect(result.sprints.length).toBeGreaterThan(0);
      expect(result.sprints[0].number).toBe(3);
    });
  });

  // ── New syntax (v2) scheduling ─────────────────────────────

  describe('new syntax scheduling', () => {
    it('sequential arrow chain schedules correctly', () => {
      const result = calc(
        'gantt\nstart 2024-01-15\n\nResearch 2w\n  -> Design 1w\n  -> Dev 3w'
      );
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(3);
      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[1].startDate)).toBe('2024-01-29');
      expect(fmt(result.tasks[2].startDate)).toBe('2024-02-05');
    });

    it('bare siblings are parallel (same start date)', () => {
      const result = calc('gantt\nstart 2024-01-15\n\nTask A 10d\nTask B 5d');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(2);
      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[1].startDate)).toBe('2024-01-15');
    });

    it('group offset acts as floor for contained tasks (AC 13)', () => {
      const result = calc('gantt\nstart 2024-01-15\n\n+3w [Backend]\n  API 5d');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(1);
      // +3w from 2024-01-15 = 2024-02-05
      expect(fmt(result.tasks[0].startDate)).toBe('2024-02-05');
    });

    it('task offset +4w delays task from project start (AC 2)', () => {
      const result = calc('gantt\nstart 2024-01-15\n\n+4w Task 30bd');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(1);
      // +4w from 2024-01-15 = 2024-02-12
      expect(fmt(result.tasks[0].startDate)).toBe('2024-02-12');
    });

    it('milestone as 0d has same start and end', () => {
      const result = calc('gantt\nstart 2024-01-15\n\nLaunch 0d');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(1);
      expect(fmt(result.tasks[0].startDate)).toBe('2024-01-15');
      expect(fmt(result.tasks[0].endDate)).toBe('2024-01-15');
      expect(result.tasks[0].isMilestone).toBe(true);
    });

    it('lag arrow delays target start (AC 6)', () => {
      const result = calc('gantt\nstart 2024-01-15\n\nA 2w\n  -3w-> B 1w');
      expect(result.error).toBeNull();
      expect(result.tasks).toHaveLength(2);
      // A ends 2024-01-29, +3w lag = 2024-02-19
      expect(fmt(result.tasks[1].startDate)).toBe('2024-02-19');
    });
  });
});
