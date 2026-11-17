// Marimekko: `bar` + `widths` (#1872). Sources are the five examples on the
// owner-confirmed syntax page (ecosystem docs mockup 2026-11-12).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';

const SHARES = `bar Cloud market by region, 2025
subtitle Column width = region's share of the $250B market
x-label Share of the global market
y-label Share of region
widths

stack
  AWS   orange
  Azure blue
  GCP   green
  Other gray

// region  width  AWS Azure GCP Other
US     42%  38 30 18 14
EU     28%  30 36 16 18
APAC   22%  28 24 20 28
LATAM   8%  34 26 14 26`;

const SIZES = `bar Cloud market by region, 2025
subtitle Market size and provider share
format currency USD
unit B
widths

stack
  AWS   orange
  Azure blue
  GCP   green
  Other gray

US     105  38 30 18 14
EU      70  30 36 16 18
APAC    55  28 24 20 28
LATAM   20  34 26 14 26`;

const COUNTS = `bar Where people want to work, by age
subtitle 1,587 survey answers; column width = answers in that age group
y-label Share of age group
widths

stack
  Fully remote teal
  Hybrid       blue
  Office       gray

// group  answers  remote hybrid office
18–29     412      140    190    82
30–44     655      170    350    135
45–59     380       72    190    118
60+       140       18     50    72`;

const SMALL = `bar Win rate by segment
subtitle Column width = segment's share of the pipeline
widths
fill-outline

stack
  Won  green
  Lost red

Enterprise  30%  42 58
Mid-market  45%  31 69
SMB         25%  18 82`;

const STORY = `bar Azure leads only in Europe
subtitle Share of each region's cloud market, 2025
widths
fill-solid
highlight Azure

stack
  AWS   orange
  Azure blue
  GCP   green
  Other gray

US     42%  38 30 18 14
EU     28%  30 36 16 18
APAC   22%  28 24 20 28
LATAM   8%  34 26 14 26`;

const msgs = (src: string, sev: 'error' | 'warning') =>
  parseChart(src)
    .diagnostics.filter((d) => d.severity === sev)
    .map((d) => d.message);

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());
async function draw(src: string) {
  host.innerHTML = await renderDataChartD3(src, 'light');
  return host.querySelector('svg')!;
}
const n = (el: Element, a: string) => parseFloat(el.getAttribute(a)!);

describe('marimekko parsing', () => {
  it.each([
    ['shares', SHARES, 'share'],
    ['sizes', SIZES, 'size'],
    ['raw counts', COUNTS, 'size'],
    ['two series', SMALL, 'share'],
    ['highlight', STORY, 'share'],
  ])('%s parses clean', (_, src, mode) => {
    const p = parseChart(src);
    expect(p.diagnostics).toEqual([]);
    expect(p.widths).toBe(mode);
    expect(p.stackPercent).toBe(true);
  });

  it('the first number is the width, the rest are segments', () => {
    const d = parseChart(SHARES).data[0]!;
    expect(d.label).toBe('US');
    expect(d.width).toBe(42);
    expect([d.value, ...d.extraValues!]).toEqual([38, 30, 18, 14]);
  });

  it('a label may end in a number', () => {
    const d = parseChart(SIZES.replace('US     105', 'Region 5 105')).data[0]!;
    expect(d.label).toBe('Region 5');
    expect(d.width).toBe(105);
  });
});

