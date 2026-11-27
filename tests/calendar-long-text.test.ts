// @vitest-environment jsdom
// Long text wraps to the grid; it never widens the canvas (#2427).
import { describe, expect, it, vi } from 'vitest';
import { parseCalendar } from '../src/calendar/parser';
import { renderCalendar } from '../src/calendar/renderer';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

const words = (stem: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${stem}${i}`).join(' ');
// ~250 characters each, like the long-names pressure file.
const LONG_TITLE = words('Quarterly', 25).slice(0, 250);
const LONG_VALUE = words('Value', 40).slice(0, 250).trim();

const src = (title: string, value: string) => `calendar ${title}
year 2026
tag Mood
  ${value} green
  Ok blue

01-01 ${value}
01-02 ${value}
01-03 Ok
`;

function draw(text: string, exportMode = false): SVGSVGElement {
  const parsed = parseCalendar(text);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    width: 0,
  } as DOMRect);
  renderCalendar(container, parsed, palette, false, { exportMode });
  return container.querySelector('svg')!;
}

describe('calendar long text (#2427)', () => {
  for (const exportMode of [false, true]) {
    const mode = exportMode ? 'export' : 'preview';

    it(`a 250-character title and value keep the short-title width (${mode})`, () => {
      const short = draw(src('Mood 2026!', 'Great'), exportMode);
      const long = draw(src(LONG_TITLE, LONG_VALUE), exportMode);
      expect(LONG_TITLE.length).toBe(250);
      expect(long.getAttribute('width')).toBe(short.getAttribute('width'));
      expect(long.getAttribute('viewBox')!.split(' ')[2]).toBe(
        short.getAttribute('viewBox')!.split(' ')[2]
      );
    });

    it(`the title wraps to at most three lines, cut with … (${mode})`, () => {
      const svg = draw(src(LONG_TITLE, LONG_VALUE), exportMode);
      const title = svg.querySelector('text.chart-title')!;
      const lines = [...title.querySelectorAll('tspan')];
      expect(lines.length).toBe(3);
      expect(lines.at(-1)!.textContent!.endsWith('…')).toBe(true);
      expect(title.getAttribute('data-full-text')).toBe(LONG_TITLE);
      expect(svg.querySelector('title')).toBeNull();
    });

    it(`the summary wraps and keeps its full text (${mode})`, () => {
      const svg = draw(src(LONG_TITLE, LONG_VALUE), exportMode);
      const subs = [...svg.querySelectorAll('text.chart-subtitle')];
      expect(subs.length).toBeGreaterThan(1);
      expect(subs[0]!.getAttribute('data-full-text')).toContain(LONG_VALUE);
      // The summary sits under the wrapped title's last line.
      const titleY = Number(
        svg.querySelector('text.chart-title')!.getAttribute('y')
      );
      expect(Number(subs[0]!.getAttribute('y'))).toBeGreaterThan(titleY + 48);
    });

    it(`the long legend value is cut inside the canvas (${mode})`, () => {
      const svg = draw(src(LONG_TITLE, LONG_VALUE), exportMode);
      const cut = [...svg.querySelectorAll('.calendar-legend text')].find(
        (t) => t.getAttribute('data-full-text') === LONG_VALUE
      );
      expect(cut?.textContent?.endsWith('…')).toBe(true);
      const width = Number(svg.getAttribute('width'));
      for (const r of svg.querySelectorAll('.calendar-legend rect')) {
        const right =
          Number(r.getAttribute('x') ?? 0) + Number(r.getAttribute('width'));
        // The legend group sits DIAGRAM_PADDING (20) in from the left.
        expect(right + 20).toBeLessThanOrEqual(width);
      }
    });
  }

  it('a short title draws as one plain line with no full-text attribute', () => {
    const svg = draw(src('Mood 2026!', 'Great'));
    const title = svg.querySelector('text.chart-title')!;
    expect(title.querySelectorAll('tspan').length).toBe(0);
    expect(title.textContent).toBe('Mood 2026!');
    expect(title.hasAttribute('data-full-text')).toBe(false);
    expect(
      svg.querySelector('text.chart-subtitle')!.hasAttribute('data-full-text')
    ).toBe(false);
  });
});
