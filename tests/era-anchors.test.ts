// An era end may name an element on the axis and follows it (#2373, #2405).
import { describe, it, expect } from 'vitest';
import { parseGantt } from '../src/gantt/parser';
import { calculateSchedule } from '../src/gantt/calculator';
import { parseVisualization } from '../src/visualizations/parse';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

function gantt(eras: string, task1 = '30bd') {
  return calculateSchedule(
    parseGantt(
      `gantt Plan
start-date 2026-01-15

${eras}

Task1 ${task1}
-> Task2 10d
-> "Task Three" 1w
-> Task4 2w

[Build]
  Wire 5d
  -> Test 5d`,
      palette
    )
  );
}

const errors = (r: {
  diagnostics: readonly { severity: string; message: string }[];
}) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

describe('gantt era anchored to tasks (#2373)', () => {
  it("the reporter's chart: a task-named era with only a color", () => {
    const r = gantt('era Task2 -> "Task Three" orange');
    expect(errors(r)).toEqual([]);
    const task2 = r.tasks.find((t) => t.task.label === 'Task2')!;
    const three = r.tasks.find((t) => t.task.label === 'Task Three')!;
    expect(r.eras).toHaveLength(1);
    expect(r.eras[0]!.startAt).toEqual(task2.startDate);
    expect(r.eras[0]!.endAt).toEqual(three.endDate);
    expect(r.eras[0]!.label).toBe('');
    expect(r.eras[0]!.color).not.toBeNull();
  });

  it('follows the tasks when an earlier duration changes', () => {
    const a = gantt('era Task2 -> "Task Three" Review').eras[0]!;
    const b = gantt('era Task2 -> "Task Three" Review', '40bd').eras[0]!;
    expect(b.label).toBe('Review');
    expect(b.startAt!.getTime()).toBeGreaterThan(a.startAt!.getTime());
    expect(b.endAt!.getTime() - b.startAt!.getTime()).toBe(
      a.endAt!.getTime() - a.startAt!.getTime()
    );
  });

  it('splits a multi-word label from the end name', () => {
    const r = gantt('era Task1 -> Task2 Late Phase blue');
    expect(r.eras[0]!.label).toBe('Late Phase');
  });

  it('a [Group] end spans the group', () => {
    const r = gantt('era [Build] -> [Build] Build window');
    const g = r.groups.find((x) => x.name === 'Build')!;
    expect(r.eras[0]!.startAt).toEqual(g.startDate);
    expect(r.eras[0]!.endAt).toEqual(g.endDate);
    expect(r.eras[0]!.label).toBe('Build window');
  });

  it('mixes a date with a task, and an offset with a task', () => {
    const r = gantt('era 2026-01-20 -> Task2 Early\nera +1w -> Task2 Lead');
    expect(errors(r)).toEqual([]);
    expect(r.eras[0]!.startDate).toBe('2026-01-20');
    expect(r.eras[1]!.startDate).toBe('2026-01-22');
    expect(r.eras[1]!.endAt).toBeDefined();
  });

  it('works inside an era block', () => {
    const r = gantt(
      'era\n  Task1 -> Task2 Block\n  2026-03-01 -> 2026-03-05 Dated'
    );
    expect(r.eras.map((e) => e.label)).toEqual(['Block', 'Dated']);
  });

  it('an unknown name is an error naming the name, and the era is dropped', () => {
    const r = gantt('era Task9 -> Task2 X\nera Task2 -> Nope Y');
    expect(r.eras).toHaveLength(0);
    expect(errors(r).some((m) => m.includes('"Task9"'))).toBe(true);
    expect(errors(r).some((m) => m.includes('"Nope"'))).toBe(true);
  });

  it('a line with no arrow says what an era takes, not what a task takes', () => {
    const msgs = errors(gantt('era Task2 to Task3'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('task or [Group] name');
    expect(msgs[0]).not.toContain('Expected task');
  });

  it('dated eras still work, and a lone color word is the color', () => {
    const r = gantt('era 2026-02-02 -> 2026-02-20 blue');
    expect(r.eras[0]!.label).toBe('');
    expect(r.eras[0]!.color).not.toBeNull();
  });

  it('an impossible date is an error in era, marker and holiday', () => {
    const r = gantt(
      'era 2026-01-30 -> 2026-02-30 X\nmarker 2026-04-31 M\nholiday 2026-02-29 H'
    );
    const msgs = errors(r).filter((m) => m.includes('not a real date'));
    expect(msgs).toHaveLength(3);
  });
});

describe('timeline era anchored to events (#2405)', () => {
  const tl = (eras: string) =>
    parseVisualization(
      `timeline Pirates

${eras}

[Crew]
  1716 Nassau Republic
  1718 -> 1721 Woodes Rogers
1722 Later`,
      palette
    );

  it('a named start takes the event date, a named end its end date', () => {
    const p = tl('era Nassau Republic -> Woodes Rogers Golden Age orange');
    expect(p.timelineEras).toHaveLength(1);
    const e = p.timelineEras[0]!;
    expect([e.startDate, e.endDate, e.label]).toEqual([
      '1716',
      '1721',
      'Golden Age',
    ]);
    expect(e.color).not.toBeNull();
  });

  it('a point event ends where it starts; a lane spans its events', () => {
    const p = tl(
      'era Woodes Rogers -> Later Aftermath\nera [Crew] -> [Crew] Crew'
    );
    expect(p.timelineEras.map((e) => [e.startDate, e.endDate])).toEqual([
      ['1718', '1722'],
      ['1716', '1721'],
    ]);
  });

  it('dated eras are unchanged', () => {
    const p = tl('era 1716 -> 1718 Old Form');
    expect(p.timelineEras[0]!.label).toBe('Old Form');
  });

  it('an unknown name is an error and the era is dropped', () => {
    const p = tl('era Nope -> 1720 X');
    expect(p.timelineEras).toHaveLength(0);
    expect(errors(p).some((m) => m.includes('"Nope"'))).toBe(true);
  });
});

describe('gantt era that runs backwards', () => {
  it('warns instead of silently drawing nothing', () => {
    const r = gantt('era Task4 -> Task1 Backwards');
    expect(
      r.diagnostics.some(
        (d) =>
          d.severity === 'warning' &&
          d.message.includes('ends before it starts')
      )
    ).toBe(true);
  });
});

describe('gantt marker anchored to a task (#2407)', () => {
  it('sits at the task start and follows it', () => {
    const a = gantt('marker Task2 Handoff orange');
    const b = gantt('marker Task2 Handoff orange', '40bd');
    const task2 = a.tasks.find((t) => t.task.label === 'Task2')!;
    expect(errors(a)).toEqual([]);
    expect(a.markers[0]!.at).toEqual(task2.startDate);
    expect(a.markers[0]!.label).toBe('Handoff');
    expect(a.markers[0]!.color).not.toBeNull();
    expect(b.markers[0]!.at!.getTime()).toBeGreaterThan(
      a.markers[0]!.at!.getTime()
    );
  });

  it('names a quoted task or a [Group], in flat and block form', () => {
    const r = gantt(
      'marker\n  "Task Three" Review\n  [Build] Build starts\n  2026-03-01 Dated'
    );
    expect(r.markers.map((m) => m.label)).toEqual([
      'Review',
      'Build starts',
      'Dated',
    ]);
    const g = r.groups.find((x) => x.name === 'Build')!;
    expect(r.markers[1]!.at).toEqual(g.startDate);
  });

  it('an unknown name is an error and the marker is dropped', () => {
    const r = gantt('marker Nope Launch');
    expect(r.markers).toHaveLength(0);
    expect(errors(r).some((m) => m.includes('"Nope"'))).toBe(true);
  });
});

describe('timeline marker anchored to an event (#2407)', () => {
  const tl = (markers: string) =>
    parseVisualization(
      `timeline Pirates

${markers}

[Crew]
  1716 Nassau Republic
  1718 -> 1721 Woodes Rogers
1722 Later`,
      palette
    );

  it('sits at the event start; a lane marker at its first event', () => {
    const p = tl(
      'marker Woodes Rogers Arrives orange\nmarker [Crew] Crew forms'
    );
    expect(p.timelineMarkers.map((m) => [m.date, m.label])).toEqual([
      ['1718', 'Arrives'],
      ['1716', 'Crew forms'],
    ]);
  });

  it('dated markers are unchanged; an unknown name is an error', () => {
    const p = tl('marker 1720 Pardon\nmarker Nope X');
    expect(p.timelineMarkers.map((m) => m.label)).toEqual(['Pardon']);
    expect(errors(p).some((m) => m.includes('"Nope"'))).toBe(true);
  });
});
