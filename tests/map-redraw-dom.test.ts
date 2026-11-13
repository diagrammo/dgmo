import { describe, it, expect, beforeAll, vi } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { renderMap } from '../src/map/renderer';
import { loadMapData } from '../src/map/load-data';
import { getPalette } from '../src/palettes';
import type { MapData } from '../src/map/resolved-types';

// The app redraws the map preview after every typing burst, and on anchor that
// redraw is one main-thread task of ~94 ms (#1943). Two pieces of it were DOM
// work the drawing did not need: a `<line>` per relief hachure run (~340 on a
// world map) and clearing the old drawing one element at a time. Counted here
// as DOM calls, not timed: the cost is per element, so the count is the claim.

// dgmo-content's map/map-office-hours.dgmo, the map the app's typing probe uses.
const OFFICE_HOURS = [
  'map Follow-the-Sun Support Desk',
  '',
  'hours 9-17',
  'workweek mon-fri',
  '',
  'poi San Francisco clock label: West Coast',
  'poi London clock label: EMEA',
  'poi Singapore clock label: APAC',
  'poi Sydney clock label: Pacific',
].join('\n');

const P = getPalette('nord').light;
const DIMS = { width: 1200, height: 700 };

let data: MapData;
beforeAll(async () => {
  data = await loadMapData();
});

function draw(el: HTMLDivElement): void {
  renderMap(
    el,
    resolveMap(parseMap(OFFICE_HOURS), data),
    data,
    P,
    false,
    undefined,
    DIMS
  );
}

describe('map redraw DOM work (#1943)', () => {
  it('draws the relief hachure as one path, not an element per run', () => {
    const el = document.createElement('div');
    draw(el);
    const relief = el.querySelector('.dgmo-map-relief')!;
    expect(relief).toBeTruthy();
    expect(relief.querySelectorAll('line')).toHaveLength(0);
    expect(relief.children).toHaveLength(1);
    const runs = relief.querySelector('path')!.getAttribute('d')!.match(/M/g)!;
    // Every run is still there: one per spacing step down the canvas.
    expect(runs.length).toBeGreaterThan(100);
  });

  it('a redraw removes the old drawing whole, not element by element, and keeps the tooltip', () => {
    const el = document.createElement('div');
    draw(el);
    const tip = document.createElement('div');
    tip.setAttribute('data-d3-tooltip', '');
    tip.appendChild(document.createElement('span'));
    el.appendChild(tip);
    const before = el.querySelectorAll('*').length;
    expect(before).toBeGreaterThan(500);

    const removeChild = vi.spyOn(Node.prototype, 'removeChild');
    try {
      draw(el);
      // The old `<svg>` is the container's only non-tooltip child.
      expect(removeChild.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      removeChild.mockRestore();
    }
    expect(el.querySelectorAll(':scope > svg')).toHaveLength(1);
    expect(el.querySelector(':scope > [data-d3-tooltip] > span')).toBeTruthy();
  });
});
