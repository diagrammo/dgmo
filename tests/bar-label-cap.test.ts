import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderDataChartD3 } from '../src/charts-d3/index';

// Long category names must not size a bar chart (#1422): their region is
// capped, and a name that still does not fit ends in `…`, keeping its full text
// as a hover title. A short vertical axis whose names would rotate or be cut
// turns horizontal instead, and the names wrap in the column (#1828).

const FIXTURE = readFileSync(
  resolve(__dirname, '../stress/bar/long-labels--category-names.dgmo'),
  'utf8'
);
const NAMES = [
  'Password reset and account recovery requests',
  'Billing disputes, refunds and invoice corrections',
  'Integration errors from third-party webhooks',
  'Feature requests that are really bug reports',
];

function attr(svg: string, re: RegExp): number {
  return Number(svg.match(re)![1]);
}

/**
 * The text each `<text>` element draws, its hover title excluded. A name
 * wrapped into `<tspan>` lines reads back as its lines rejoined.
 */
function drawn(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) => {
    const body = m[1]!.replace(/<title>.*?<\/title>/g, '');
    const lines = [...body.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)];
    // A line broken after a hyphen rejoins without the space.
    return lines.length > 0
      ? lines
          .map((l) => l[1]!)
          .reduce((a, l) => (a.endsWith('-') ? a + l : `${a} ${l}`))
      : body;
  });
}

/** Text of every `<title>` hover in the SVG. */
function titles(svg: string): string[] {
  return [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]!);
}

describe('bar chart long category names (#1422)', () => {
  it('turns the stress fixture horizontal rather than rotate or cut its names', async () => {
    const svg = await renderDataChartD3(FIXTURE, 'light');
    expect(svg).not.toContain('rotate(-40)');
    expect(svg).not.toContain('…');
    for (const n of NAMES) expect(drawn(svg)).toContain(n);
    expect(drawn(svg)).toContain('Other');
    expect(titles(svg)).toEqual([]);
  });

  it('wraps a flipped name onto more than one line', async () => {
    const svg = await renderDataChartD3(FIXTURE, 'light', undefined, {
      width: 480,
      height: 320,
    });
    expect(svg).toContain('<tspan');
    expect(svg).not.toContain('…');
    for (const n of NAMES) expect(drawn(svg)).toContain(n);
  });

  it('moves the axis titles with the axes when it flips', async () => {
    const svg = await renderDataChartD3(
      FIXTURE.replace(/^bar .*$/m, '$&\nx-label Category\ny-label Tickets'),
      'light'
    );
    // The y title is the rotated one, on the left: it now names the categories.
    const left = svg.match(/<text[^>]*rotate\(-90\)[^>]*>([^<]*)</);
    expect(left?.[1]).toBe('Category');
    expect(drawn(svg)).toContain('Tickets');
  });

  it('caps the name column beside horizontal bars at 35% of the width', async () => {
    const svg = await renderDataChartD3(
      FIXTURE.replace(/^bar .*$/m, '$&\norientation-horizontal'),
      'light'
    );
    const W = attr(svg, /<svg[^>]*width="([\d.]+)"/);
    // The plot starts after the name column; the column holds at most 35% of
    // the width plus its fixed padding.
    const plotLeft = Math.min(
      ...[...svg.matchAll(/<line[^>]*x1="([\d.]+)"/g)].map((m) => Number(m[1]))
    );
    expect(plotLeft).toBeLessThanOrEqual(W * 0.35 + 30);
    // A name is drawn whole, or cut with its full text kept as a title.
    for (const n of NAMES) {
      expect(drawn(svg).includes(n) !== titles(svg).includes(n)).toBe(true);
    }
  });

  it('cuts a horizontal name longer than 35% of the width', async () => {
    const long = `${NAMES.join(' / ')} and more`;
    const svg = await renderDataChartD3(
      `bar Tickets\norientation-horizontal\n\n"${long}" 5\nOther 3`,
      'light'
    );
    const W = attr(svg, /<svg[^>]*width="([\d.]+)"/);
    expect(drawn(svg)).not.toContain(long);
    expect(titles(svg)).toEqual([long]);
    const plotLeft = Math.min(
      ...[...svg.matchAll(/<line[^>]*x1="([\d.]+)"/g)].map((m) => Number(m[1]))
    );
    expect(plotLeft).toBeLessThanOrEqual(W * 0.35 + 30);
  });

  it('keeps rotating a long axis rather than flip it', async () => {
    const body = Array.from(
      { length: 14 },
      (_, i) => `Service number ${i + 1} ${10 * (i + 1)}`
    ).join('\n');
    const svg = await renderDataChartD3(
      `bar Requests\n\n${body}`,
      'light',
      undefined,
      { width: 300, height: 400 }
    );
    expect(svg).toContain('rotate(-40)');
  });
});

describe('bar chart names that once rotated or were cut (#1828)', () => {
  function namesOf(src: string): string[] {
    return src
      .split('\n')
      .filter((l) => /\d$/.test(l) && !l.startsWith(' '))
      .map((l) => l.replace(/( -?[\d.]+)+$/, ''));
  }
  function fixture(name: string): string {
    return readFileSync(
      resolve(__dirname, `../stress/bar/long-labels--${name}.dgmo`),
      'utf8'
    );
  }

  for (const name of ['grouped-regions', 'ten-regions']) {
    it(`${name}: draws every name whole and flat at its natural size`, async () => {
      const src = fixture(name);
      const svg = await renderDataChartD3(src, 'light');
      expect(svg).not.toContain('rotate(-40)');
      expect(svg).not.toContain('…');
      for (const n of namesOf(src)) expect(drawn(svg)).toContain(n);
    });
  }

  it('grouped-regions: wraps rather than cuts in a 480×320 container', async () => {
    const src = fixture('grouped-regions');
    const svg = await renderDataChartD3(src, 'light', undefined, {
      width: 480,
      height: 320,
    });
    expect(svg).not.toContain('rotate(-40)');
    expect(svg).not.toContain('…');
    for (const n of namesOf(src)) expect(drawn(svg)).toContain(n);
  });

  it('ten-regions: a name cut in a 480×320 container keeps its full text', async () => {
    // Ten bands of ~20 px hold one line each, so a name wider than the
    // column is cut — flat, never rotated — and keeps its title.
    const src = fixture('ten-regions');
    const svg = await renderDataChartD3(src, 'light', undefined, {
      width: 480,
      height: 320,
    });
    expect(svg).not.toContain('rotate(-40)');
    for (const n of namesOf(src))
      expect(drawn(svg).includes(n) !== titles(svg).includes(n)).toBe(true);
  });

  it('drops the smaller of two value labels that would touch', async () => {
    const src = fixture('grouped-regions');
    const svg = await renderDataChartD3(src, 'light');
    // 140 and 160 sit on adjacent thin bars; the larger keeps its label.
    // Value labels start at the bar's end; the axis ticks are centred.
    const values = [
      ...svg.matchAll(/<text[^>]*text-anchor="(?:start|end)"[^>]*>([\d.]+)</g),
    ].map((m) => m[1]);
    expect(values).toContain('160');
    expect(values).not.toContain('140');
  });
});
