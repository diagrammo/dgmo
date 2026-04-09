import { describe, it, expect } from 'vitest';
import { parseGantt } from '../src/gantt/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

describe('gantt parser', () => {
  describe('chart type', () => {
    it('accepts gantt on first line', () => {
      const result = parseGantt('gantt\n10d Task A', palette);
      expect(result.error).toBeNull();
    });

    it('rejects timeline on first line', () => {
      const result = parseGantt('timeline\n10d Task A', palette);
      expect(result.error).toMatch(/Expected chart type "gantt"/);
    });
  });

  describe('options', () => {
    it('parses start date', () => {
      const result = parseGantt('gantt\nstart 2024-01-15\n10d Task', palette);
      expect(result.options.start).toBe('2024-01-15');
    });

    it('parses title', () => {
      const result = parseGantt('gantt\ntitle My Plan\n10d Task', palette);
      expect(result.options.title).toBe('My Plan');
    });

    it('parses today-marker bare keyword', () => {
      const result = parseGantt('gantt\ntoday-marker\n10d Task', palette);
      expect(result.options.todayMarker).toBe('on');
    });

    it('parses today-marker with pinned date', () => {
      const result = parseGantt(
        'gantt\ntoday-marker 2024-03-15\n10d Task',
        palette
      );
      expect(result.options.todayMarker).toBe('2024-03-15');
    });

    it('parses critical-path bare keyword', () => {
      const result = parseGantt('gantt\ncritical-path\n10d Task', palette);
      expect(result.options.criticalPath).toBe(true);
    });

    it('parses no-dependencies to disable', () => {
      const result = parseGantt('gantt\nno-dependencies\n10d Task', palette);
      expect(result.options.dependencies).toBe(false);
    });

    it('defaults dependencies to true', () => {
      const result = parseGantt('gantt\n10d Task', palette);
      expect(result.options.dependencies).toBe(true);
    });

    it('defaults start to null (relative timeline)', () => {
      const result = parseGantt('gantt\n10d Task', palette);
      expect(result.options.start).toBeNull();
    });
  });

  describe('duration tasks', () => {
    it('parses basic duration task', () => {
      const result = parseGantt('gantt\n10d Task A', palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(1);
      const task = result.nodes[0];
      expect(task.kind).toBe('task');
      if (task.kind === 'task') {
        expect(task.label).toBe('Task A');
        expect(task.duration).toEqual({ amount: 10, unit: 'd' });
        expect(task.uncertain).toBe(false);
      }
    });

    it('parses all duration units', () => {
      const input =
        'gantt\n10d Days\n5bd Business\n2w Weeks\n3m Months\n1q Quarter\n0.5y HalfYear';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(6);

      const units = result.nodes.map((n) =>
        n.kind === 'task' ? n.duration?.unit : null
      );
      expect(units).toEqual(['d', 'bd', 'w', 'm', 'q', 'y']);
    });

    it('parses decimal durations', () => {
      const result = parseGantt('gantt\n1.5w Task', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.duration).toEqual({ amount: 1.5, unit: 'w' });
      }
    });

    it('parses uncertain duration', () => {
      const result = parseGantt('gantt\n30d? Task', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.uncertain).toBe(true);
        expect(task.duration).toEqual({ amount: 30, unit: 'd' });
      }
    });

    it('parses milestone (0d)', () => {
      const result = parseGantt('gantt\n0d Milestone', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.duration).toEqual({ amount: 0, unit: 'd' });
      }
    });
  });

  describe('explicit dates', () => {
    it('parses explicit date task', () => {
      const result = parseGantt('gantt\n2024-02-15 Design Review', palette);
      expect(result.error).toBeNull();
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.label).toBe('Design Review');
        expect(task.explicitStart).toBe('2024-02-15');
        expect(task.duration).toBeNull();
      }
    });

    it('parses timeline migration syntax', () => {
      const result = parseGantt('gantt\n2024-01-15 -> 30d Task', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.explicitStart).toBe('2024-01-15');
        expect(task.duration).toEqual({ amount: 30, unit: 'd' });
      }
    });
  });

  describe('groups', () => {
    it('parses basic group', () => {
      const result = parseGantt('gantt\n[Backend]\n  10d Task', palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(1);
      const group = result.nodes[0];
      expect(group.kind).toBe('group');
      if (group.kind === 'group') {
        expect(group.name).toBe('Backend');
        expect(group.children).toHaveLength(1);
      }
    });

    it('parses group with pipe metadata', () => {
      const input =
        'gantt\ntag Team alias t\n  Engineering(blue)\n[Backend] | t: Engineering\n  10d Task';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const group = result.nodes[0];
      if (group.kind === 'group') {
        expect(group.metadata.team).toBe('Engineering');
      }
    });

    it('parses nested groups', () => {
      const input = 'gantt\n[Backend]\n  [API]\n    10d Task';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const outer = result.nodes[0];
      if (outer.kind === 'group') {
        expect(outer.children).toHaveLength(1);
        const inner = outer.children[0];
        if (inner.kind === 'group') {
          expect(inner.name).toBe('API');
          expect(inner.children).toHaveLength(1);
        }
      }
    });
  });

  describe('parallel blocks', () => {
    it('parses parallel block', () => {
      const input = 'gantt\nparallel\n  5d Task A\n  3d Task B';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(1);
      const par = result.nodes[0];
      expect(par.kind).toBe('parallel');
      if (par.kind === 'parallel') {
        expect(par.children).toHaveLength(2);
      }
    });

    it('parses parallel with groups inside', () => {
      const input =
        'gantt\nparallel\n  [Backend]\n    10d Task A\n  [Frontend]\n    5d Task B';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const par = result.nodes[0];
      if (par.kind === 'parallel') {
        expect(par.children).toHaveLength(2);
        expect(par.children[0].kind).toBe('group');
        expect(par.children[1].kind).toBe('group');
      }
    });
  });

  describe('dependencies', () => {
    it('parses -> dependency under task', () => {
      const input = 'gantt\n10d Task A\n  -> Task B\n10d Task B';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies).toHaveLength(1);
        expect(taskA.dependencies[0].targetName).toBe('Task B');
      }
    });

    it('parses -> with dot notation', () => {
      const input = 'gantt\n10d Task A\n  -> Backend.Deploy\n10d Deploy';
      const result = parseGantt(input, palette);
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies[0].targetName).toBe('Backend.Deploy');
      }
    });

    it('parses -> with positive offset', () => {
      const input = 'gantt\n10d Task A\n  -> Task B | offset: 3bd\n10d Task B';
      const result = parseGantt(input, palette);
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies[0].offset).toEqual({
          duration: { amount: 3, unit: 'bd' },
          direction: 1,
        });
      }
    });

    it('parses -> with negative offset', () => {
      const input = 'gantt\n10d Task A\n  -> Task B | offset: -5d\n10d Task B';
      const result = parseGantt(input, palette);
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies[0].offset).toEqual({
          duration: { amount: 5, unit: 'd' },
          direction: -1,
        });
      }
    });

    it('parses -> with zero offset', () => {
      const input = 'gantt\n10d Task A\n  -> Task B | offset: 0bd\n10d Task B';
      const result = parseGantt(input, palette);
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies[0].offset).toEqual({
          duration: { amount: 0, unit: 'bd' },
          direction: 1,
        });
      }
    });

    it('warns on invalid dep offset', () => {
      const input = 'gantt\n10d Task A\n  -> Task B | offset: abc\n10d Task B';
      const result = parseGantt(input, palette);
      expect(
        result.diagnostics.some((d) => d.message.includes('Invalid offset'))
      ).toBe(true);
    });

    it('warns on explicit + prefix in dep offset', () => {
      const input = 'gantt\n10d Task A\n  -> Task B | offset: +5bd\n10d Task B';
      const result = parseGantt(input, palette);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Explicit "+" is not supported')
        )
      ).toBe(true);
    });

    it('rejects lag keyword with soft error', () => {
      const input = 'gantt\n10d Task A\n  -> Task B | lag: 3bd\n10d Task B';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'error' &&
            d.message.includes('"lag" is no longer supported')
        )
      ).toBe(true);
    });

    it('rejects lead keyword with soft error', () => {
      const input = 'gantt\n10d Task A\n  -> Task B | lead: 3bd\n10d Task B';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'error' &&
            d.message.includes('"lead" is no longer supported')
        )
      ).toBe(true);
    });

    it('rejects lag on task line with soft error', () => {
      const result = parseGantt('gantt\n10bd Task | lag: 5bd', palette);
      expect(result.error).toBeNull();
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'error' &&
            d.message.includes('"lag" is no longer supported')
        )
      ).toBe(true);
    });

    it('parses labeled arrow -blocks-> Design', () => {
      const input = 'gantt\n10d Task A\n  -blocks-> Design\n10d Design';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies).toHaveLength(1);
        expect(taskA.dependencies[0].label).toBe('blocks');
        expect(taskA.dependencies[0].targetName).toBe('Design');
      }
    });

    it('parses -> Design with no label (regression)', () => {
      const input = 'gantt\n10d Task A\n  -> Design\n10d Design';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies).toHaveLength(1);
        expect(taskA.dependencies[0].label).toBeUndefined();
        expect(taskA.dependencies[0].targetName).toBe('Design');
      }
    });

    it('parses labeled arrow with pipe metadata -depends on-> API | offset: 2d', () => {
      const input =
        'gantt\n10d Task A\n  -depends on-> API | offset: 2d\n10d API';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies).toHaveLength(1);
        expect(taskA.dependencies[0].label).toBe('depends on');
        expect(taskA.dependencies[0].targetName).toBe('API');
        expect(taskA.dependencies[0].offset).toEqual({
          duration: { amount: 2, unit: 'd' },
          direction: 1,
        });
      }
    });

    it('parses labeled arrow with offset -blocks-> Design | offset: 1w', () => {
      const input =
        'gantt\n10d Task A\n  -blocks-> Design | offset: 1w\n10d Design';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies).toHaveLength(1);
        expect(taskA.dependencies[0].label).toBe('blocks');
        expect(taskA.dependencies[0].targetName).toBe('Design');
        expect(taskA.dependencies[0].offset).toEqual({
          duration: { amount: 1, unit: 'w' },
          direction: 1,
        });
      }
    });
  });

  describe('task-level offset', () => {
    it('parses positive task offset', () => {
      const result = parseGantt('gantt\n10bd Task | offset: 8bd', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.offset).toEqual({
          duration: { amount: 8, unit: 'bd' },
          direction: 1,
        });
        expect(task.metadata.offset).toBeUndefined(); // removed from metadata
      }
    });

    it('parses negative task offset', () => {
      const result = parseGantt('gantt\n10bd Task | offset: -3bd', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.offset).toEqual({
          duration: { amount: 3, unit: 'bd' },
          direction: -1,
        });
      }
    });

    it('warns on invalid task offset', () => {
      const result = parseGantt('gantt\n10bd Task | offset: abc', palette);
      expect(
        result.diagnostics.some((d) => d.message.includes('Invalid offset'))
      ).toBe(true);
    });
  });

  describe('comments', () => {
    it('parses comment under task', () => {
      const input = 'gantt\n10d Task A\n  // This is a comment';
      const result = parseGantt(input, palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.comment).toBe('This is a comment');
      }
    });

    it('accumulates multi-line comments', () => {
      const input = 'gantt\n10d Task A\n  // Line 1\n  // Line 2';
      const result = parseGantt(input, palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.comment).toBe('Line 1\nLine 2');
      }
    });

    it('ignores top-level comments', () => {
      const input = 'gantt\n// Top comment\n10d Task A';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(1);
    });
  });

  describe('progress', () => {
    it('parses progress shorthand', () => {
      const result = parseGantt('gantt\n10d Task | 80%', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.progress).toBe(80);
      }
    });

    it('parses progress: key', () => {
      const result = parseGantt('gantt\n10d Task | progress: 50', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.progress).toBe(50);
      }
    });
  });

  describe('tag groups', () => {
    it('parses tag block with entries', () => {
      const input =
        'gantt\ntag Team alias t\n  Engineering(blue)\n  Design(purple)\n10d Task | t: Engineering';
      const result = parseGantt(input, palette);
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Team');
      expect(result.tagGroups[0].alias).toBe('t');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('first entry is default', () => {
      const input =
        'gantt\ntag Team alias t\n  Engineering(blue)\n  Design(purple)\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.tagGroups[0].defaultValue).toBe('Engineering');
    });

    it('tag inheritance from parent group', () => {
      const input =
        'gantt\ntag Team alias t\n  Engineering(blue)\n[Backend] | t: Engineering\n  10d Task';
      const result = parseGantt(input, palette);
      const group = result.nodes[0];
      if (group.kind === 'group') {
        const task = group.children[0];
        if (task.kind === 'task') {
          expect(task.metadata.team).toBe('Engineering');
        }
      }
    });

    it('child overrides inherited tag', () => {
      const input =
        'gantt\ntag Team alias t\n  Engineering(blue)\n  QA(orange)\n[Backend] | t: Engineering\n  10d Task | t: QA';
      const result = parseGantt(input, palette);
      const group = result.nodes[0];
      if (group.kind === 'group') {
        const task = group.children[0];
        if (task.kind === 'task') {
          expect(task.metadata.team).toBe('QA');
        }
      }
    });
  });

  describe('holiday block', () => {
    it('parses holiday dates', () => {
      const input =
        'gantt\nholiday\n  2024-01-01 New Year\n  2024-12-25 Christmas\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.dates).toHaveLength(2);
      expect(result.holidays.dates[0].date).toBe('2024-01-01');
      expect(result.holidays.dates[0].label).toBe('New Year');
    });

    it('parses holiday ranges', () => {
      const input =
        'gantt\nholiday\n  2024-12-24 -> 2024-12-31 Winter Break\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.ranges).toHaveLength(1);
      expect(result.holidays.ranges[0].startDate).toBe('2024-12-24');
      expect(result.holidays.ranges[0].endDate).toBe('2024-12-31');
    });

    it('parses workweek override', () => {
      const input = 'gantt\nholiday\n  workweek sun-thu\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.workweek).toEqual([
        'sun',
        'mon',
        'tue',
        'wed',
        'thu',
      ]);
    });

    it('default workweek is mon-fri', () => {
      const result = parseGantt('gantt\n10d Task', palette);
      expect(result.holidays.workweek).toEqual([
        'mon',
        'tue',
        'wed',
        'thu',
        'fri',
      ]);
    });

    it('parses single-line holiday', () => {
      const input = 'gantt\nholiday 2024-12-25 Christmas\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.dates).toHaveLength(1);
      expect(result.holidays.dates[0].date).toBe('2024-12-25');
      expect(result.holidays.dates[0].label).toBe('Christmas');
    });
  });

  describe('eras and markers', () => {
    it('parses era', () => {
      const input = 'gantt\nera 2024-01 -> 2024-06 Phase 1\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.eras).toHaveLength(1);
      expect(result.eras[0].startDate).toBe('2024-01');
      expect(result.eras[0].endDate).toBe('2024-06');
      expect(result.eras[0].label).toBe('Phase 1');
    });

    it('parses marker', () => {
      const input = 'gantt\nmarker 2024-03-01 Kickoff\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.markers).toHaveLength(1);
      expect(result.markers[0].date).toBe('2024-03-01');
      expect(result.markers[0].label).toBe('Kickoff');
    });
  });

  describe('top-level workweek', () => {
    it('parses workweek at top level (outside holiday block)', () => {
      const input = 'gantt\nworkweek sun-thu\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.workweek).toEqual([
        'sun',
        'mon',
        'tue',
        'wed',
        'thu',
      ]);
    });

    it('workweek inside holiday block still works', () => {
      const input = 'gantt\nholiday\n  workweek sun-thu\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.workweek).toEqual([
        'sun',
        'mon',
        'tue',
        'wed',
        'thu',
      ]);
    });

    it('warns on invalid top-level workweek', () => {
      const input = 'gantt\nworkweek bogus\n10d Task';
      const result = parseGantt(input, palette);
      expect(
        result.diagnostics.some((d) => d.message.includes('Invalid workweek'))
      ).toBe(true);
    });
  });

  describe('era block form', () => {
    it('parses bare era keyword with indented entries', () => {
      const input =
        'gantt\nera\n  2024-01 -> 2024-06 Phase 1\n  2024-06 -> 2024-12 Phase 2\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.eras).toHaveLength(2);
      expect(result.eras[0].startDate).toBe('2024-01');
      expect(result.eras[0].endDate).toBe('2024-06');
      expect(result.eras[0].label).toBe('Phase 1');
      expect(result.eras[1].startDate).toBe('2024-06');
      expect(result.eras[1].endDate).toBe('2024-12');
      expect(result.eras[1].label).toBe('Phase 2');
    });

    it('parses era block entry with color', () => {
      const input = 'gantt\nera\n  2024-01 -> 2024-06 Sprint (blue)\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.eras).toHaveLength(1);
      expect(result.eras[0].label).toBe('Sprint');
      expect(result.eras[0].color).not.toBeNull();
    });

    it('inline era still works alongside block form', () => {
      const input =
        'gantt\nera 2024-01 -> 2024-06 Phase 1\nera\n  2024-06 -> 2024-12 Phase 2\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.eras).toHaveLength(2);
    });
  });

  describe('marker block form', () => {
    it('parses bare marker keyword with indented entries', () => {
      const input =
        'gantt\nmarker\n  2024-03-01 Kickoff\n  2024-06-15 Release\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.markers).toHaveLength(2);
      expect(result.markers[0].date).toBe('2024-03-01');
      expect(result.markers[0].label).toBe('Kickoff');
      expect(result.markers[1].date).toBe('2024-06-15');
      expect(result.markers[1].label).toBe('Release');
    });

    it('parses marker block entry with color', () => {
      const input = 'gantt\nmarker\n  2024-03-01 Launch (green)\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.markers).toHaveLength(1);
      expect(result.markers[0].label).toBe('Launch');
      expect(result.markers[0].color).not.toBeNull();
    });

    it('inline marker still works alongside block form', () => {
      const input =
        'gantt\nmarker 2024-03-01 Kickoff\nmarker\n  2024-06-15 Release\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.markers).toHaveLength(2);
    });
  });

  describe('validation errors', () => {
    it('reports bare labels as soft error and continues parsing', () => {
      const result = parseGantt('gantt\nSome Text\n10d Valid Task', palette);
      expect(result.error).toBeNull();
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'error' && d.message.includes('Expected duration')
        )
      ).toBe(true);
      expect(result.nodes).toHaveLength(1); // Valid Task still parsed
    });

    it('reports parallel as reserved keyword and continues', () => {
      const result = parseGantt('gantt\n10d parallel\n10d Next Task', palette);
      expect(result.error).toBeNull();
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'error' && d.message.includes('reserved keyword')
        )
      ).toBe(true);
      expect(result.nodes).toHaveLength(2); // both tasks still parsed
    });
  });

  describe('flat task list (no groups)', () => {
    it('accepts flat sequential tasks', () => {
      const input = 'gantt\n14d Research\n7d Design\n3d Testing\n0d Ship';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(4);
      expect(result.nodes.every((n) => n.kind === 'task')).toBe(true);
    });
  });

  describe('datetime and sub-day durations', () => {
    it('parses h duration task', () => {
      const result = parseGantt('gantt\n2h Meeting', palette);
      expect(result.error).toBeNull();
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.duration).toEqual({ amount: 2, unit: 'h' });
      }
    });

    it('parses min duration task', () => {
      const result = parseGantt('gantt\n90min Workshop', palette);
      expect(result.error).toBeNull();
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.duration).toEqual({ amount: 90, unit: 'min' });
      }
    });

    it('parses 1.5h fractional duration', () => {
      const result = parseGantt('gantt\n1.5h Session', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.duration).toEqual({ amount: 1.5, unit: 'h' });
      }
    });

    it('30min is minutes, 30m is months (disambiguation)', () => {
      const result = parseGantt('gantt\n30min Meeting\n30m Phase', palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(2);
      const task1 = result.nodes[0];
      const task2 = result.nodes[1];
      if (task1.kind === 'task') expect(task1.duration?.unit).toBe('min');
      if (task2.kind === 'task') expect(task2.duration?.unit).toBe('m');
    });

    it('parses start with datetime', () => {
      const result = parseGantt(
        'gantt\nstart 2024-06-15 08:00\n2h Task',
        palette
      );
      expect(result.options.start).toBe('2024-06-15 08:00');
    });

    it('parses today-marker with datetime', () => {
      const result = parseGantt(
        'gantt\ntoday-marker 2024-06-15 14:00\n2h Task',
        palette
      );
      expect(result.options.todayMarker).toBe('2024-06-15 14:00');
    });

    it('parses explicit datetime task', () => {
      const result = parseGantt('gantt\n2024-06-15 14:30 Keynote', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.explicitStart).toBe('2024-06-15 14:30');
        expect(task.duration).toBeNull();
      }
    });

    it('parses timeline-duration with datetime + h unit', () => {
      const result = parseGantt('gantt\n2024-06-15 14:30 -> 2h Talk', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.explicitStart).toBe('2024-06-15 14:30');
        expect(task.duration).toEqual({ amount: 2, unit: 'h' });
      }
    });

    it('parses era with datetime', () => {
      const result = parseGantt(
        'gantt\nera 2024-06-15 09:00 -> 2024-06-15 12:00 Morning\n2h Task',
        palette
      );
      expect(result.eras).toHaveLength(1);
      expect(result.eras[0].startDate).toBe('2024-06-15 09:00');
      expect(result.eras[0].endDate).toBe('2024-06-15 12:00');
    });

    it('parses marker with datetime', () => {
      const result = parseGantt(
        'gantt\nmarker 2024-06-15 10:30 Coffee Break\n2h Task',
        palette
      );
      expect(result.markers).toHaveLength(1);
      expect(result.markers[0].date).toBe('2024-06-15 10:30');
      expect(result.markers[0].label).toBe('Coffee Break');
    });
  });

  describe('sort tag directive', () => {
    it('parses sort tag', () => {
      const input =
        'gantt\nsort tag\ntag Team\n  Eng(blue)\nstart 2024-01-15\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.options.sort).toBe('tag');
      expect(result.options.defaultSwimlaneGroup).toBeNull();
    });

    it('parses sort tag:Team', () => {
      const input =
        'gantt\nsort tag:Team\ntag Team\n  Eng(blue)\nstart 2024-01-15\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.options.sort).toBe('tag');
      expect(result.options.defaultSwimlaneGroup).toBe('Team');
    });

    it('warns and falls back when no tag groups defined', () => {
      const input = 'gantt\nsort tag\nstart 2024-01-15\n10d Task';
      const result = parseGantt(input, palette);
      expect(result.options.sort).toBe('default');
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('sort tag has no effect')
        )
      ).toBe(true);
    });

    it('warns on invalid sort value', () => {
      const input = 'gantt\nsort date\nstart 2024-01-15\n10d Task';
      const result = parseGantt(input, palette);
      expect(
        result.diagnostics.some((d) => d.message.includes('Invalid sort value'))
      ).toBe(true);
    });
  });

  describe('sprints', () => {
    it('parses sprint-length 2w', () => {
      const result = parseGantt('gantt\nsprint-length 2w\n10d Task', palette);
      expect(result.options.sprintLength).toEqual({ amount: 2, unit: 'w' });
    });

    it('parses sprint-number 5', () => {
      const result = parseGantt('gantt\nsprint-number 5\n10d Task', palette);
      expect(result.options.sprintNumber).toBe(5);
    });

    it('parses sprint-start date', () => {
      const result = parseGantt(
        'gantt\nsprint-start 2026-04-06\n10d Task',
        palette
      );
      expect(result.options.sprintStart).toBe('2026-04-06');
    });

    it('rejects sprint-length 10bd', () => {
      const result = parseGantt('gantt\nsprint-length 10bd\n10d Task', palette);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('only accepts "d" or "w"')
        )
      ).toBe(true);
    });

    it('rejects sprint-length 2s (circular)', () => {
      const result = parseGantt('gantt\nsprint-length 2s\n10d Task', palette);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('only accepts "d" or "w"')
        )
      ).toBe(true);
    });

    it('rejects sprint-length 3m', () => {
      const result = parseGantt('gantt\nsprint-length 3m\n10d Task', palette);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('only accepts "d" or "w"')
        )
      ).toBe(true);
    });

    it('rejects sprint-length 0d', () => {
      const result = parseGantt('gantt\nsprint-length 0d\n10d Task', palette);
      expect(
        result.diagnostics.some((d) => d.message.includes('greater than 0'))
      ).toBe(true);
    });

    it('rejects sprint-number 0', () => {
      const result = parseGantt('gantt\nsprint-number 0\n10d Task', palette);
      expect(
        result.diagnostics.some((d) => d.message.includes('positive integer'))
      ).toBe(true);
    });

    it('rejects sprint-number 2.5 (non-integer)', () => {
      const result = parseGantt('gantt\nsprint-number 2.5\n10d Task', palette);
      expect(
        result.diagnostics.some((d) => d.message.includes('positive integer'))
      ).toBe(true);
    });

    it('rejects sprint-start with partial date', () => {
      const result = parseGantt(
        'gantt\nsprint-start 2026-04\n10d Task',
        palette
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('full date'))
      ).toBe(true);
    });

    it('rejects sprint-start with invalid date values', () => {
      const result = parseGantt(
        'gantt\nsprint-start 2026-13-45\n10d Task',
        palette
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('not a valid date'))
      ).toBe(true);
    });

    it('rejects fractional sprint-length that does not resolve to whole days', () => {
      const result = parseGantt('gantt\nsprint-length 1.5w\n10d Task', palette);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('whole number of days')
        )
      ).toBe(true);
    });

    it('accepts sprint-length 0.5w (resolves to 3.5d → rejected)', () => {
      const result = parseGantt('gantt\nsprint-length 0.5w\n10d Task', palette);
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('whole number of days')
        )
      ).toBe(true);
    });

    it('sets sprintMode explicit when sprint option present', () => {
      const result = parseGantt('gantt\nsprint-length 2w\n10d Task', palette);
      expect(result.options.sprintMode).toBe('explicit');
    });

    it('sets sprintMode explicit when sprint option present without s unit', () => {
      const result = parseGantt(
        'gantt\nsprint-number 3\nstart 2026-01-01\n10d Task',
        palette
      );
      expect(result.options.sprintMode).toBe('explicit');
      expect(result.options.sprintLength).toEqual({ amount: 2, unit: 'w' }); // default
    });

    it('parses 2s as sprint duration', () => {
      const result = parseGantt('gantt\n2s Task A', palette);
      const task = result.nodes.find((n) => n.kind === 'task');
      expect(task).toBeDefined();
      if (task?.kind === 'task') {
        expect(task.duration).toEqual({ amount: 2, unit: 's' });
      }
    });

    it('parses 0.5s as fractional sprint duration', () => {
      const result = parseGantt('gantt\n0.5s Task A', palette);
      const task = result.nodes.find((n) => n.kind === 'task');
      if (task?.kind === 'task') {
        expect(task.duration).toEqual({ amount: 0.5, unit: 's' });
      }
    });

    it('auto-enables sprint mode when s unit used without options', () => {
      const result = parseGantt('gantt\n2s Task A', palette);
      expect(result.options.sprintMode).toBe('auto');
      expect(result.options.sprintLength).toEqual({ amount: 2, unit: 'w' }); // default
      expect(result.options.sprintNumber).toBe(1); // default
    });

    it('parses timeline migration syntax with s unit', () => {
      const result = parseGantt('gantt\n2026-01-15 -> 2s Task A', palette);
      const task = result.nodes.find((n) => n.kind === 'task');
      if (task?.kind === 'task') {
        expect(task.duration).toEqual({ amount: 2, unit: 's' });
        expect(task.explicitStart).toBe('2026-01-15');
      }
    });

    it('parses all sprint options together', () => {
      const input =
        'gantt\nsprint-length 3w\nsprint-number 5\nsprint-start 2026-01-05\nstart 2026-03-01\n2s Task A\n1s Task B';
      const result = parseGantt(input, palette);
      expect(result.options.sprintLength).toEqual({ amount: 3, unit: 'w' });
      expect(result.options.sprintNumber).toBe(5);
      expect(result.options.sprintStart).toBe('2026-01-05');
      expect(result.options.sprintMode).toBe('explicit');
    });

    it('preserves s unit in AST as first-class unit', () => {
      const result = parseGantt(
        'gantt\nsprint-length 2w\n2s Design\n1s Build',
        palette
      );
      const tasks = result.nodes.filter((n) => n.kind === 'task');
      expect(tasks).toHaveLength(2);
      if (tasks[0].kind === 'task') {
        expect(tasks[0].duration?.unit).toBe('s');
      }
    });
  });
});
