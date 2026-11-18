// Connected scatter (#1982): a bare `connect` joins the points in row order.
// One test per rule decided 2026-11-13.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseScatter } from '../src/data-chart-parser';
import { renderDataChartD3 } from '../src/charts-d3';
import { connectPaths } from '../src/charts-d3/scatter';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

const palette = getPalette('nord').light;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string): Promise<HTMLDivElement> {
  host.innerHTML = await renderDataChartD3(src, 'light', palette);
  return host;
}

const VOYAGE = `scatter Voyage
x-label Longitude
y-label Latitude
connect

Port Royal 10 40
Tortuga 30 20
Nassau 50 60
Havana 70 30`;

const GROUPS = `scatter Two fleets
connect

[Red Fleet] red
  R1 10 10
  R2 20 30
  R3 30 20
[Blue Fleet] blue
  B1 15 50
  B2 35 60`;

const pathD = (h: HTMLElement) =>
  [...h.querySelectorAll('path.dgmo-scatter-path-line')].map((p) =>
    p.getAttribute('d')
  );
const labels = (h: HTMLElement) =>
  [...h.querySelectorAll('text.dgmo-ptlabel')].map((t) => t.textContent);
const centres = (h: HTMLElement) =>
  [...h.querySelectorAll('circle[data-line-number]')].map(
    (c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`
  );

describe('scatter connect', () => {
  it('parses the bare flag', () => {
    expect(parseScatter(VOYAGE, palette).connect).toBe(true);
    expect(
      parseScatter(VOYAGE.replace('connect\n', ''), palette).connect
    ).toBeUndefined();
  });

  it('joins the points in row order with straight segments', async () => {
    const h = await draw(VOYAGE);
    const d = pathD(h);
    expect(d).toHaveLength(1);
    // M then L through every centre, in row order.
    expect(d[0]).toBe(
      centres(h)
        .map((c, i) => `${i ? 'L' : 'M'}${c}`)
        .join('')
    );
  });

  it('draws one arrowhead, on the last segment', async () => {
    const h = await draw(VOYAGE);
    const arrows = h.querySelectorAll('path.dgmo-scatter-arrow');
    expect(arrows).toHaveLength(1);
    // Its tip sits just short of the last point (Havana, rightmost).
    const tipX = Number(arrows[0]!.getAttribute('d')!.match(/^M([\d.]+)/)![1]);
    const lastX = Number(centres(h).at(-1)!.split(',')[0]);
    expect(tipX).toBeLessThan(lastX);
    expect(tipX).toBeGreaterThan(lastX - 20);
  });

  it('keeps the first and last names under no-name', async () => {
    const h = await draw(VOYAGE.replace('connect', 'connect\nno-name'));
    expect(labels(h).sort()).toEqual(['Havana', 'Port Royal']);
  });

  it('draws one path per category in its colour, each with its own ends', async () => {
    const h = await draw(GROUPS.replace('connect', 'connect\nno-name'));
    const paths = [...h.querySelectorAll('g.dgmo-scatter-path')];
    expect(paths.map((g) => g.getAttribute('data-series-name'))).toEqual([
      'Red Fleet',
      'Blue Fleet',
    ]);
    expect(paths[0]!.getAttribute('data-color')).toBe(palette.colors.red);
    expect(paths[1]!.getAttribute('data-color')).toBe(palette.colors.blue);
    expect(h.querySelectorAll('path.dgmo-scatter-arrow')).toHaveLength(2);
    expect(labels(h).sort()).toEqual(['B1', 'B2', 'R1', 'R3']);
  });

  it('joins bubble centres and leaves the sizes alone', async () => {
    const BUBBLES = `scatter Bubbles
size-label Crew
connect
A 10 10 50
B 20 30 200
C 30 20 100`;
    const h = await draw(BUBBLES);
    const without = await renderDataChartD3(
      BUBBLES.replace('connect\n', ''),
      'light',
      palette
    );
    const radii = (html: string) =>
      [...html.matchAll(/<circle[^>]*\sr="([\d.]+)"/g)].map((m) => m[1]);
    expect(radii(h.innerHTML)).toEqual(radii(without));
    expect(pathD(h)[0]).toBe(
      centres(h)
        .map((c, i) => `${i ? 'L' : 'M'}${c}`)
        .join('')
    );
  });

  it('draws no path or arrowhead for a lone point, with no error', async () => {
    const src = `scatter Lone
connect
[Solo] green
  S1 10 10
[Pair] blue
  P1 20 20
  P2 30 40`;
    expect(
      parseScatter(src, palette).diagnostics.filter(
        (d) => d.severity === 'error'
      )
    ).toEqual([]);
    const h = await draw(src);
    expect(
      [...h.querySelectorAll('g.dgmo-scatter-path')].map((g) =>
        g.getAttribute('data-series-name')
      )
    ).toEqual(['Pair']);
    expect(h.querySelectorAll('path.dgmo-scatter-arrow')).toHaveLength(1);
    expect(connectPaths([{}])).toEqual([]);
  });

  it('highlight greys the other paths with their points', async () => {
    const h = await draw(
      GROUPS.replace('[Red Fleet] red', '[Red Fleet] red\n  highlight')
    );
    const ground = storyGround(palette, false);
    const line = (name: string) =>
      h.querySelector(
        `g.dgmo-scatter-path[data-series-name="${name}"] path.dgmo-scatter-path-line`
      )!;
    expect(line('Blue Fleet').getAttribute('stroke')).toBe(ground.groundStroke);
    expect(line('Red Fleet').getAttribute('stroke')).toBe(palette.colors.red);
    const blueDot = h.querySelector('circle[data-category="Blue Fleet"]')!;
    expect(blueDot.getAttribute('stroke')).toBe(ground.groundStroke);
  });
});
