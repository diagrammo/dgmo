// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { calendarSummary, shadeLevels, unitFor } from '../src/calendar/format';
import { parseCalendar } from '../src/calendar/parser';
import { renderCalendar } from '../src/calendar/renderer';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { resolveColor } from '../src/colors';

const palette = getPalette('nord').light;

function draw(src: string, exportMode = false): HTMLElement {
  const parsed = parseCalendar(src);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    width: 0,
  } as DOMRect);
  renderCalendar(container, parsed, palette, false, { exportMode });
  return container;
}

const day = (c: HTMLElement, date: string) =>
  c.querySelector(`.calendar-day[data-date="${date}"]`)!;
const xy = (el: Element) => ({
  x: Number(el.getAttribute('x')),
  y: Number(el.getAttribute('y')),
});

const YEAR = `calendar Runs in 2026
year 2026
unit run

01-01 1
01-02 2
03-10 5
03-11 3
`;

describe('calendar grid (#1855)', () => {
  it('draws one square per day of the year', () => {
    expect(draw(YEAR).querySelectorAll('.calendar-day')).toHaveLength(365);
  });

  it('puts weeks across and weekdays down, week one holding 1 January', () => {
    const c = draw(YEAR);
    // 1 January 2026 is a Thursday: column 0, row 4 under a Sunday start.
    const jan1 = xy(day(c, '2026-01-01'));
    const jan3 = xy(day(c, '2026-01-03')); // Saturday, same column
    const jan4 = xy(day(c, '2026-01-04')); // Sunday, next column, top row
    expect(jan3.x).toBe(jan1.x);
    expect(jan3.y).toBeGreaterThan(jan1.y);
    expect(jan4.x).toBeGreaterThan(jan1.x);
    expect(jan4.y).toBeLessThan(jan1.y);
    const pitch = jan4.x - jan1.x;
    expect(jan1.y - jan4.y).toBe(4 * pitch);
    // 31 December 2026 (a Thursday) is in the 53rd column.
    expect(xy(day(c, '2026-12-31')).x - jan1.x).toBe(52 * pitch);
  });

  it('`week-start monday` puts Monday on the top row', () => {
    const c = draw(`${YEAR}week-start monday\n`);
    const mon = xy(day(c, '2026-01-05'));
    const sun = xy(day(c, '2026-01-04'));
    expect(mon.x).toBeGreaterThan(sun.x);
    expect(mon.y).toBeLessThan(sun.y);
    const tops = [...c.querySelectorAll('.calendar-day')].map((r) =>
      Number(r.getAttribute('y'))
    );
    expect(mon.y).toBe(Math.min(...tops));
  });

  it('labels the months and only Mon, Wed and Fri', () => {
    const c = draw(YEAR);
    const months = [...c.querySelectorAll('.calendar-month')].map(
      (t) => t.textContent
    );
    expect(months).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
    const weekdays = [...c.querySelectorAll('.calendar-weekday')].map(
      (t) => t.textContent
    );
    expect(weekdays).toEqual(['Mon', 'Wed', 'Fri']);
    expect(
      [
        ...draw(`${YEAR}week-start monday\n`).querySelectorAll(
          '.calendar-weekday'
        ),
      ].map((t) => t.textContent)
    ).toEqual(['Mon', 'Wed', 'Fri']);
  });

  it('centres each month name over the weeks its month spans', () => {
    const c = draw(YEAR);
    const mar = [...c.querySelectorAll('.calendar-month')].find(
      (t) => t.textContent === 'Mar'
    )!;
    const first = day(c, '2026-03-01');
    const last = day(c, '2026-03-31');
    const mid =
      (xy(first).x + xy(last).x + Number(last.getAttribute('width'))) / 2;
    expect(mar.getAttribute('text-anchor')).toBe('middle');
    expect(Number(mar.getAttribute('x'))).toBeCloseTo(mid, 6);
  });

  it('grows the squares for a short span', () => {
    const year = draw(YEAR);
    const short = draw('calendar\nfrom 2026-09-01 to 2026-11-30\n2026-09-02 6');
    const w = (c: HTMLElement) =>
      Number(c.querySelector('.calendar-day')!.getAttribute('width'));
    expect(w(short)).toBeGreaterThan(w(year));
    expect(short.querySelectorAll('.calendar-day')).toHaveLength(91);
  });

  it('says the value, unit and full weekday date on each day', () => {
    const c = draw(YEAR);
    expect(day(c, '2026-03-10').getAttribute('aria-label')).toBe(
      'Tuesday, March 10, 2026: 5 runs'
    );
    expect(day(c, '2026-01-01').getAttribute('aria-label')).toBe(
      'Thursday, January 1, 2026: 1 run'
    );
    expect(day(c, '2026-06-01').getAttribute('aria-label')).toBe(
      'Monday, June 1, 2026: 0 runs'
    );
    expect(day(c, '2026-03-10').getAttribute('data-line-number')).toBe('7');
    expect(day(c, '2026-06-01').getAttribute('data-line-number')).toBeNull();
  });

  it('makes every day a Tab stop on screen, and none in an export', () => {
    expect(day(draw(YEAR), '2026-03-10').getAttribute('tabindex')).toBe('0');
    expect(
      day(draw(YEAR, true), '2026-03-10').getAttribute('tabindex')
    ).toBeNull();
  });

  it('shows the value and date in the tooltip on hover and on focus', () => {
    const c = draw(YEAR);
    const tip = () => c.querySelector<HTMLElement>('[data-d3-tooltip]')!;
    day(c, '2026-03-10').dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip().style.display).toBe('block');
    expect(tip().textContent).toBe('5 runsTuesday, March 10, 2026');
    day(c, '2026-03-10').dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip().style.display).toBe('none');
    day(c, '2026-01-02').dispatchEvent(new FocusEvent('focus'));
    expect(tip().textContent).toBe('2 runsFriday, January 2, 2026');
  });
});