describe('marimekko diagnostics', () => {
  it('widths with no stack block', () => {
    const src = `bar X\nwidths\nA 50% 3\nB 50% 4`;
    expect(msgs(src, 'error')).toEqual([
      '`widths` needs a `stack` block — a Marimekko stacks every column to 100%.',
    ]);
  });
  it('widths with group', () => {
    expect(msgs(SMALL.replace('\nstack\n', '\ngroup\n'), 'error')).toEqual([
      '`widths` needs `stack`, not `group`.',
    ]);
  });
  it('shares that miss 100', () => {
    expect(msgs(SHARES.replace('LATAM   8%', 'LATAM  10%'), 'error')).toEqual([
      'The widths add up to 102%. Shares must add up to 100%, or drop the `%` to use sizes.',
    ]);
  });
  it('a mix of shares and sizes', () => {
    expect(msgs(SHARES.replace('EU     28%', 'EU     70'), 'error')).toEqual([
      'Mix of shares and sizes. Write every width as a share (`42%`) or every one as a size (`105`).',
    ]);
  });
  it('one number short warns about the width', () => {
    expect(
      msgs(
        SHARES.replace('US     42%  38 30 18 14', 'US     42%  38 30 18'),
        'warning'
      )
    ).toEqual([
      'With `widths`, the first number is the width, so this row has 3 segments for 4 series.',
    ]);
  });
  it('horizontal is refused', () => {
    expect(
      msgs(SMALL.replace('widths', 'widths\norientation-horizontal'), 'error')
    ).toEqual([
      '`widths` draws columns only. Remove `orientation-horizontal`.',
    ]);
  });
  it('a zero or negative width', () => {
    expect(msgs(SIZES.replace('LATAM   20', 'LATAM   0'), 'error')).toEqual([
      'A column width must be more than 0.',
    ]);
  });
  it('widths on a line chart warns and is ignored', () => {
    const p = parseChart(`line X\nwidths\nA 1\nB 2`);
    expect(p.widths).toBeUndefined();
    expect(p.diagnostics.map((d) => d.severity)).toEqual(['warning']);
  });
});

describe('marimekko rendering', () => {
  it('columns touch and are as wide as their share', async () => {
    const svg = await draw(SHARES);
    const firstOf = (label: string) =>
      [...svg.querySelectorAll('rect.dgmo-datum')].find((r) =>
        r.getAttribute('data-name')!.startsWith(label + ' ·')
      )!;
    const us = firstOf('US');
    const eu = firstOf('EU');
    const latam = firstOf('LATAM');
    expect(n(us, 'x') + n(us, 'width')).toBeCloseTo(n(eu, 'x'), 3);
    expect(n(us, 'width') / n(latam, 'width')).toBeCloseTo(42 / 8, 3);
  });

  it('each column fills the plot height', async () => {
    const svg = await draw(SMALL);
    const rects = [...svg.querySelectorAll('rect.dgmo-datum')].filter((r) =>
      r.getAttribute('data-name')!.startsWith('SMB ·')
    );
    const h = rects.reduce((a, r) => a + n(r, 'height'), 0);
    const tall = [...svg.querySelectorAll('rect.dgmo-datum')]
      .filter((r) => r.getAttribute('data-name')!.startsWith('Enterprise ·'))
      .reduce((a, r) => a + n(r, 'height'), 0);
    expect(h).toBeCloseTo(tall, 3);
  });

  it('width above, name below, cumulative ticks on x', async () => {
    const svg = await draw(SHARES);
    const t = (c: string) =>
      [...svg.querySelectorAll(`.${c}`)].map((e) => e.textContent);
    expect(t('dgmo-mekko-width')).toEqual(['42%', '28%', '22%', '8%']);
    expect(t('dgmo-mekko-name')).toEqual(['US', 'EU', 'APAC', 'LATAM']);
    expect(t('dgmo-mekko-tick')).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });

  it('hover gives share of column, share of whole, and value', async () => {
    const svg = await draw(COUNTS);
    const hybrid = [...svg.querySelectorAll('rect.dgmo-datum')].find(
      (r) => r.getAttribute('data-name') === '30–44 · Hybrid'
    )!;
    expect(hybrid.getAttribute('data-value')).toBe(
      '53% of column · 22% of whole · 350'
    );
  });
});

describe('gallery fixture', () => {
  it('parses with no diagnostics', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('gallery/fixtures/bar-marimekko.dgmo', 'utf8');
    expect(parseChart(src).diagnostics).toEqual([]);
  });
});
