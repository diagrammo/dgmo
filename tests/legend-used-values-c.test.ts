// @vitest-environment jsdom
// A tag legend lists only the values something uses (#2422).
import { describe, expect, it, vi } from 'vitest';
import { parseCalendar } from '../src/calendar/parser';
import { renderCalendar } from '../src/calendar/renderer';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { parseBracket } from '../src/bracket/parser';
import { renderBracket } from '../src/bracket/renderer';
import { parseVisualization, renderTimeline } from '../src/d3';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap } from '../src/map/layout';
import { loadMapData } from '../src/map/load-data';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

function sized(): HTMLDivElement {
  const c = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(c);
  Object.defineProperty(c, 'clientWidth', { value: 1200 });
  Object.defineProperty(c, 'clientHeight', { value: 800 });
  return c;
}

const entryNames = (c: Element) =>
  [...c.querySelectorAll('[data-legend-entry]')].map((e) =>
    e.getAttribute('data-series-name')
  );

describe('legend lists only used tag values (#2422, set c)', () => {
  it('infra', () => {
    const parsed = parseInfra(`infra Shop
tag Tier as t
  Gold blue
  Bronze red

edge
  rps: 100
  -> API
API | t: Gold`);
    expect(parsed.error).toBeNull();
    const layout = layoutInfra(computeInfra(parsed));
    const container = document.createElement('div');
    renderInfra(
      container,
      layout,
      palette,
      false,
      parsed.title,
      parsed.titleLineNumber,
      parsed.tagGroups,
      'Tier'
    );
    const names = entryNames(container).filter((n) => n !== 'API');
    expect(names).toContain('Gold');
    expect(names).not.toContain('Bronze');
  });

  it('calendar', () => {
    const parsed = parseCalendar(`calendar Mood
year 2026
tag Mood
  Great green
  Rough red

01-01 Great
`);
    expect(parsed.error).toBeNull();
    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 0,
    } as DOMRect);
    renderCalendar(container, parsed, palette, false, {});
    const names = entryNames(container.querySelector('.calendar-legend')!);
    expect(names).toContain('Great');
    expect(names).not.toContain('Rough');
  });

  it('map (regions, POIs and edges all count)', async () => {
    const data = await loadMapData();
    const src = `map
tag Market as m
  HQ blue
  Region teal
active-tag Market
Texas m: HQ`;
    const resolved = resolveMap(parseMap(src), data);
    const layout = layoutMap(
      resolved,
      data,
      { width: 800, height: 600 },
      { palette, isDark: false, legendMode: 'export' }
    );
    const group = layout.legend!.tagGroups.find((g) => g.name === 'Market')!;
    expect(group.entries.map((e) => e.value)).toEqual(['HQ']);
  });

  it('bracket', () => {
    const parsed = parseBracket(`bracket Taco Night
tag Truck as t
  Verde green
  Rojo red

El Verde t: Verde
La Roja t: Verde
El Verde beats La Roja 5-3`);
    const container = sized();
    renderBracket(container, parsed, palette, false);
    const names = entryNames(container);
    expect(names).toContain('Verde');
    expect(names).not.toContain('Rojo');
  });

  it('timeline', () => {
    const parsed = parseVisualization(
      `timeline
tag Team
  Frontend red
  Backend blue
2024-01 -> 2024-03 Task A | Team: Frontend`,
      palette
    );
    const container = sized();
    renderTimeline(
      container,
      parsed,
      palette,
      false,
      undefined,
      { width: 900, height: 500 },
      'Team'
    );
    const names = entryNames(container);
    expect(names).toContain('Frontend');
    expect(names).not.toContain('Backend');
  });
});
