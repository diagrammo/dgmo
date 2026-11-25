// @vitest-environment jsdom
// Calendar groups, the legend and events (§41.4–§41.6, #1877).
import { describe, expect, it, vi } from 'vitest';
import { calendarSummary } from '../src/calendar/format';
import { parseCalendar } from '../src/calendar/parser';
import { renderCalendar } from '../src/calendar/renderer';
import type { CalendarRenderOptions } from '../src/calendar/renderer';
import { resolveColor } from '../src/colors';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

const MOOD = `calendar My year in pixels
year 2026
tag Mood
  Great green
  Ok blue
  Rough red

01-01 Great
01-02 ok
01-03 Rough
01-05 Great
`;

const HABITS = `calendar Habits
year 2026
heat Commits as c
  unit commit
tag Mood as m
  Great green
  Rough red
tag Sleep as s
  Good teal
  Short orange

01-01 c: 4, m: Great, s: Good
01-02 c: 1, m: Rough
01-03 s: Short
`;

function draw(src: string, options: CalendarRenderOptions = {}): HTMLElement {
  const parsed = parseCalendar(src);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    width: 0,
  } as DOMRect);
  renderCalendar(container, parsed, palette, false, options);
  return container;
}

const cell = (c: HTMLElement, date: string) =>
  c.querySelector(`.calendar-day[data-date="${date}"]`)!;
const fill = (c: HTMLElement, date: string) =>
  cell(c, date).getAttribute('fill');
const entries = (c: HTMLElement) =>
  [...c.querySelectorAll('.calendar-legend [data-legend-entry]')].map((e) =>
    e.getAttribute('data-series-name')
  );
const pills = (c: HTMLElement) =>
  [...c.querySelectorAll('.calendar-legend [data-legend-group]')].map((e) =>
    e.getAttribute('data-legend-group')
  );

