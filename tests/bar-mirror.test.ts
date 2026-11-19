// Bar `mirror` — butterfly / population pyramid (#1878).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';

const PYRAMID = `bar Population by age, 2025
mirror
  Women purple
  Men   teal
85+   2.1 1.3
40–44 6 3
0–4   2.7 2.8`;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string) {
  host.innerHTML = await renderDataChartD3(src, 'light');
  const svg = host.querySelector('svg')!;
  const rects = [
    ...svg.querySelectorAll<SVGRectElement>('rect[data-line-number]'),
  ];
  return { svg, rects };
}
const n = (el: Element, a: string) => parseFloat(el.getAttribute(a)!);
const errors = (src: string) =>
  parseChart(src).diagnostics.filter((d) => d.severity === 'error');
const bar = (rects: SVGRectElement[], name: string) =>
  rects.find((r) => r.getAttribute('data-name') === name)!;

describe('mirror parsing (#1878)', () => {
  it('a `mirror` block is a bar layout of two named series', () => {
    const p = parseChart(PYRAMID);
    expect(p.barLayout).toBe('mirror');
    expect(p.seriesNames).toEqual(['Women', 'Men']);
    expect(p.orientation).toBe('horizontal');
    expect(p.data.map((d) => d.label)).toEqual(['85+', '40–44', '0–4']);
    expect(p.diagnostics).toEqual([]);
  });

  it('any series count but two is an error', () => {
    for (const block of ['mirror\n  Women', 'mirror\n  A\n  B\n  C']) {
      const errs = errors(`bar T\n${block}\nX 1 2 3`);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.message).toMatch(/exactly two series/);
      expect(errs[0]!.line).toBe(2);
    }
  });

  it('a negative value is an error on its row', () => {
    const errs = errors(`bar T\nmirror\n  A\n  B\nX 1 2\nY -3 2`);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.line).toBe(6);
    expect(errs[0]!.message).toMatch(/cannot be negative — write 3, not -3/);
  });

  it('keeps source order: `sort` is ignored with a warning', () => {
    const p = parseChart(`bar T\nsort\nmirror\n  A\n  B\nX 1 2\nY 5 2`);
    expect(p.sort).toBeUndefined();
    expect(p.data.map((d) => d.label)).toEqual(['X', 'Y']);
    expect(p.diagnostics.map((d) => d.severity)).toEqual(['warning']);
  });

  it('on a non-bar chart `mirror` is a warning and no layout', () => {
    const p = parseChart(`line T\nmirror\n  A\n  B\nX 1 2\nY 5 2`);
    expect(p.barLayout).toBeUndefined();
    expect(p.diagnostics.some((d) => /bar layout header/.test(d.message))).toBe(
      true
    );
  });
});

describe('mirror rendering (#1878)', () => {
  it('draws the first series left and the second right of one gutter', async () => {
    const { svg, rects } = await draw(PYRAMID);
    expect(rects).toHaveLength(6);
    const names = [...svg.querySelectorAll('.dgmo-mirror-name')];
    expect(names.map((t) => t.textContent)).toEqual(['85+', '40–44', '0–4']);
    const centre = n(names[0]!, 'x');
    for (const row of ['85+', '40–44', '0–4']) {
      const w = bar(rects, `${row} · Women`);
      const m = bar(rects, `${row} · Men`);
      // Women end at the gutter's left edge, Men start at its right edge.
      expect(n(w, 'x') + n(w, 'width')).toBeLessThan(centre);
      expect(n(m, 'x')).toBeGreaterThan(centre);
      // The gutter is the same for every row.
      expect(n(w, 'x') + n(w, 'width')).toBeCloseTo(
        n(bar(rects, '85+ · Women'), 'x') +
          n(bar(rects, '85+ · Women'), 'width')
      );
      expect(n(m, 'x')).toBeCloseTo(n(bar(rects, '85+ · Men'), 'x'));
    }
  });

  it('one shared scale: equal values draw equal lengths on either side', async () => {
    const { rects } = await draw(`bar T\nmirror\n  A\n  B\nX 4 4\nY 2 8`);
    expect(n(bar(rects, 'X · A'), 'width')).toBeCloseTo(
      n(bar(rects, 'X · B'), 'width')
    );
    expect(n(bar(rects, 'Y · B'), 'width')).toBeCloseTo(
      4 * n(bar(rects, 'Y · A'), 'width')
    );
  });

  it('rows run top to bottom in source order', async () => {
    const { rects } = await draw(PYRAMID);
    const ys = ['85+', '40–44', '0–4'].map((r) =>
      n(bar(rects, `${r} · Women`), 'y')
    );
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('ticks read positive on both halves', async () => {
    const { svg } = await draw(PYRAMID);
    const ticks = [...svg.querySelectorAll('.dgmo-mirror-tick')].map(
      (t) => t.textContent!
    );
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.some((t) => t.includes('-') || t.includes('−'))).toBe(false);
    // The same ticks on each side.
    const half = ticks.length / 2;
    expect(ticks.slice(0, half)).toEqual(ticks.slice(half));
  });

  it('value labels sit off each bar’s free end', async () => {
    const { svg, rects } = await draw(PYRAMID);
    const w = bar(rects, '40–44 · Women');
    const m = bar(rects, '40–44 · Men');
    // Tabular figures centre each label on its x (setTabularText), so the
    // test reads where the label's centre lands, not its anchor.
    const texts = [...svg.querySelectorAll('.dgmo-mirror-value')];
    const six = texts.find((t) => t.textContent === '6')!;
    const three = texts.find((t) => t.textContent === '3')!;
    expect(n(six, 'x')).toBeLessThan(n(w, 'x'));
    expect(n(three, 'x')).toBeGreaterThan(n(m, 'x') + n(m, 'width'));
  });

  it('y titles the value scale under the ticks; x heads the gutter (decision #60)', async () => {
    const { svg } = await draw(
      `bar T\nx-axis Age\ny-axis People\nmirror\n  A\n  B\nX 4 4\nY 2 8`
    );
    const head = svg.querySelector('.dgmo-mirror-category-title')!;
    expect(head.textContent).toBe('Age');
    const name = svg.querySelector('.dgmo-mirror-name')!;
    expect(n(head, 'y')).toBeLessThan(n(name, 'y'));
    const tick = svg.querySelector('.dgmo-mirror-tick')!;
    const title = [...svg.querySelectorAll('text')].find(
      (t) => t.textContent === 'People'
    )!;
    expect(n(title, 'y')).toBeGreaterThan(n(tick, 'y'));
  });

  it('y-axis log is a warning: both sides grow from 0', () => {
    const p = parseChart(`bar T\ny-axis 1..100 log\nmirror\n  A\n  B\nX 4 4`);
    expect(p.axes?.y?.scale).toBeUndefined();
    expect(
      p.diagnostics.some((d) => /linear; ignoring `log`/.test(d.message))
    ).toBe(true);
  });

  it('the legend names both series', async () => {
    const { svg } = await draw(PYRAMID);
    const text = svg.textContent!;
    expect(text).toContain('Women');
    expect(text).toContain('Men');
  });
});
