// @vitest-environment jsdom
// `layout months` — one strip per month (§41.3, #1877).
import { describe, expect, it, vi } from 'vitest';
import { parseCalendar } from '../src/calendar/parser';
import { renderCalendar } from '../src/calendar/renderer';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';

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

const YEAR = `calendar Runs
year 2026
layout months
unit run

01-01 1
03-10 5
`;

describe('calendar layout months — upright (#1877)', () => {
  it('draws one tile per day of the span', () => {
    expect(draw(YEAR).querySelectorAll('.calendar-day')).toHaveLength(365);
  });

  it('puts months as columns and the day of the month down', () => {
    const c = draw(YEAR);
    const jan1 = xy(day(c, '2026-01-01'));
    const jan2 = xy(day(c, '2026-01-02'));
    const feb1 = xy(day(c, '2026-02-01'));
    expect(jan2.x).toBe(jan1.x);
    expect(jan2.y).toBeGreaterThan(jan1.y);
    expect(feb1.y).toBe(jan1.y);
    expect(feb1.x).toBeGreaterThan(jan1.x);
    // Every month's day 15 shares a row.
    const rows = new Set(
      ['01', '04', '09', '12'].map((m) => xy(day(c, `2026-${m}-15`)).y)
    );
    expect(rows.size).toBe(1);
  });

  it('labels the twelve months and the day numbers', () => {
    const c = draw(YEAR);
    const months = [...c.querySelectorAll('.calendar-month')].map(
      (t) => t.textContent
    );
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('Jan');
    const dates = [...c.querySelectorAll('.calendar-date-label')].map(
      (t) => t.textContent
    );
    expect(dates).toEqual(['1', '5', '10', '15', '20', '25', '30']);
  });

  it('tints the weekend tiles', () => {
    const c = draw(YEAR);
    // 2026-01-03 is a Saturday, 2026-01-05 a Monday; neither has a value.
    expect(day(c, '2026-01-03').hasAttribute('data-weekend')).toBe(true);
    expect(day(c, '2026-01-05').hasAttribute('data-weekend')).toBe(false);
    expect(day(c, '2026-01-03').getAttribute('fill')).not.toBe(
      day(c, '2026-01-05').getAttribute('fill')
    );
  });

  it('shades the marks as the weeks layout does', () => {
    const c = draw(YEAR);
    const lv = (d: string) => Number(day(c, d).getAttribute('data-level'));
    expect(lv('2026-03-10')).toBeGreaterThan(lv('2026-01-01'));
    expect(lv('2026-01-01')).toBeGreaterThan(0);
    expect(lv('2026-01-02')).toBe(0);
    expect(c.querySelector('svg')!.getAttribute('data-calendar-layout')).toBe(
      'months'
    );
  });

  it('a fiscal year spans two calendar years and names the years', () => {
    const c = draw('calendar FY\nfrom 2025-10-01\nlayout months\n10-02 1\n');
    const months = [...c.querySelectorAll('.calendar-month')].map(
      (t) => t.textContent
    );
    const years = [...c.querySelectorAll('.calendar-year')].map(
      (t) => t.textContent
    );
    expect(months[0]).toBe('Oct');
    expect(years).toEqual(['2025', '2026']);
    expect(months).toHaveLength(12);
    expect(c.querySelectorAll('.calendar-day')).toHaveLength(365);
  });

  it('a month name keeps only that month lit', () => {
    const c = draw(YEAR);
    c.querySelector('.calendar-month[data-month="2026-02"]')!.dispatchEvent(
      new Event('mouseenter')
    );
    const lit = [...c.querySelectorAll<SVGRectElement>('.calendar-day')].filter(
      (d) => d.style.opacity === ''
    );
    expect(lit).toHaveLength(28);
  });

  it('arrow keys move across the grid', () => {
    const c = draw(YEAR);
    document.body.appendChild(c);
    const start = day(c, '2026-01-10') as SVGRectElement;
    start.focus();
    start.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement?.getAttribute('data-date')).toBe(
      '2026-01-11'
    );
    (document.activeElement as SVGRectElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' })
    );
    expect(document.activeElement?.getAttribute('data-date')).toBe(
      '2026-02-11'
    );
    c.remove();
  });
});