describe('calendar shading (#1855)', () => {
  it('splits the non-zero days into four equal-count bands', () => {
    const level = shadeLevels([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(level)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it('keeps one huge day from washing the rest out', () => {
    const level = shadeLevels([1, 1, 2, 2, 3, 3, 1000]);
    expect(level(3)).toBe(4 - 1);
    expect(level(1000)).toBe(4);
    expect(level(2)).toBeGreaterThan(level(1));
  });

  it('`max` pins the top band at that value', () => {
    const level = shadeLevels([1, 30], 20);
    expect([0, 1, 5, 6, 10, 15, 19, 20, 30].map(level)).toEqual([
      0, 1, 1, 2, 2, 3, 4, 4, 4,
    ]);
  });

  it('draws the shade on each square and five steps in the legend', () => {
    const c = draw(YEAR);
    expect(day(c, '2026-06-01').getAttribute('data-level')).toBe('0');
    expect(day(c, '2026-03-10').getAttribute('data-level')).toBe('4');
    const steps = [...c.querySelectorAll('.calendar-legend-step')];
    expect(steps.map((s) => s.getAttribute('data-level'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ]);
    const fill = (el: Element) => el.getAttribute('fill');
    expect(fill(day(c, '2026-03-10'))).toBe(fill(steps[4]!));
    expect(fill(day(c, '2026-06-01'))).toBe(fill(steps[0]!));
    expect(new Set(steps.map(fill)).size).toBe(5);
    const words = [...c.querySelectorAll('.calendar-legend text')].map(
      (t) => t.textContent
    );
    expect(words).toEqual(['Less', 'More']);
  });

  it('`no-legend` drops the legend', () => {
    expect(
      draw(`${YEAR}no-legend\n`).querySelector('.calendar-legend')
    ).toBeNull();
  });
});

describe('calendar summary (#1855)', () => {
  it('puts the total and the busiest day on the subtitle line', () => {
    const c = draw(YEAR);
    expect(c.querySelector('.chart-subtitle')!.textContent).toBe(
      '11 runs · busiest day Mar 10'
    );
  });

  it('`no-summary` turns it off, and an authored subtitle replaces it', () => {
    expect(
      draw(`${YEAR}no-summary\n`).querySelector('.chart-subtitle')
    ).toBeNull();
    expect(
      draw(`${YEAR}subtitle Every run logged\n`).querySelector(
        '.chart-subtitle'
      )!.textContent
    ).toBe('Every run logged');
  });

  it('names the year of the busiest day when the span crosses one', () => {
    const p = parseCalendar('calendar\n2025-12-30 2\n2026-01-02 4\nunit km');
    expect(calendarSummary(p)).toBe('6 km · busiest day Jan 2, 2026');
  });

  it('says nothing when no day has a value', () => {
    expect(calendarSummary(parseCalendar('calendar\nyear 2026'))).toBeNull();
  });

  it('pluralises a word unit and leaves a symbol alone', () => {
    expect(unitFor('commit', 2)).toBe('commits');
    expect(unitFor('commit', 1)).toBe('commit');
    expect(unitFor('box', 3)).toBe('boxes');
    expect(unitFor('entry', 3)).toBe('entries');
    expect(unitFor('km', 3)).toBe('km');
    expect(unitFor('$', 3)).toBe('$');
  });
});

describe('calendar export (#1855)', () => {
  it('renders through renderForExport', async () => {
    const svg = await renderForExport(YEAR, 'light');
    expect(svg).toContain('calendar-day');
    expect(svg).toContain('Runs in 2026');
    expect(svg).not.toContain('tabindex');
  });
});

describe('calendar multi-year span (#2089)', () => {
  const SPAN = `calendar Voyages
from 2023-03-10 to 2026-09-20
unit voyage

2023-07-04 5
2026-09-20 8
`;

  it('stacks one band per calendar year so the canvas stays a year wide', () => {
    const c = draw(SPAN);
    const years = [...c.querySelectorAll('.calendar-year')].map(
      (t) => t.textContent
    );
    expect(years).toEqual(['2023', '2024', '2025', '2026']);
    const width = Number(c.querySelector('svg')!.getAttribute('width'));
    // A year at the base pitch is about 53 * 14 = 742px of grid.
    expect(width).toBeLessThan(900);
    // Later years sit lower, at the same left edge for 1 January's column.
    const a = xy(day(c, '2023-07-04'));
    const b = xy(day(c, '2026-09-20'));
    expect(b.y).toBeGreaterThan(a.y);
    expect(day(c, '2024-01-01').getAttribute('x')).toBe(
      day(c, '2025-01-01').getAttribute('x')
    );
    expect(c.querySelectorAll('.calendar-day')).toHaveLength(
      Math.round((Date.UTC(2026, 8, 20) - Date.UTC(2023, 2, 10)) / 86_400_000) +
        1
    );
  });

  it('shows no year label for a span of a year or less', () => {
    expect(draw(YEAR).querySelectorAll('.calendar-year')).toHaveLength(0);
  });
});

describe('calendar hovers (#2090, #2091)', () => {
  const hover = (el: Element) => el.dispatchEvent(new Event('mouseenter'));
  const leave = (el: Element) => el.dispatchEvent(new Event('mouseleave'));
  const lit = (c: HTMLElement) =>
    [...c.querySelectorAll<SVGRectElement>('.calendar-day')]
      .filter((d) => d.style.opacity === '')
      .map((d) => d.getAttribute('data-date')!);
  const outline = (c: HTMLElement) =>
    c.querySelector('.calendar-span')!.getAttribute('d')!;

  it('a month name keeps only that month lit and outlines it', () => {
    const c = draw(YEAR);
    const mar = c.querySelector('.calendar-month[data-month="2026-03"]')!;
    hover(mar);
    const on = lit(c);
    expect(on).toHaveLength(31);
    expect(on.every((d) => d.startsWith('2026-03'))).toBe(true);
    // Drawn in the squares' own frame, which the title band shifts down.
    expect(c.querySelector('.calendar-days > .calendar-span')).not.toBeNull();
    // A ragged month has more than four edges.
    expect(outline(c).match(/M/g)!.length).toBeGreaterThan(4);
    leave(mar);
    expect(lit(c)).toHaveLength(365);
    expect(outline(c)).toBe('');
  });

  it('keeps the same month apart in two years', () => {
    const c = draw(`calendar Voyages
from 2025-11-01 to 2026-12-31

2025-12-04 5
2026-12-20 8
`);
    hover(c.querySelector('.calendar-month[data-month="2025-12"]')!);
    const on = lit(c);
    expect(on).toHaveLength(31);
    expect(on.every((d) => d.startsWith('2025-12'))).toBe(true);
  });

  it('a legend shade keeps only days at that shade lit, with no outline', () => {
    const c = draw(YEAR);
    const step = c.querySelector('.calendar-legend-step[data-level="0"]')!;
    hover(step);
    const on = lit(c);
    expect(on).toHaveLength(365 - 4);
    expect(on).not.toContain('2026-03-10');
    expect(outline(c)).toBe('');
  });

  it('"busiest day" in the summary rings that one day', () => {
    const c = draw(YEAR);
    const phrase = c.querySelector('.calendar-busiest')!;
    expect(phrase.textContent).toBe('busiest day Mar 10');
    expect(phrase.parentElement!.textContent).toContain('· busiest day Mar 10');
    hover(phrase);
    expect(lit(c)).toEqual(['2026-03-10']);
    expect(outline(c).match(/M/g)).toHaveLength(4);
  });

  it('export mode adds no hovers and no month keys', () => {
    const c = draw(YEAR, true);
    expect(c.querySelector('[data-month]')).toBeNull();
    expect(c.querySelector('.calendar-span')).toBeNull();
    expect(c.querySelector('.calendar-busiest')).toBeNull();
  });
});

describe('calendar heat colours', () => {
  const steps = (c: HTMLElement) =>
    [...c.querySelectorAll('.calendar-legend-step')].map((s) =>
      s.getAttribute('fill')
    );
  const withHeat = (line: string) =>
    YEAR.replace('unit run', `unit run\n${line}`);

  it('reads the shared ramp line: label, then up to two colours', () => {
    expect(parseCalendar(withHeat('heat Runs blue red')).heat).toEqual({
      label: 'Runs',
      low: 'blue',
      high: 'red',
    });
    // A lone word is the label, never a colour.
    expect(parseCalendar(withHeat('heat Red')).heat).toEqual({
      label: 'Red',
    });
  });

  it('a label alone keeps the greens and prints before "Less"', () => {
    const plain = draw(YEAR);
    const named = draw(withHeat('heat Runs'));
    expect(steps(named)).toEqual(steps(plain));
    expect(named.querySelector('.calendar-legend-label')!.textContent).toBe(
      'Runs'
    );
  });

  it('one colour replaces the green; zero stays grey', () => {
    const plain = steps(draw(YEAR));
    const red = steps(draw(withHeat('heat Runs red')));
    expect(red[0]).toBe(plain[0]);
    expect(red[4]).toBe(resolveColor('red', palette));
  });

  it('two colours run the four shades from low to high', () => {
    const s = steps(draw(withHeat('heat Runs blue red')));
    expect(s[1]).toBe(resolveColor('blue', palette));
    expect(s[4]).toBe(resolveColor('red', palette));
    expect(new Set(s).size).toBe(5);
  });
});
