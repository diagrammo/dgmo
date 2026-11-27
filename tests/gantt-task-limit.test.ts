import { describe, it, expect } from 'vitest';
import { parseGantt } from '../src/gantt/parser';
import { calculateSchedule } from '../src/gantt/calculator';
import { collectTasks } from '../src/gantt/resolver';
import { GANTT_MAX_TASKS } from '../src/gantt/limits';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

/** A gantt with `n` tasks in one group, like the 300-task pressure file (#2442). */
function ganttWith(n: number, extra = ''): string {
  const rows = Array.from({ length: n }, (_, i) => `  Task ${i + 1} 2d`);
  return `gantt Pressure\nstart 2026-01-05\n\n[Work]\n${rows.join('\n')}\n${extra}`;
}

const tooMany = (src: string) =>
  parseGantt(src, palette).diagnostics.filter(
    (d) => d.code === 'E_GANTT_TOO_MANY_TASKS'
  );

describe('gantt task limit (#2442)', () => {
  it('draws exactly GANTT_MAX_TASKS tasks with no diagnostic', () => {
    const parsed = parseGantt(ganttWith(GANTT_MAX_TASKS), palette);
    expect(collectTasks(parsed.nodes)).toHaveLength(GANTT_MAX_TASKS);
    expect(tooMany(ganttWith(GANTT_MAX_TASKS))).toHaveLength(0);
  });

  it('past the limit keeps the first N in source order and raises one error', () => {
    const src = ganttWith(GANTT_MAX_TASKS + 1);
    const parsed = parseGantt(src, palette);
    const tasks = collectTasks(parsed.nodes);
    expect(tasks).toHaveLength(GANTT_MAX_TASKS);
    expect(tasks[0]!.label).toBe('Task 1');
    expect(tasks.at(-1)!.label).toBe(`Task ${GANTT_MAX_TASKS}`);
    const errs = tooMany(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.severity).toBe('error');
    expect(errs[0]!.message).toContain(`${GANTT_MAX_TASKS + 1} tasks`);
    expect(errs[0]!.message).toContain(`first ${GANTT_MAX_TASKS}`);
    // On the line of the first task not drawn.
    const lines = src.split('\n');
    expect(lines[errs[0]!.line - 1]!.trim()).toBe(
      `Task ${GANTT_MAX_TASKS + 1} 2d`
    );
  });

  it('300 tasks schedule N rows with one error', () => {
    const parsed = parseGantt(ganttWith(300), palette);
    const schedule = calculateSchedule(parsed);
    expect(schedule.tasks).toHaveLength(GANTT_MAX_TASKS);
    expect(schedule.groups.map((g) => g.name)).toEqual(['Work']);
    expect(
      schedule.diagnostics.filter((d) => d.severity === 'error')
    ).toHaveLength(1);
  });

  it('drops a dependency onto an undrawn task so no arrow dangles', () => {
    const lines = Array.from({ length: GANTT_MAX_TASKS + 5 }, (_, i) =>
      i === 0
        ? `  Task 1 2d\n    -> Task ${GANTT_MAX_TASKS + 3}\n    -> Task 2`
        : `  Task ${i + 1} 2d`
    );
    const src = `gantt Deps\nstart 2026-01-05\n\n[Work]\n${lines.join('\n')}\n`;
    const parsed = parseGantt(src, palette);
    const first = collectTasks(parsed.nodes)[0]!;
    expect(first.dependencies.map((d) => d.targetName)).toEqual(['Task 2']);
    const schedule = calculateSchedule(parsed);
    expect(schedule.diagnostics.filter((d) => d.severity !== 'info')).toEqual(
      tooMany(src)
    );
  });

  it('drops a group whose tasks are all past the limit', () => {
    const src = `${ganttWith(GANTT_MAX_TASKS)}\n[Later]\n  Late task 2d\n`;
    const parsed = parseGantt(src, palette);
    const groups = parsed.nodes.filter((n) => n.kind === 'group');
    expect(groups.map((g) => (g.kind === 'group' ? g.name : ''))).toEqual([
      'Work',
    ]);
  });
});