describe('calendar tag group — renderer', () => {
  it("colours each tagged day by its value and the rest as 'Not logged'", () => {
    const c = draw(MOOD);
    expect(fill(c, '2026-01-01')).toBe(resolveColor('green', palette));
    expect(fill(c, '2026-01-03')).toBe(resolveColor('red', palette));
    expect(cell(c, '2026-01-01').getAttribute('data-tag')).toBe('Great');
    expect(cell(c, '2026-01-01').getAttribute('data-tag-mood')).toBe('great');
    expect(cell(c, '2026-01-04').getAttribute('data-tag')).toBeNull();
    expect(cell(c, '2026-01-04').getAttribute('aria-label')).toBe(
      'Sunday, January 4, 2026: Not logged'
    );
    expect(cell(c, '2026-01-02').getAttribute('aria-label')).toBe(
      'Friday, January 2, 2026: Ok'
    );
    const untagged = fill(c, '2026-01-04');
    expect(fill(c, '2026-06-01')).toBe(untagged);
    expect(untagged).toBe(palette.bg);
  });

  it("lists the values and 'Not logged' in the legend, with no Less … More", () => {
    const c = draw(MOOD);
    expect(entries(c)).toEqual(['Great', 'Ok', 'Rough', 'Not logged']);
    expect(c.querySelector('.calendar-legend-step')).toBeNull();
    expect(c.textContent).not.toContain('Less');
  });

  it('`empty` renames the blank-day label', () => {
    const c = draw(MOOD.replace('year 2026', 'year 2026\nempty Skipped'));
    expect(entries(c)).toEqual(['Great', 'Ok', 'Rough', 'Skipped']);
    expect(cell(c, '2026-01-04').getAttribute('aria-label')).toContain(
      'Skipped'
    );
  });

  it('gives a bare tag value a palette colour of its own', () => {
    const c = draw(
      'calendar\nyear 2026\ntag Mood\n  Great\n  Rough\n\n01-01 Great\n01-02 Rough\n'
    );
    expect(fill(c, '2026-01-01')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(fill(c, '2026-01-01')).not.toBe(fill(c, '2026-01-02'));
  });

  it('summarises the days logged and the most frequent value', () => {
    expect(calendarSummary(parseCalendar(MOOD))).toBe(
      '4 days logged · most often Great'
    );
  });

  it("keeps a gray tag apart from 'Not logged'", () => {
    const c = draw('calendar\nyear 2026\ntag Mood\n  Meh gray\n\n01-01 Meh\n');
    expect(fill(c, '2026-01-01')).toBe(resolveColor('gray', palette));
    expect(fill(c, '2026-01-02')).toBe(palette.bg);
    expect(cell(c, '2026-01-02').getAttribute('stroke')).not.toBe(
      cell(c, '2026-01-01').getAttribute('stroke')
    );
  });

  it('a legend value keeps only its days lit', () => {
    const c = draw(MOOD);
    const great = c.querySelector(
      '.calendar-legend [data-series-name="Great"]'
    )!;
    great.dispatchEvent(new Event('mouseenter'));
    const lit = [...c.querySelectorAll<SVGRectElement>('.calendar-day')]
      .filter((d) => d.style.opacity === '')
      .map((d) => d.getAttribute('data-date'));
    expect(lit).toEqual(['2026-01-01', '2026-01-05']);
  });
});

describe('calendar groups — the legend (§41.5)', () => {
  it('draws one pill per group, the first declared open', () => {
    const c = draw(HABITS);
    expect(pills(c)).toEqual(['commits', 'mood', 'sleep']);
    // The open pill is a number group: Less … More steps, shaded tiles.
    expect(c.querySelectorAll('.calendar-legend-step')).toHaveLength(5);
    const lv = (d: string) => Number(cell(c, d).getAttribute('data-level'));
    expect(lv('2026-01-01')).toBeGreaterThan(lv('2026-01-02'));
    expect(lv('2026-01-02')).toBeGreaterThan(0);
    expect(lv('2026-01-03')).toBe(0);
  });

  it('`active-tag` opens another group; the tiles follow it', () => {
    const c = draw(HABITS.replace('year 2026', 'year 2026\nactive-tag Sleep'));
    expect(fill(c, '2026-01-01')).toBe(resolveColor('teal', palette));
    expect(fill(c, '2026-01-03')).toBe(resolveColor('orange', palette));
    expect(cell(c, '2026-01-02').getAttribute('data-tag')).toBeNull();
    expect(entries(c)).toEqual(['Good', 'Short', 'Not logged']);
  });

  it('`active-tag none` draws no colour', () => {
    const c = draw(HABITS.replace('year 2026', 'year 2026\nactive-tag none'));
    const fills = new Set(
      [...c.querySelectorAll('.calendar-day')].map((d) =>
        d.getAttribute('fill')
      )
    );
    expect(fills).toEqual(new Set([palette.bg]));
  });

  it('the summary follows the open pill', () => {
    const p = parseCalendar(HABITS);
    expect(calendarSummary(p)).toBe('5 commits · busiest day Jan 1');
    const mood = parseCalendar(
      HABITS.replace('year 2026', 'year 2026\nactive-tag m')
    );
    expect(calendarSummary(mood)).toBe('2 days logged · most often Great');
    const c = draw(HABITS, { activeTagGroup: 'Sleep' });
    expect(c.querySelector('.chart-subtitle')!.textContent).toBe(
      '2 days logged · most often Good'
    );
  });

  it('a pill click calls back with the group, or redraws with it open', () => {
    const picked: string[] = [];
    const c = draw(HABITS, { onActiveGroupChange: (g) => picked.push(g) });
    c.querySelector('[data-legend-group="mood"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    expect(picked).toEqual(['Mood']);

    const d = draw(HABITS);
    d.querySelector('[data-legend-group="sleep"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    expect(fill(d, '2026-01-01')).toBe(resolveColor('teal', palette));
  });

  it('an export shows only the open group', () => {
    const c = draw(HABITS, { exportMode: true });
    expect(pills(c)).toEqual(['commits']);
  });

  it('the day card lists every group’s mark', () => {
    const c = draw(HABITS);
    cell(c, '2026-01-01').dispatchEvent(new MouseEvent('mouseenter'));
    const tip = c.querySelector<HTMLElement>('[data-d3-tooltip]')!;
    expect(tip.textContent).toBe(
      '4 commitsThursday, January 1, 2026Commits: 4 commitsMood: GreatSleep: Good'
    );
  });
});

describe('calendar events in weeks and months (§41.3)', () => {
  const EVENTS = `calendar Trips
year 2026
layout weeks
tag Kind as k
  Work blue
  Home green

03-10 Dentist k: Home
03-10 Standup k: Work
03-11 Lunch
04-01 -> 04-03 Offsite k: Work
  Agenda in the **wiki**
`;

  it('an event colours its tiles with its value in the open group', () => {
    const c = draw(EVENTS);
    expect(fill(c, '2026-04-01')).toBe(resolveColor('blue', palette));
    expect(fill(c, '2026-04-03')).toBe(resolveColor('blue', palette));
    expect(cell(c, '2026-04-02').getAttribute('data-events')).toBe('1');
  });

  it('a second event on a day adds a corner dot', () => {
    const c = draw(EVENTS);
    expect(fill(c, '2026-03-10')).toBe(resolveColor('green', palette));
    const dots = [...c.querySelectorAll('.calendar-event-dot')];
    const on = (date: string) =>
      dots.filter((d) => d.getAttribute('data-date') === date);
    expect(on('2026-03-10')).toHaveLength(1);
    expect(on('2026-03-10')[0]!.getAttribute('fill')).toBe(
      resolveColor('blue', palette)
    );
    // An event with no value in the open group shows as the dot alone.
    expect(on('2026-03-11')).toHaveLength(1);
    expect(on('2026-04-01')).toHaveLength(0);
  });

  it('names and notes show on hover; `no-notes` hides the notes', () => {
    const tip = (c: HTMLElement) =>
      c.querySelector<HTMLElement>('[data-d3-tooltip]')!.textContent;
    const c = draw(EVENTS);
    cell(c, '2026-04-02').dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip(c)).toBe('WorkThursday, April 2, 2026OffsiteAgenda in the wiki');
    const quiet = draw(
      EVENTS.replace('layout weeks', 'layout weeks\nno-notes')
    );
    cell(quiet, '2026-04-02').dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip(quiet)).toBe('WorkThursday, April 2, 2026Offsite');
  });

  it('an events-only tag legend has no blank-day entry (#2297)', () => {
    expect(entries(draw(EVENTS))).toEqual(['Work', 'Home']);
    expect(
      entries(
        draw(EVENTS.replace('layout weeks', 'layout weeks\nempty Skipped'))
      )
    ).toEqual(['Work', 'Home']);
  });

  it('a calendar whose days carry the tag keeps the blank-day entry (#2297)', () => {
    expect(entries(draw(MOOD))).toContain('Not logged');
  });

  it('an events-only chart counts its events in the summary', () => {
    expect(
      calendarSummary(
        parseCalendar('calendar\nyear 2026\n03-10 Dentist\n03-12 Lunch')
      )
    ).toBe('2 events');
  });
});
