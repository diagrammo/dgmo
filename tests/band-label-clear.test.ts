// A band's label lies inside the band's visible part and clear of the data
// drawn over it — points, lines, point values, series names, marker labels
// (#2137).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { labelBox } from '../src/utils/place-labels';
import { pathSegments } from '../src/annotations/draw';
import type { LabelRect } from '../src/label-layout';

const FIXTURE = readFileSync(
  `${__dirname}/../gallery/fixtures/line-band-label-clear.dgmo`,
  'utf8'
);

const num = (n: Element, a: string) => Number(n.getAttribute(a) ?? 0);

function textBox(n: Element): LabelRect {
  return labelBox(
    n.textContent ?? '',
    {
      x: num(n, 'x'),
      y: num(n, 'y'),
      anchor: (n.getAttribute('text-anchor') ?? 'start') as
        | 'start'
        | 'middle'
        | 'end',
    },
    num(n, 'font-size') || 12
  );
}

const overlaps = (a: LabelRect, b: LabelRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** True when a straight run passes through `r`, sampled finely. */
const crosses = (sg: readonly number[], r: LabelRect) => {
  for (let k = 0; k <= 50; k++) {
    const x = sg[0]! + ((sg[2]! - sg[0]!) * k) / 50;
    const y = sg[1]! + ((sg[3]! - sg[1]!) * k) / 50;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
};

function check(svgText: string) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const labels = Array.from(
    doc.querySelectorAll('.dgmo-annotation-band-label')
  );
  const bands = Array.from(doc.querySelectorAll('.dgmo-annotation-band rect'));
  expect(labels.length).toBeGreaterThan(0);
  const others = Array.from(doc.querySelectorAll('text')).filter(
    (t) => !t.classList.contains('dgmo-annotation-band-label') && t.textContent
  );
  const dots = Array.from(doc.querySelectorAll('circle')).filter(
    (c) => num(c, 'r') > 0
  );
  const lines = Array.from(doc.querySelectorAll('path')).filter((p) => {
    const stroke = p.getAttribute('stroke');
    return (
      stroke !== null &&
      stroke !== 'none' &&
      stroke !== 'transparent' &&
      !p.closest('.tick') &&
      !p.classList.contains('domain')
    );
  });
  return labels.map((el) => {
    const box = textBox(el);
    const line = el.getAttribute('data-line-number');
    const band = bands.find(
      (b) => b.parentElement?.getAttribute('data-line-number') === line
    )!;
    const top = num(band, 'y');
    const bottom = top + num(band, 'height');
    return {
      text: el.textContent,
      inside: box.y >= top && box.y + box.h <= bottom,
      onText: others
        .filter((t) => overlaps(box, textBox(t)))
        .map((t) => t.textContent),
      onPoint: dots.some((c) =>
        overlaps(box, {
          x: num(c, 'cx') - num(c, 'r'),
          y: num(c, 'cy') - num(c, 'r'),
          w: 2 * num(c, 'r'),
          h: 2 * num(c, 'r'),
        })
      ),
      onLine: lines.some((p) =>
        pathSegments(p.getAttribute('d') ?? '').some((sg) => crosses(sg, box))
      ),
    };
  });
}

describe('band label clears the data (#2137)', () => {
  it('a spill-under band whose top edge meets the last point and its name', async () => {
    const svg = await renderDataChartD3(
      FIXTURE,
      'light',
      getPalette('nord').light
    );
    const got = check(svg);
    expect(got.map((g) => g.text).sort()).toEqual([
      'Spills over the top',
      'Spills under',
    ]);
    for (const g of got)
      expect(g).toEqual({
        text: g.text,
        inside: true,
        onText: [],
        onPoint: false,
        onLine: false,
      });
  });
});

describe('band label clears the data on slope and scatter (#2137)', () => {
  const clear = (svg: string) => {
    for (const g of check(svg))
      expect(g).toEqual({
        text: g.text,
        inside: true,
        onText: [],
        onPoint: false,
        onLine: false,
      });
  };

  it('slope: a series ending in the band', async () => {
    clear(
      await renderForExport(
        'slope S\nperiod 2020 2024\nband 10..20 Low water\nA 40 60\nB 30 15\nC 12 19.5',
        'light',
        getPalette('nord').light
      )
    );
  });

  it('scatter: points along the band top', async () => {
    clear(
      await renderDataChartD3(
        'scatter S\ny-axis 0..10\nband 6..14 Spills over\nA 1 9.5\nB 4 9.5\nC 6 9.5\nD 8 9.5\nE 9 9.5\nF 10 9.5\nG 11 9.7\nH 12 9.7',
        'light',
        getPalette('nord').light
      )
    );
  });
});

describe('pathSegments', () => {
  it('reads absolute and relative lines, steps and closes', () => {
    expect(pathSegments('M0,0L10,0h5v5Z')).toEqual([
      [0, 0, 10, 0],
      [10, 0, 15, 0],
      [15, 0, 15, 5],
      [15, 5, 0, 0],
    ]);
  });

  it('flattens a cubic into runs that end on its end point', () => {
    const sg = pathSegments('M0,0C0,10,10,10,10,0');
    expect(sg).toHaveLength(8);
    expect(sg.at(-1)!.slice(2)).toEqual([10, 0]);
  });
});
