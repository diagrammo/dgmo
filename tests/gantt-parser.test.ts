import { describe, it, expect } from 'vitest';
import { parseGantt } from '../src/gantt/parser';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

describe('gantt parser', () => {
  describe('chart type', () => {
    it('accepts chart: gantt', () => {
      const result = parseGantt('chart: gantt\n10d: Task A', palette);
      expect(result.error).toBeNull();
    });

    it('rejects chart: timeline', () => {
      const result = parseGantt('chart: timeline\n10d: Task A', palette);
      expect(result.error).toMatch(/Expected chart type "gantt"/);
    });
  });

  describe('options', () => {
    it('parses start date', () => {
      const result = parseGantt('chart: gantt\nstart: 2024-01-15\n10d: Task', palette);
      expect(result.options.start).toBe('2024-01-15');
    });

    it('parses title', () => {
      const result = parseGantt('chart: gantt\ntitle: My Plan\n10d: Task', palette);
      expect(result.options.title).toBe('My Plan');
    });

    it('parses today-marker: on', () => {
      const result = parseGantt('chart: gantt\ntoday-marker: on\n10d: Task', palette);
      expect(result.options.todayMarker).toBe('on');
    });

    it('parses today-marker with pinned date', () => {
      const result = parseGantt('chart: gantt\ntoday-marker: 2024-03-15\n10d: Task', palette);
      expect(result.options.todayMarker).toBe('2024-03-15');
    });

    it('parses critical-path: on', () => {
      const result = parseGantt('chart: gantt\ncritical-path: on\n10d: Task', palette);
      expect(result.options.criticalPath).toBe(true);
    });

    it('parses dependencies: on', () => {
      const result = parseGantt('chart: gantt\ndependencies: on\n10d: Task', palette);
      expect(result.options.dependencies).toBe(true);
    });

    it('defaults start to null (relative timeline)', () => {
      const result = parseGantt('chart: gantt\n10d: Task', palette);
      expect(result.options.start).toBeNull();
    });
  });

  describe('duration tasks', () => {
    it('parses basic duration task', () => {
      const result = parseGantt('chart: gantt\n10d: Task A', palette);
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
      const input = 'chart: gantt\n10d: Days\n5bd: Business\n2w: Weeks\n3m: Months\n1q: Quarter\n0.5y: HalfYear';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(6);

      const units = result.nodes.map(n => n.kind === 'task' ? n.duration?.unit : null);
      expect(units).toEqual(['d', 'bd', 'w', 'm', 'q', 'y']);
    });

    it('parses decimal durations', () => {
      const result = parseGantt('chart: gantt\n1.5w: Task', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.duration).toEqual({ amount: 1.5, unit: 'w' });
      }
    });

    it('parses uncertain duration', () => {
      const result = parseGantt('chart: gantt\n30d?: Task', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.uncertain).toBe(true);
        expect(task.duration).toEqual({ amount: 30, unit: 'd' });
      }
    });

    it('parses milestone (0d)', () => {
      const result = parseGantt('chart: gantt\n0d: Milestone', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.duration).toEqual({ amount: 0, unit: 'd' });
      }
    });
  });

  describe('explicit dates', () => {
    it('parses explicit date task', () => {
      const result = parseGantt('chart: gantt\n2024-02-15: Design Review', palette);
      expect(result.error).toBeNull();
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.label).toBe('Design Review');
        expect(task.explicitStart).toBe('2024-02-15');
        expect(task.duration).toBeNull();
      }
    });

    it('parses timeline migration syntax', () => {
      const result = parseGantt('chart: gantt\n2024-01-15 -> 30d: Task', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.explicitStart).toBe('2024-01-15');
        expect(task.duration).toEqual({ amount: 30, unit: 'd' });
      }
    });
  });

  describe('groups', () => {
    it('parses basic group', () => {
      const result = parseGantt('chart: gantt\n[Backend]\n  10d: Task', palette);
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
      const input = 'chart: gantt\ntag: Team alias t\n  Engineering(blue)\n[Backend] | t: Engineering\n  10d: Task';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const group = result.nodes[0];
      if (group.kind === 'group') {
        expect(group.metadata.team).toBe('Engineering');
      }
    });

    it('parses nested groups', () => {
      const input = 'chart: gantt\n[Backend]\n  [API]\n    10d: Task';
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
      const input = 'chart: gantt\nparallel\n  5d: Task A\n  3d: Task B';
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
      const input = 'chart: gantt\nparallel\n  [Backend]\n    10d: Task A\n  [Frontend]\n    5d: Task B';
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
      const input = 'chart: gantt\n10d: Task A\n  -> Task B\n10d: Task B';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies).toHaveLength(1);
        expect(taskA.dependencies[0].targetName).toBe('Task B');
      }
    });

    it('parses -> with dot notation', () => {
      const input = 'chart: gantt\n10d: Task A\n  -> Backend.Deploy\n10d: Deploy';
      const result = parseGantt(input, palette);
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies[0].targetName).toBe('Backend.Deploy');
      }
    });

    it('parses -> with positive offset', () => {
      const input = 'chart: gantt\n10d: Task A\n  -> Task B | offset: 3bd\n10d: Task B';
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
      const input = 'chart: gantt\n10d: Task A\n  -> Task B | offset: -5d\n10d: Task B';
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
      const input = 'chart: gantt\n10d: Task A\n  -> Task B | offset: 0bd\n10d: Task B';
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
      const input = 'chart: gantt\n10d: Task A\n  -> Task B | offset: abc\n10d: Task B';
      const result = parseGantt(input, palette);
      expect(result.diagnostics.some(d => d.message.includes('Invalid offset'))).toBe(true);
    });

    it('warns on explicit + prefix in dep offset', () => {
      const input = 'chart: gantt\n10d: Task A\n  -> Task B | offset: +5bd\n10d: Task B';
      const result = parseGantt(input, palette);
      expect(result.diagnostics.some(d => d.message.includes('Explicit "+" is not supported'))).toBe(true);
    });

    it('warns on deprecated lag keyword', () => {
      const input = 'chart: gantt\n10d: Task A\n  -> Task B | lag: 3bd\n10d: Task B';
      const result = parseGantt(input, palette);
      const taskA = result.nodes[0];
      if (taskA.kind === 'task') {
        expect(taskA.dependencies[0].offset).toBeUndefined();
      }
      expect(result.diagnostics.some(d => d.message.includes('"lag" is deprecated'))).toBe(true);
    });

    it('warns on deprecated lead keyword', () => {
      const input = 'chart: gantt\n10d: Task A\n  -> Task B | lead: 3bd\n10d: Task B';
      const result = parseGantt(input, palette);
      expect(result.diagnostics.some(d => d.message.includes('"lead" is deprecated'))).toBe(true);
    });

    it('warns on deprecated lag on task line', () => {
      const result = parseGantt('chart: gantt\n10bd: Task | lag: 5bd', palette);
      expect(result.diagnostics.some(d => d.message.includes('"lag" is deprecated'))).toBe(true);
    });
  });

  describe('task-level offset', () => {
    it('parses positive task offset', () => {
      const result = parseGantt('chart: gantt\n10bd: Task | offset: 8bd', palette);
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
      const result = parseGantt('chart: gantt\n10bd: Task | offset: -3bd', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.offset).toEqual({
          duration: { amount: 3, unit: 'bd' },
          direction: -1,
        });
      }
    });

    it('warns on invalid task offset', () => {
      const result = parseGantt('chart: gantt\n10bd: Task | offset: abc', palette);
      expect(result.diagnostics.some(d => d.message.includes('Invalid offset'))).toBe(true);
    });
  });

  describe('comments', () => {
    it('parses comment under task', () => {
      const input = 'chart: gantt\n10d: Task A\n  // This is a comment';
      const result = parseGantt(input, palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.comment).toBe('This is a comment');
      }
    });

    it('accumulates multi-line comments', () => {
      const input = 'chart: gantt\n10d: Task A\n  // Line 1\n  // Line 2';
      const result = parseGantt(input, palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.comment).toBe('Line 1\nLine 2');
      }
    });

    it('ignores top-level comments', () => {
      const input = 'chart: gantt\n// Top comment\n10d: Task A';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(1);
    });
  });

  describe('progress', () => {
    it('parses progress shorthand', () => {
      const result = parseGantt('chart: gantt\n10d: Task | 80%', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.progress).toBe(80);
      }
    });

    it('parses progress: key', () => {
      const result = parseGantt('chart: gantt\n10d: Task | progress: 50', palette);
      const task = result.nodes[0];
      if (task.kind === 'task') {
        expect(task.progress).toBe(50);
      }
    });
  });

  describe('tag groups', () => {
    it('parses tag block with entries', () => {
      const input = 'chart: gantt\ntag: Team alias t\n  Engineering(blue)\n  Design(purple)\n10d: Task | t: Engineering';
      const result = parseGantt(input, palette);
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Team');
      expect(result.tagGroups[0].alias).toBe('t');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('tag inheritance from parent group', () => {
      const input = 'chart: gantt\ntag: Team alias t\n  Engineering(blue)\n[Backend] | t: Engineering\n  10d: Task';
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
      const input = 'chart: gantt\ntag: Team alias t\n  Engineering(blue)\n  QA(orange)\n[Backend] | t: Engineering\n  10d: Task | t: QA';
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

  describe('holidays block', () => {
    it('parses holiday dates', () => {
      const input = 'chart: gantt\nholidays\n  2024-01-01: New Year\n  2024-12-25: Christmas\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.dates).toHaveLength(2);
      expect(result.holidays.dates[0].date).toBe('2024-01-01');
      expect(result.holidays.dates[0].label).toBe('New Year');
    });

    it('parses holiday ranges', () => {
      const input = 'chart: gantt\nholidays\n  2024-12-24 -> 2024-12-31: Winter Break\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.ranges).toHaveLength(1);
      expect(result.holidays.ranges[0].startDate).toBe('2024-12-24');
      expect(result.holidays.ranges[0].endDate).toBe('2024-12-31');
    });

    it('parses workweek override', () => {
      const input = 'chart: gantt\nholidays\n  workweek: sun-thu\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.holidays.workweek).toEqual(['sun', 'mon', 'tue', 'wed', 'thu']);
    });

    it('default workweek is mon-fri', () => {
      const result = parseGantt('chart: gantt\n10d: Task', palette);
      expect(result.holidays.workweek).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    });
  });

  describe('eras and markers', () => {
    it('parses era', () => {
      const input = 'chart: gantt\nera 2024-01 -> 2024-06: Phase 1\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.eras).toHaveLength(1);
      expect(result.eras[0].startDate).toBe('2024-01');
      expect(result.eras[0].endDate).toBe('2024-06');
      expect(result.eras[0].label).toBe('Phase 1');
    });

    it('parses marker', () => {
      const input = 'chart: gantt\nmarker 2024-03-01: Kickoff\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.markers).toHaveLength(1);
      expect(result.markers[0].date).toBe('2024-03-01');
      expect(result.markers[0].label).toBe('Kickoff');
    });
  });

  describe('validation errors', () => {
    it('rejects bare labels', () => {
      const result = parseGantt('chart: gantt\nSome Text', palette);
      expect(result.error).toMatch(/Expected duration/);
    });

    it('parallel is reserved keyword', () => {
      const result = parseGantt('chart: gantt\n10d: parallel', palette);
      expect(result.error).toMatch(/reserved keyword/);
    });
  });

  describe('flat task list (no groups)', () => {
    it('accepts flat sequential tasks', () => {
      const input = 'chart: gantt\n14d: Research\n7d: Design\n3d: Testing\n0d: Ship';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.nodes).toHaveLength(4);
      expect(result.nodes.every(n => n.kind === 'task')).toBe(true);
    });
  });

  describe('sort: tag directive', () => {
    it('parses sort: tag', () => {
      const input = 'chart: gantt\nsort: tag\ntag: Team\n  Eng(blue)\nstart: 2024-01-15\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.options.sort).toBe('tag');
      expect(result.options.defaultSwimlaneGroup).toBeNull();
    });

    it('parses sort: tag:Team', () => {
      const input = 'chart: gantt\nsort: tag:Team\ntag: Team\n  Eng(blue)\nstart: 2024-01-15\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.error).toBeNull();
      expect(result.options.sort).toBe('tag');
      expect(result.options.defaultSwimlaneGroup).toBe('Team');
    });

    it('warns and falls back when no tag groups defined', () => {
      const input = 'chart: gantt\nsort: tag\nstart: 2024-01-15\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.options.sort).toBe('default');
      expect(result.diagnostics.some(d => d.message.includes('sort: tag has no effect'))).toBe(true);
    });

    it('warns on invalid sort value', () => {
      const input = 'chart: gantt\nsort: date\nstart: 2024-01-15\n10d: Task';
      const result = parseGantt(input, palette);
      expect(result.diagnostics.some(d => d.message.includes('Invalid sort value'))).toBe(true);
    });
  });
});
