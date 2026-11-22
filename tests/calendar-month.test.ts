// @vitest-environment jsdom
// `layout month` — the wall calendar (§41.3, #1876).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveColor } from '../src/colors';
import { renderForExport } from '../src/d3';
import { parseCalendar } from '../src/calendar/parser';
import { renderCalendar } from '../src/calendar/renderer';
import { laneEvents, monthGeometry, tierFor } from '../src/calendar/month';
import { MARK_TINT, noteHtml } from '../src/calendar/month-render';
import { getPalette } from '../src/palettes';
import { mix } from '../src/palettes/color-utils';
import { setPinnedNow } from '../src/utils/now';

const palette = getPalette('nord').light;

function draw(src: string, exportMode = false): HTMLElement {
  const parsed = parseCalendar(src);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  document.body.appendChild(container);
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    width: 0,
  } as DOMRect);
  renderCalendar(container, parsed, palette, false, { exportMode });
  return container;
}

const svgOf = (c: HTMLElement) => c.querySelector('svg')!;
const day = (c: HTMLElement, date: string) =>
  c.querySelector<SVGRectElement>(`.calendar-day[data-date="${date}"]`)!;
const num = (el: Element, a: string) => Number(el.getAttribute(a));
const pieces = (c: HTMLElement, name?: string) =>
  [...c.querySelectorAll<SVGGElement>('.calendar-event')].filter(
    (p) =>
      name === undefined ||
      p
        .querySelector('.calendar-event-name')
        ?.textContent?.replace(/^‹ /, '') === name
  );
const tip = (c: HTMLElement) =>
  c.querySelector<HTMLElement>('[data-d3-tooltip]')!;

const KINDS = `tag Kind as k
  Work blue
  Home green
  Travel orange
`;

const JAN = readFileSync('gallery/fixtures/calendar-month.dgmo', 'utf8');
const QUARTER = readFileSync('gallery/fixtures/calendar-quarter.dgmo', 'utf8');

/** A calendar of `n` months from January 2027, one event in each. */
function months(n: number, extra = ''): string {
  const lines = [`calendar Plan\nlayout month\n${extra}${KINDS}`];
  for (let m = 1; m <= n; m++) {
    const mm = String(m).padStart(2, '0');
    lines.push(`2027-${mm}\n  4 Review k: Work\n  4 Lunch k: Home`);
  }
  return lines.join('\n');
}

afterEach(() => {
  setPinnedNow(null);
  document.body.innerHTML = '';
});

describe('calendar layout month — the grid (#1876)', () => {
  it('is the default when any entry is an event', () => {
    expect(svgOf(draw(JAN)).getAttribute('data-calendar-layout')).toBe('month');
  });

  it('draws one tile per day, seven columns, neighbouring days faint', () => {
    const c = draw(JAN);
    expect(c.querySelectorAll('.calendar-day')).toHaveLength(31);
    // January 2027 starts on a Friday: five days before, six after.
    expect(c.querySelectorAll('.calendar-outside')).toHaveLength(11);
    const fri1 = day(c, '2027-01-01');
    const sat2 = day(c, '2027-01-02');
    const sun3 = day(c, '2027-01-03');
    const fri8 = day(c, '2027-01-08');
    expect(num(sat2, 'x')).toBeGreaterThan(num(fri1, 'x'));
    expect(num(sun3, 'x')).toBeLessThan(num(fri1, 'x'));
    expect(num(sun3, 'y')).toBeGreaterThan(num(fri1, 'y'));
    expect(num(fri8, 'x')).toBe(num(fri1, 'x'));
    expect(num(fri8, 'y') - num(fri1, 'y')).toBeCloseTo(
      num(fri1, 'height') + tierFor(1).style.gap,
      6
    );
  });

  it('`week-start monday` puts Monday in the first column', () => {
    const c = draw(JAN.replace('tag Kind', 'week-start monday\ntag Kind'));
    const mon4 = day(c, '2027-01-04');
    const xs = [...c.querySelectorAll('.calendar-day')].map((r) => num(r, 'x'));
    expect(num(mon4, 'x')).toBe(Math.min(...xs));
    const heads = [...c.querySelectorAll('.calendar-weekday')].map(
      (t) => t.textContent
    );
    expect(heads.slice(0, 2)).toEqual(['MON', 'TUE']);
  });

  it('names each month above its grid, and the legend sits under the title', () => {
    const c = draw(JAN);
    const title = c.querySelector('.chart-title')!;
    const legend = c.querySelector('.calendar-legend')!;
    const month = c.querySelector('.calendar-month')!;
    expect(month.textContent).toBe('January 2027');
    const legendY = Number(
      /translate\([^,]+,([^)]+)\)/.exec(legend.getAttribute('transform')!)![1]
    );
    expect(legendY).toBeGreaterThan(num(title, 'y'));
    expect(num(month, 'y')).toBeGreaterThan(legendY);
    expect(num(day(c, '2027-01-01'), 'y')).toBeGreaterThan(num(month, 'y'));
  });

  it('shades weekends a little darker', () => {
    const c = draw(JAN);
    const sat = day(c, '2027-01-02');
    const mon = day(c, '2027-01-04');
    expect(sat.hasAttribute('data-weekend')).toBe(true);
    expect(sat.getAttribute('fill')).not.toBe(mon.getAttribute('fill'));
  });
});