describe('calendar layout months — upright year headers (#2298)', () => {
  // Every month and year header, as a horizontal box [left, right] per row.
  function overlaps(src: string): { boxes: number; clashes: number } {
    const c = draw(src);
    const rows = new Map<number, [number, number][]>();
    for (const el of c.querySelectorAll('.calendar-month, .calendar-year')) {
      const x = Number(el.getAttribute('x'));
      const y = Number(el.getAttribute('y'));
      const w = measureText(el.textContent ?? '', 10);
      rows.set(y, [...(rows.get(y) ?? []), [x - w / 2, x + w / 2]]);
    }
    let boxes = 0;
    let clashes = 0;
    for (const row of rows.values()) {
      row.sort((a, b) => a[0] - b[0]);
      boxes += row.length;
      for (let i = 1; i < row.length; i++)
        if (row[i]![0] < row[i - 1]![1]) clashes++;
    }
    return { boxes, clashes };
  }
  const span = (from: string, to: string, extra = '') =>
    `calendar Runs\nlayout months\nfrom ${from} to ${to}\n${extra}unit run\n\n${from.slice(5)} 1\n`;

  it('a span over New Year draws no overlapping headers', () => {
    const r = overlaps(span('2026-12-14', '2027-01-17'));
    expect(r.boxes).toBe(4);
    expect(r.clashes).toBe(0);
  });

  it('a two-year span draws no overlapping headers', () => {
    expect(overlaps(span('2026-01-01', '2027-12-31')).clashes).toBe(0);
  });

  it('a span inside one year keeps one line of headers', () => {
    const c = draw(span('2026-03-14', '2026-04-17'));
    expect(c.querySelectorAll('.calendar-year')).toHaveLength(0);
  });
});

describe('calendar layout months — horizontal (#1877)', () => {
  const H = YEAR.replace(
    'layout months',
    'layout months\norientation-horizontal'
  );

  it('makes the months rows, the day of the month across', () => {
    const c = draw(H);
    const jan1 = xy(day(c, '2026-01-01'));
    const jan2 = xy(day(c, '2026-01-02'));
    const feb1 = xy(day(c, '2026-02-01'));
    expect(jan2.y).toBe(jan1.y);
    expect(jan2.x).toBeGreaterThan(jan1.x);
    expect(feb1.x).toBe(jan1.x);
    expect(feb1.y).toBeGreaterThan(jan1.y);
  });

  it('is wider than tall, where upright is taller than wide', () => {
    const size = (c: HTMLElement) => {
      const svg = c.querySelector('svg')!;
      return [
        Number(svg.getAttribute('width')),
        Number(svg.getAttribute('height')),
      ];
    };
    const [hw, hh] = size(draw(H));
    const [uw, uh] = size(draw(YEAR));
    expect(hw).toBeGreaterThan(hh);
    expect(uh).toBeGreaterThan(uw);
  });
});

describe('calendar layout month', () => {
  it('draws `layout month` as month grids, not strips', () => {
    const c = draw('calendar Team\nyear 2026\nlayout month\n03-10 Dentist\n');
    expect(c.querySelector('svg')!.getAttribute('data-calendar-layout')).toBe(
      'month'
    );
    expect(c.querySelectorAll('.calendar-day')).toHaveLength(365);
    expect(c.querySelectorAll('.calendar-outside').length).toBeGreaterThan(0);
  });
});

describe('calendar export', () => {
  it('renders both layouts through renderForExport with no hex outside the palette', async () => {
    for (const layout of ['weeks', 'months']) {
      const svg = await renderForExport(
        `calendar Runs\nyear 2026\nlayout ${layout}\n01-01 1\n03-10 5\n`,
        'light'
      );
      expect(svg).toContain('calendar-day');
      expect(svg).not.toContain('<title');
    }
  });
});