describe('calendar layout month — size tiers (#1876)', () => {
  const tier = (src: string) =>
    svgOf(draw(src)).getAttribute('data-calendar-tier');

  it('follows the months drawn: 1 full, 2 compact, 3–6 bars, 7–12 tiles', () => {
    expect(tier(months(1))).toBe('full');
    expect(tier(months(2))).toBe('compact');
    expect(tier(months(3))).toBe('bars');
    expect(tier(months(6))).toBe('bars');
    expect(tier(months(7))).toBe('tiles');
    expect(tier(months(12))).toBe('tiles');
  });

  it('one month: named bars', () => {
    const c = draw(months(1));
    expect(
      pieces(c).map((p) => p.querySelector('.calendar-event-name')?.textContent)
    ).toEqual(['Review', 'Lunch']);
  });

  it('two months: smaller named bars', () => {
    const one = draw(months(1));
    const two = draw(months(2));
    const font = (c: HTMLElement) =>
      num(c.querySelector('.calendar-event-name')!, 'font-size');
    expect(font(two)).toBeLessThan(font(one));
    expect(pieces(two)).toHaveLength(4);
  });

  it('three to six months: colour bars with no names', () => {
    const c = draw(months(3));
    expect(pieces(c)).toHaveLength(6);
    expect(c.querySelectorAll('.calendar-event-name')).toHaveLength(0);
  });

  it('seven to twelve: the tile takes its first event’s colour; a dot marks a second', () => {
    const c = draw(months(12));
    expect(pieces(c)).toHaveLength(0);
    const jan4 = day(c, '2027-01-04');
    const blue = resolveColor('blue', palette)!;
    expect(jan4.getAttribute('fill')).toBe(mix(blue, palette.bg, 25));
    expect(jan4.getAttribute('stroke')).toBe(blue);
    const dots = [...c.querySelectorAll('.calendar-event-dot')].filter(
      (d) => d.getAttribute('data-date') === '2027-01-04'
    );
    expect(dots).toHaveLength(1);
    expect(dots[0]!.getAttribute('fill')).toBe(resolveColor('green', palette));
  });

  it('a bars-tier day past three lanes gets a corner dot', () => {
    const c = draw(QUARTER);
    expect(svgOf(c).getAttribute('data-calendar-tier')).toBe('bars');
    const dots = [...c.querySelectorAll('.calendar-event-dot')].map((d) =>
      d.getAttribute('data-date')
    );
    expect(dots).toEqual(['2027-03-10']);
  });
});

describe('calendar layout month — months-per-row (#1876)', () => {
  it('sets the columns and keys the tier on the tile width', () => {
    const c = draw(months(12, 'months-per-row 1\n'));
    expect(svgOf(c).getAttribute('data-calendar-tier')).toBe('full');
    const janX = num(day(c, '2027-01-01'), 'x');
    const febX = num(day(c, '2027-02-01'), 'x');
    const feb1Col = (new Date(Date.UTC(2027, 1, 1)).getUTCDay() + 7) % 7;
    const jan1Col = (new Date(Date.UTC(2027, 0, 1)).getUTCDay() + 7) % 7;
    // Stacked: February's grid starts at January's left edge.
    const pitch = num(day(c, '2027-01-02'), 'x') - janX;
    expect(febX - feb1Col * pitch).toBeCloseTo(janX - jan1Col * pitch, 6);
    expect(num(day(c, '2027-02-01'), 'y')).toBeGreaterThan(
      num(day(c, '2027-01-31'), 'y')
    );
  });

  it('two per row: named bars again for a year', () => {
    const c = draw(months(4, 'months-per-row 2\n'));
    expect(svgOf(c).getAttribute('data-calendar-tier')).toBe('compact');
    const months2 = [...c.querySelectorAll('.calendar-month')];
    expect(num(months2[1]!, 'x')).toBeGreaterThan(num(months2[0]!, 'x'));
    expect(num(months2[2]!, 'x')).toBe(num(months2[0]!, 'x'));
    expect(num(months2[2]!, 'y')).toBeGreaterThan(num(months2[0]!, 'y'));
  });

  it('out of range warns and falls back to the table', () => {
    const p = parseCalendar(months(3, 'months-per-row 9\n'));
    expect(p.monthsPerRow).toBeUndefined();
    expect(p.diagnostics.map((d) => d.code)).toContain(
      'W_CALENDAR_MONTHS_PER_ROW'
    );
    expect(
      svgOf(draw(months(3, 'months-per-row 9\n'))).getAttribute(
        'data-calendar-tier'
      )
    ).toBe('bars');
  });
});

describe('calendar layout month — bars, wrapping and lanes (#1876)', () => {
  it('a multi-day bar runs across tiles and gaps', () => {
    const c = draw(JAN);
    const [offsite] = pieces(c, 'Offsite, Denver');
    const mon18 = day(c, '2027-01-18');
    const wed20 = day(c, '2027-01-20');
    const box = offsite!
      .querySelector('.calendar-event-bar')!
      .getAttribute('d')!;
    const xs = [...box.matchAll(/[MH](-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeGreaterThan(num(mon18, 'x'));
    expect(Math.max(...xs)).toBeGreaterThan(num(wed20, 'x'));
    expect(Math.max(...xs)).toBeLessThan(num(wed20, 'x') + num(wed20, 'width'));
  });

  it('wraps at the week’s end: square ends where it continues, ‹ on the continuing piece', () => {
    const c = draw(JAN);
    const ski = pieces(c, 'Ski trip');
    expect(ski).toHaveLength(2);
    const [a, b] = ski as [SVGGElement, SVGGElement];
    expect(a.getAttribute('data-from')).toBe('2027-01-08');
    expect(a.getAttribute('data-to')).toBe('2027-01-09');
    expect(a.hasAttribute('data-continues-right')).toBe(true);
    expect(a.hasAttribute('data-continues-left')).toBe(false);
    expect(b.getAttribute('data-from')).toBe('2027-01-10');
    expect(b.hasAttribute('data-continues-left')).toBe(true);
    expect(b.querySelector('.calendar-event-name')!.textContent).toBe(
      '‹ Ski trip'
    );
    // The continuing ends are flush with their tile edges, with no arc.
    const sat = day(c, '2027-01-09');
    const sun = day(c, '2027-01-10');
    const dA = a.querySelector('path')!.getAttribute('d')!;
    const dB = b.querySelector('path')!.getAttribute('d')!;
    expect(dA).toContain(`H${num(sat, 'x') + num(sat, 'width')}`);
    expect(dA).toContain(`V`);
    expect((dA.match(/A/g) ?? []).length).toBe(2);
    expect(dB.startsWith(`M${num(sun, 'x')},`)).toBe(true);
    expect((dB.match(/A/g) ?? []).length).toBe(2);
  });

  it('a range across a month header draws its part in each month', () => {
    const c = draw(QUARTER);
    const easter = [...c.querySelectorAll('.calendar-event')].filter(
      (p) =>
        p.getAttribute('data-from') === '2027-03-29' ||
        p.getAttribute('data-from') === '2027-04-01'
    );
    expect(easter.map((p) => p.getAttribute('data-month'))).toEqual([
      '2027-03',
      '2027-04',
    ]);
    expect(easter[0]!.hasAttribute('data-continues-right')).toBe(true);
    expect(easter[1]!.hasAttribute('data-continues-left')).toBe(true);
  });

  it('stacks same-day events in lanes and shows "+N more" past three', () => {
    const c = draw(JAN);
    const on14 = pieces(c).filter(
      (p) => p.getAttribute('data-from') === '2027-01-14'
    );
    expect(on14.map((p) => p.getAttribute('data-lane'))).toEqual([
      '0',
      '1',
      '2',
    ]);
    const more = [...c.querySelectorAll('.calendar-more')];
    expect(
      more.map((m) => [m.getAttribute('data-date'), m.textContent])
    ).toEqual([['2027-01-14', '+1 more']]);
  });

  it('two months show "+N"', () => {
    const src = `calendar\n${KINDS}\n2027-01\n${['A', 'B', 'C', 'D', 'E']
      .map((n) => `  6 ${n}`)
      .join('\n')}\n2027-02\n  1 F\n`;
    const c = draw(src);
    expect(svgOf(c).getAttribute('data-calendar-tier')).toBe('compact');
    expect(c.querySelector('.calendar-more')!.textContent).toBe('+2');
  });

  it('a long bar keeps its lane', () => {
    const src = `calendar\n2027-01\n  4 Short\n  4 -> 14 Long\n  6 Other\n  11 -> 12 Late\n`;
    const parsed = parseCalendar(src);
    const geo = monthGeometry(parsed, 0, 0, true);
    const { pieces: ps } = laneEvents(parsed.events, geo.blocks, geo.column, 3);
    const long = parsed.events.findIndex((e) => e.name === 'Long');
    const lanesOfLong = new Set(
      ps.filter((p) => p.event === long).map((p) => p.lane)
    );
    expect(lanesOfLong).toEqual(new Set([0]));
    expect(ps.filter((p) => p.event === long)).toHaveLength(2);
  });

  it('a bar with a note shows the three-line mark, on its first piece only', () => {
    const c = draw(JAN);
    const mark = (p: Element) => p.querySelectorAll('.calendar-note-mark rect');
    expect(mark(pieces(c, 'Kickoff')[0]!)).toHaveLength(3);
    expect(mark(pieces(c, 'Dentist')[0]!)).toHaveLength(0);
    const [a, b] = pieces(c, 'Ski trip');
    expect(mark(a!)).toHaveLength(3);
    expect(mark(b!)).toHaveLength(0);
    const quiet = draw(JAN.replace('tag Kind', 'no-notes\ntag Kind'));
    expect(quiet.querySelectorAll('.calendar-note-mark')).toHaveLength(0);
  });

  it('a long name is cut with an ellipsis to fit its bar', () => {
    const c = draw(JAN);
    expect(
      pieces(c).some((p) =>
        p.querySelector('.calendar-event-name')!.textContent!.endsWith('…')
      )
    ).toBe(true);
  });
});

describe('calendar layout month — colour (#1876, §1.9)', () => {
  const blue = () => resolveColor('blue', palette)!;
  const bar = (c: HTMLElement) =>
    pieces(c, 'Kickoff')[0]!.querySelector('.calendar-event-bar')!;

  it('fill-tint (default): a 25% tint with the colour on the outline', () => {
    const b = bar(draw(JAN));
    expect(b.getAttribute('fill')).toBe(mix(blue(), palette.bg, 25));
    expect(b.getAttribute('stroke')).toBe(blue());
  });

  it('fill-solid: the full colour, with contrasting ink', () => {
    const c = draw(JAN.replace('tag Kind', 'fill-solid\ntag Kind'));
    expect(bar(c).getAttribute('fill')).toBe(blue());
  });

  it('fill-outline: no fill, the colour on the outline', () => {
    const c = draw(JAN.replace('tag Kind', 'fill-outline\ntag Kind'));
    expect(bar(c).getAttribute('fill')).toBe(palette.bg);
    expect(bar(c).getAttribute('stroke')).toBe(blue());
  });

  it('an events-only chart draws its bars in the primary colour', () => {
    const c = draw('calendar\n2027-01\n  5 Kickoff\n');
    expect(bar(c).getAttribute('stroke')).toBe(palette.primary);
    expect(c.querySelector('.calendar-legend')).toBeNull();
  });

  it('a tag mark tints its tile; the event bar draws over it', () => {
    const c = draw(
      `calendar\n${KINDS}\n2027-01\n  5 k: Home\n  5 Kickoff k: Work\n`
    );
    const green = resolveColor('green', palette)!;
    expect(day(c, '2027-01-05').getAttribute('fill')).toBe(
      mix(green, palette.bg, MARK_TINT)
    );
    expect(day(c, '2027-01-05').getAttribute('data-tag')).toBe('Home');
    expect(pieces(c, 'Kickoff')).toHaveLength(1);
  });

  it('a number mark tints its tile by shade, matching the legend step', () => {
    const c = draw(
      `calendar\nheat Pages as p\n  max 4\n\n2027-01\n  5 p: 4\n  6 p: 1\n  9 Party\n`
    );
    const top = day(c, '2027-01-05');
    expect(top.getAttribute('data-level')).toBe('4');
    const step = c.querySelector('.calendar-legend-step[data-level="4"]')!;
    expect(top.getAttribute('fill')).toBe(step.getAttribute('fill'));
    expect(day(c, '2027-01-07').getAttribute('fill')).not.toBe(
      top.getAttribute('fill')
    );
  });
});

describe('calendar layout month — hover and keyboard (#1876)', () => {
  it('labels each day for a screen reader', () => {
    const c = draw(JAN);
    expect(day(c, '2027-01-14').getAttribute('aria-label')).toBe(
      'Thursday, January 14, 2027: 4 events — Sprint review, Parents’ evening, Book club, Lunch with Sam'.replace(
        '’',
        "'"
      )
    );
    expect(day(c, '2027-01-02').getAttribute('aria-label')).toBe(
      'Saturday, January 2, 2027: no events'
    );
  });

  it('the day card lists every event, including those behind "+N more"', () => {
    const c = draw(JAN);
    day(c, '2027-01-14').dispatchEvent(new MouseEvent('mouseenter'));
    const t = tip(c).textContent!;
    for (const n of [
      'Sprint review',
      "Parents' evening",
      'Book club',
      'Lunch with Sam',
    ])
      expect(t).toContain(n);
    expect(t).toContain('Ask about the reading list');
  });

  it('the card stays open while the pointer is on it', () => {
    vi.useFakeTimers();
    try {
      const c = draw(JAN);
      day(c, '2027-01-08').dispatchEvent(new MouseEvent('mouseenter'));
      const t = tip(c);
      expect(t.style.pointerEvents).toBe('auto');
      expect(t.querySelector('a')!.getAttribute('href')).toBe(
        'https://example.com/ski'
      );
      day(c, '2027-01-08').dispatchEvent(new MouseEvent('mouseleave'));
      t.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(1000);
      expect(t.style.display).toBe('block');
      t.dispatchEvent(new MouseEvent('mouseleave'));
      expect(t.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hovering an event lights all its pieces, dims the rest, and lights its value in the legend', () => {
    const c = draw(JAN);
    const [a, b] = pieces(c, 'Ski trip');
    a!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(a!.style.opacity).toBe('');
    expect(b!.style.opacity).toBe('');
    expect(pieces(c, 'Kickoff')[0]!.style.opacity).not.toBe('');
    const entries = [
      ...c.querySelectorAll<SVGGElement>(
        '.calendar-legend [data-legend-entry]'
      ),
    ];
    const travel = entries.find(
      (e) => e.getAttribute('data-series-name') === 'Travel'
    )!;
    const work = entries.find(
      (e) => e.getAttribute('data-series-name') === 'Work'
    )!;
    expect(travel.hasAttribute('data-calendar-lit')).toBe(true);
    expect(work.style.opacity).not.toBe('');
    expect(tip(c).textContent).toContain('Jan 8 – Jan 11, 2027 · 4 days');
    a!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pieces(c, 'Kickoff')[0]!.style.opacity).toBe('');
  });

  it('hovering a legend value lights its events; a click pins it', () => {
    const c = draw(JAN);
    const travel = [
      ...c.querySelectorAll<SVGGElement>(
        '.calendar-legend [data-legend-entry]'
      ),
    ].find((e) => e.getAttribute('data-series-name') === 'Travel')!;
    travel.dispatchEvent(new MouseEvent('mouseenter'));
    expect(pieces(c, 'Ski trip')[0]!.style.opacity).toBe('');
    expect(pieces(c, 'Kickoff')[0]!.style.opacity).not.toBe('');
    travel.dispatchEvent(new MouseEvent('click'));
    travel.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pieces(c, 'Kickoff')[0]!.style.opacity).not.toBe('');
    travel.dispatchEvent(new MouseEvent('click'));
    travel.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pieces(c, 'Kickoff')[0]!.style.opacity).toBe('');
  });

  it('hovering a month name dims the other months and their events', () => {
    const c = draw(QUARTER);
    const april = [...c.querySelectorAll('.calendar-month')].find(
      (m) => m.getAttribute('data-month') === '2027-04'
    )!;
    april.dispatchEvent(new MouseEvent('mouseenter'));
    expect(day(c, '2027-03-10').style.opacity).not.toBe('');
    expect(day(c, '2027-04-10').style.opacity).toBe('');
    const ev = [...c.querySelectorAll<SVGGElement>('.calendar-event')];
    expect(
      ev.every(
        (p) =>
          (p.getAttribute('data-month') === '2027-04') ===
          (p.style.opacity === '')
      )
    ).toBe(true);
  });

  it('Tab walks the days in date order', () => {
    const c = draw(JAN);
    const focusable = [
      ...c.querySelectorAll('.calendar-days [tabindex="0"]'),
    ].map((r) => r.getAttribute('data-date'));
    expect(focusable).toHaveLength(31);
    expect(focusable[0]).toBe('2027-01-01');
    expect(focusable[30]).toBe('2027-01-31');
  });

  it('arrows move a day or a week, across months; Enter opens the card', () => {
    const c = draw(QUARTER);
    const key = (el: Element, k: string) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    const mar31 = day(c, '2027-03-31');
    mar31.focus();
    key(mar31, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-date')).toBe(
      '2027-04-01'
    );
    key(document.activeElement!, 'ArrowUp');
    expect(document.activeElement?.getAttribute('data-date')).toBe(
      '2027-03-25'
    );
    key(document.activeElement!, 'ArrowDown');
    key(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement?.getAttribute('data-date')).toBe(
      '2027-03-31'
    );
    hideAll(c);
    key(document.activeElement!, 'Enter');
    expect(tip(c).style.display).toBe('block');
    expect(tip(c).textContent).toContain('Easter break');
  });

  it('rings today in the app only', () => {
    setPinnedNow(Date.UTC(2027, 0, 12, 12));
    const live = draw(JAN);
    const ring = live.querySelector('.calendar-today')!;
    expect(ring).not.toBeNull();
    expect(ring.getAttribute('stroke')).toBe(palette.primary);
    expect(draw(JAN, true).querySelector('.calendar-today')).toBeNull();
  });
});

function hideAll(c: HTMLElement): void {
  tip(c).style.display = 'none';
}

describe('calendar layout month — notes and export', () => {
  it('renders a note line’s simple markdown in the card', () => {
    expect(noteHtml('Bring the **Q1 numbers**')).toBe(
      'Bring the <strong>Q1 numbers</strong>'
    );
    expect(noteHtml('- Ask *early*')).toBe('• Ask <em>early</em>');
    expect(noteHtml('[x](javascript:alert(1))')).toBe('x');
  });

  it('exports with no tooltip, no today ring and no <title>', async () => {
    setPinnedNow(Date.UTC(2027, 0, 12, 12));
    const svg = await renderForExport(JAN, 'light');
    expect(svg).toContain('calendar-event');
    expect(svg).not.toContain('calendar-today');
    expect(svg).not.toContain('<title');
    expect(svg).not.toContain('data-d3-tooltip');
  });
});
