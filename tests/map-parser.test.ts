import { describe, it, expect } from 'vitest';
import { parseMap, looksLikeMap } from '../src/map/parser';

describe('parseMap — declaration & title (AC1)', () => {
  it('accepts `map` and extracts a title', () => {
    const r = parseMap('map Sales Territory\nCalifornia heat: 90');
    expect(r.error).toBeNull();
    expect(r.title).toBe('Sales Territory');
    expect(r.titleLineNumber).toBe(1);
  });
  it('accepts a bare `map` (no title)', () => {
    const r = parseMap('map');
    expect(r.error).toBeNull();
    expect(r.title).toBeNull();
  });
  it('rejects a non-map first line', () => {
    const r = parseMap('flowchart\nA -> B');
    expect(r.error).toMatch(/Expected chart type "map"/);
    expect(r.diagnostics[0]!.severity).toBe('error');
  });
  it('looksLikeMap', () => {
    expect(looksLikeMap('map\nX')).toBe(true);
    expect(looksLikeMap('// c\nmap Foo')).toBe(true);
    expect(looksLikeMap('org\nA')).toBe(false);
  });
});

describe('parseMap — directives (AC2, AC20)', () => {
  it('captures the surviving intent directives', () => {
    const r = parseMap(
      'map\nregion-heat Sales ($M)\nlocale US\nno-legend\ncaption src ACME'
    );
    expect(r.error).toBeNull();
    expect(r.directives.regionMetric).toBe('Sales ($M)');
    expect(r.directives.locale).toBe('US');
    expect(r.directives.noLegend).toBe(true);
    expect(r.directives.caption).toBe('src ACME');
  });
  it('merges country + subdivision into the one `locale` field', () => {
    expect(parseMap('map\nlocale US').directives.locale).toBe('US');
    expect(parseMap('map\nlocale US-GA').directives.locale).toBe('US-GA');
  });
  it('region-heat trailing color names the ramp hue (§24B.3)', () => {
    const r = parseMap('map\nregion-heat Sales blue');
    expect(r.directives.regionMetric).toBe('Sales');
    expect(r.directives.regionMetricColor).toBe('blue');
  });
  it('parses each `no-*` cosmetic opt-out as a boolean true (AC2)', () => {
    const r = parseMap(
      'map\nno-coastline\nno-relief\nno-context-labels\nno-region-labels\nno-poi-labels\nno-colorize'
    );
    expect(r.directives.noCoastline).toBe(true);
    expect(r.directives.noRelief).toBe(true);
    expect(r.directives.noContextLabels).toBe(true);
    expect(r.directives.noRegionLabels).toBe(true);
    expect(r.directives.noPoiLabels).toBe(true);
    expect(r.directives.noColorize).toBe(true);
  });
  it('parses `no-cluster-pois` as a boolean flag', () => {
    const r = parseMap('map\nno-cluster-pois\nCalifornia heat: 5');
    expect(r.error).toBeNull();
    expect(r.directives.noClusterPois).toBe(true);
    expect(r.regions.some((reg) => /no-cluster-pois/i.test(reg.name))).toBe(
      false
    );
  });
  it('parses `no-cities` as a boolean flag', () => {
    const r = parseMap('map\nno-cities\nCalifornia heat: 5');
    expect(r.error).toBeNull();
    expect(r.directives.noCities).toBe(true);
    expect(r.regions.some((reg) => /no-cities/i.test(reg.name))).toBe(false);
  });
  it('`no-cluster-pois` is idempotent — no duplicate warning', () => {
    const r = parseMap('map\nno-cluster-pois\nno-cluster-pois');
    expect(r.directives.noClusterPois).toBe(true);
    expect(r.diagnostics.some((d) => /[Dd]uplicate/.test(d.message))).toBe(
      false
    );
  });
  it('`no-title` parses as a directive, not a phantom region', () => {
    const r = parseMap('map Title Here\nno-title\nCalifornia heat: 5');
    expect(r.directives.noTitle).toBe(true);
    expect(r.regions.some((reg) => /no-title/i.test(reg.name))).toBe(false);
  });
  it('`no-*` flags are idempotent — no duplicate warning (mirror no-legend) (AC13)', () => {
    const r = parseMap('map\nno-coastline\nno-coastline');
    expect(r.directives.noCoastline).toBe(true);
    expect(r.diagnostics.some((d) => /[Dd]uplicate/.test(d.message))).toBe(
      false
    );
  });
  it('a duplicated value-directive still warns / last-wins (AC13)', () => {
    const r = parseMap('map\ncaption A\ncaption B');
    expect(r.directives.caption).toBe('B');
    expect(
      r.diagnostics.some((d) => /Duplicate directive/.test(d.message))
    ).toBe(true);
  });
  it('hard break: removed directive tokens are no longer directives (AC3)', () => {
    // projection / scale / subtitle / coastline / relief / context-labels /
    // region-labels / poi-labels are gone ENTIRELY — a line beginning with one
    // is treated as content (a region-fill), never a directive (no silent
    // accept, no compat shim). The resolver then errors on the bogus region.
    const lines = [
      'projection mercator',
      'scale 0 100',
      'subtitle Q3 plan',
      'coastline',
      'relief',
      'context-labels on',
      'region-labels abbrev',
      'poi-labels all',
    ];
    for (const line of lines) {
      const r = parseMap('map\n' + line);
      const d = r.directives as Record<string, unknown>;
      expect(d['projection']).toBeUndefined();
      expect(d['scale']).toBeUndefined();
      expect(d['subtitle']).toBeUndefined();
      expect(d['relief']).toBeUndefined();
      expect(d['coastline']).toBeUndefined();
      expect(d['regionLabels']).toBeUndefined();
      expect(d['poiLabels']).toBeUndefined();
      expect(d['contextLabels']).toBeUndefined();
      // Not recognized as a directive → parsed as a region-fill line.
      expect(r.regions).toHaveLength(1);
    }
  });
  it('removed `muted` / `natural` flags now parse as region-fill lines', () => {
    // No basemap-dress directive any more — a bare `muted` line is just a name.
    const r = parseMap('map\nmuted');
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.name).toBe('muted');
  });
  it('a region whose name starts with a former flag word is a region', () => {
    const r = parseMap('map\nNatural Bridge heat: 5');
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.name).toBe('Natural Bridge');
  });
});

describe('parseMap — tag groups (AC3)', () => {
  it('parses an indented tag block', () => {
    const r = parseMap(
      'map\ntag Market as m\n  HQ blue\n  Region teal\nactive-tag Market'
    );
    expect(r.error).toBeNull();
    expect(r.tagGroups).toHaveLength(1);
    expect(r.tagGroups[0]!.alias).toBe('m');
    expect(r.tagGroups[0]!.entries.map((e) => e.value)).toEqual([
      'HQ',
      'Region',
    ]);
    expect(r.tagGroups[0]!.entries[0]!.color).toBeTruthy();
  });
  it('parses the inline tag form (R4)', () => {
    const r = parseMap('map\ntag Market as m HQ blue, Region teal');
    expect(r.error).toBeNull();
    expect(r.tagGroups[0]!.entries.map((e) => e.value)).toEqual([
      'HQ',
      'Region',
    ]);
  });
});

describe('parseMap — region fills (AC4, AC5, AC6)', () => {
  it('parses a value', () => {
    const r = parseMap('map\nCalifornia heat: 92');
    expect(r.regions[0]).toMatchObject({ name: 'California', value: 92 });
  });
  it('errors on non-numeric value', () => {
    const r = parseMap('map\nCalifornia heat: high');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /heat/.test(d.message)
      )
    ).toBe(true);
  });
  it('keys tags by group name, not alias (R2)', () => {
    const r = parseMap('map\ntag Market as m\n  HQ blue\nUnited States m: HQ');
    expect(r.regions[0]).toMatchObject({
      name: 'United States',
      tags: { market: 'HQ' },
    });
  });
  it('accepts value + tag together with NO warning (bivariate handled) (AC6)', () => {
    const r = parseMap(
      'map\ntag Market as m\n  HQ blue\nTexas heat: 50, m: HQ'
    );
    const reg = r.regions[0]!;
    expect(reg.value).toBe(50);
    expect(reg.tags).toEqual({ market: 'HQ' });
    expect(r.error).toBeNull();
    // Both are now selectable colouring dimensions (legend flips between them),
    // so coexistence is no longer warned.
    expect(
      r.diagnostics.some((d) => /heat/.test(d.message) && /tag/.test(d.message))
    ).toBe(false);
  });
  it('peels a trailing ISO scope off region names (§24B.8)', () => {
    const r = parseMap('map\nGeorgia US-GA heat: 5\nGeorgia US heat: 6');
    expect(r.regions[0]).toMatchObject({ name: 'Georgia', scope: 'US-GA' });
    expect(r.regions[1]).toMatchObject({ name: 'Georgia', scope: 'US' });
  });
  it('does not peel a non-scope trailing token', () => {
    const r = parseMap('map\nNew York heat: 5');
    expect(r.regions[0]!.name).toBe('New York');
    expect(r.regions[0]!.scope).toBeUndefined();
  });
});

describe('parseMap — direct trailing colors (§1.5)', () => {
  it('peels a trailing color off a region into `color`', () => {
    const r = parseMap('map\nCalifornia blue');
    expect(r.regions[0]).toMatchObject({ name: 'California', color: 'blue' });
  });
  it('region trailing color coexists with value (color before metadata)', () => {
    const r = parseMap('map\nCalifornia blue heat: 92');
    expect(r.regions[0]).toMatchObject({
      name: 'California',
      color: 'blue',
      value: 92,
    });
  });
  it('peels a trailing color off a POI into `color`', () => {
    const r = parseMap('map\npoi Austin red');
    expect(r.pois[0]!.pos).toEqual({ kind: 'name', name: 'Austin' });
    expect(r.pois[0]!.color).toBe('red');
  });
  it('peels a trailing color off a coord POI (not malformed)', () => {
    const r = parseMap('map\npoi 39.74 -104.99 as dcw green');
    expect(r.pois[0]!.pos).toEqual({
      kind: 'coords',
      lat: 39.74,
      lon: -104.99,
    });
    expect(r.pois[0]!.alias).toBe('dcw');
    expect(r.pois[0]!.color).toBe('green');
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });
  it('leaves a capitalized color word as part of the name (escape hatch)', () => {
    const r = parseMap('map\npoi Orange');
    expect(r.pois[0]!.color).toBeUndefined();
    expect(r.pois[0]!.pos).toEqual({ kind: 'name', name: 'Orange' });
  });
});

describe('parseMap — region-heat ramp hue (§24B.3)', () => {
  it('peels a trailing color off region-heat into regionMetricColor', () => {
    const r = parseMap('map\nregion-heat Sales ($M) blue\nCalifornia heat: 5');
    expect(r.directives.regionMetric).toBe('Sales ($M)');
    expect(r.directives.regionMetricColor).toBe('blue');
  });
  it('no trailing color leaves the hue unset (defaults to red downstream)', () => {
    const r = parseMap('map\nregion-heat Sales\nCalifornia heat: 5');
    expect(r.directives.regionMetric).toBe('Sales');
    expect(r.directives.regionMetricColor).toBeUndefined();
    expect(r.directives.regionMetricLowColor).toBeUndefined();
  });
  it('two trailing colors set low (first) and high (second) — AC1', () => {
    const r = parseMap('map\nregion-heat Sales green red\nCalifornia heat: 5');
    expect(r.directives.regionMetric).toBe('Sales');
    expect(r.directives.regionMetricLowColor).toBe('green');
    expect(r.directives.regionMetricColor).toBe('red');
  });
  it('order is respected — no sorting/intent correction (AC4)', () => {
    const r = parseMap('map\nregion-heat Risk red green');
    expect(r.directives.regionMetricLowColor).toBe('red');
    expect(r.directives.regionMetricColor).toBe('green');
  });
  it('single color stays high-only with two colors absent (AC2)', () => {
    const r = parseMap('map\nregion-heat Coverage blue');
    expect(r.directives.regionMetric).toBe('Coverage');
    expect(r.directives.regionMetricColor).toBe('blue');
    expect(r.directives.regionMetricLowColor).toBeUndefined();
  });
  it('label that is itself a color word is not emptied (AC5)', () => {
    const r = parseMap('map\nregion-heat Red blue');
    expect(r.directives.regionMetric).toBe('Red');
    expect(r.directives.regionMetricColor).toBe('blue');
    expect(r.directives.regionMetricLowColor).toBeUndefined();
  });
  it('a non-color trailing token stops the peel', () => {
    const r = parseMap('map\nregion-heat Sales 2024');
    expect(r.directives.regionMetric).toBe('Sales 2024');
    expect(r.directives.regionMetricColor).toBeUndefined();
    expect(r.directives.regionMetricLowColor).toBeUndefined();
  });
});

describe('parseMap — POIs (AC7–AC11, AC22, AC23)', () => {
  it('POI by name + label', () => {
    const r = parseMap('map\npoi Austin label: West HQ');
    expect(r.pois[0]!.pos).toEqual({ kind: 'name', name: 'Austin' });
    expect(r.pois[0]!.label).toBe('West HQ');
  });
  it('POI ISO scope peel (AC8)', () => {
    const r = parseMap('map\npoi Portland US-OR\npoi San Jose CR');
    expect(r.pois[0]!.pos).toEqual({
      kind: 'name',
      name: 'Portland',
      scope: 'US-OR',
    });
    expect(r.pois[1]!.pos).toEqual({
      kind: 'name',
      name: 'San Jose',
      scope: 'CR',
    });
  });
  it('POI coords + alias (AC9)', () => {
    const r = parseMap('map\npoi 39.74 -104.99 as dcw label: DC-West');
    expect(r.pois[0]!.pos).toEqual({
      kind: 'coords',
      lat: 39.74,
      lon: -104.99,
    });
    expect(r.pois[0]!.alias).toBe('dcw');
    expect(r.pois[0]!.label).toBe('DC-West');
  });
  it('out-of-range coords error (AC9)', () => {
    const r = parseMap('map\npoi 200 0');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /range/.test(d.message)
      )
    ).toBe(true);
  });
  it('malformed coords error (AC23)', () => {
    const r = parseMap('map\npoi 39.74 -104.99 extra');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /[Mm]alformed/.test(d.message)
      )
    ).toBe(true);
  });
  it('POI tag (group-keyed) + value→size (AC10)', () => {
    const r = parseMap(
      'map\ntag Market as m\n  Office blue\npoi Tokyo size: 38, m: Office'
    );
    expect(r.pois[0]!.tags).toEqual({ market: 'Office' });
    expect(r.pois[0]!.meta.size).toBe('38');
  });
  it('rejects `at:` (AC11)', () => {
    const r = parseMap('map\npoi Denver at: 39,-104');
    expect(
      r.diagnostics.some((d) => d.severity === 'error' && /at:/.test(d.message))
    ).toBe(true);
  });
  it('Washington DC → scope DC (AC22)', () => {
    const r = parseMap('map\npoi Washington DC');
    expect(r.pois[0]!.pos).toEqual({
      kind: 'name',
      name: 'Washington',
      scope: 'DC',
    });
  });
});

describe('parseMap — routes (AC12)', () => {
  it('parses a route: origin header + arrow legs + loop close', () => {
    const r = parseMap(
      'map\nroute Miami\n  ~weigh anchor~> Nassau width: 40\n  -> Grand Turk\n  ~> Miami'
    );
    expect(r.routes).toHaveLength(1);
    const rt = r.routes[0]!;
    expect(rt.origin).toEqual({ kind: 'name', name: 'Miami' });
    expect(rt.legs).toHaveLength(3);
    // leg 1: in-arrow label + value (thickness), arced via its own `~>` glyph
    expect(rt.legs[0]).toMatchObject({
      label: 'weigh anchor',
      value: '40',
      style: 'arc',
    });
    expect(rt.legs[0]!.dest).toEqual({ kind: 'name', name: 'Nassau' });
    // shape is per-leg: leg 2 is a straight `-> ` glyph
    expect(rt.legs[1]!.style).toBe('straight');
    // leg 3 closes the loop back to the origin (arc again)
    expect(rt.legs[2]!.dest).toEqual({ kind: 'name', name: 'Miami' });
    expect(rt.legs[2]!.style).toBe('arc');
  });
  it('a leg tag colours the LINE; label: still names the destination stop', () => {
    const r = parseMap(
      'map\ntag Port as p\n  Prize orange\nroute Tortuga\n  -raid-> Nassau p: Prize, label: Hideout'
    );
    const leg = r.routes[0]!.legs[0]!;
    expect(leg.tags).toEqual({ port: 'Prize' }); // tag rides on the LINE now
    expect(leg.destLabel).toBe('Hideout'); // label: still names the stop
    expect(leg.label).toBe('raid'); // in-arrow text is the LEG label
  });
  it('route requires an origin on the header', () => {
    const r = parseMap('map\nroute\n  -> Nassau');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /route needs an origin/.test(d.message)
      )
    ).toBe(true);
  });
  it('`style:` on a route header is rejected (removed — use the arrow glyph)', () => {
    const r = parseMap('map\nroute Miami style: arc\n  ~> Nassau');
    expect(
      r.diagnostics.some(
        (d) =>
          d.severity === 'error' &&
          /route header no longer takes `style:`/.test(d.message)
      )
    ).toBe(true);
  });
  it('a bare destination with no arrow glyph is a malformed leg', () => {
    const r = parseMap('map\nroute Miami\n  Nassau');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Malformed route leg/.test(d.message)
      )
    ).toBe(true);
    expect(r.routes[0]!.legs).toHaveLength(0);
  });
  it('an undirected glyph (`--`/`~~`) on a route leg is rejected (legs are directional)', () => {
    for (const glyph of ['--', '~~']) {
      const r = parseMap(`map\nroute Miami\n  ${glyph} Nassau`);
      expect(
        r.diagnostics.some(
          (d) =>
            d.severity === 'error' && /route leg is directional/.test(d.message)
        )
      ).toBe(true);
      expect(r.routes[0]!.legs).toHaveLength(0);
    }
  });
});

describe('parseMap — edges (AC13–AC15, AC17)', () => {
  it('flat / labeled+weight / chain (AC13)', () => {
    const r = parseMap('map\nA -> B');
    expect(r.edges[0]).toMatchObject({
      from: 'A',
      to: 'B',
      directed: true,
      style: 'straight',
    });

    const r2 = parseMap('map\nA -ships-> B width: 22');
    expect(r2.edges[0]).toMatchObject({ from: 'A', to: 'B', label: 'ships' });
    expect(r2.edges[0]!.meta.width).toBe('22');

    const r3 = parseMap('map\nA -> B -> C');
    expect(r3.edges.map((e) => [e.from, e.to])).toEqual([
      ['A', 'B'],
      ['B', 'C'],
    ]);
  });
  it('a tag on an edge line rides on the LINE (§24B.6)', () => {
    const r = parseMap('map\ntag Leg as l\n  Cruise blue\nA ~> B l: Cruise');
    expect(r.edges[0]).toMatchObject({ from: 'A', to: 'B', directed: true });
    expect(r.edges[0]!.tags).toEqual({ leg: 'Cruise' }); // keyed by group name
    expect(r.edges[0]!.label).toBeUndefined(); // tag is not the arrow label
  });
  it('~> arc and -- undirected seam (AC14)', () => {
    const r = parseMap('map\nA ~> B');
    expect(r.edges[0]).toMatchObject({ directed: true, style: 'arc' });
    const r2 = parseMap('map\nA -- B');
    expect(r2.edges[0]).toMatchObject({ from: 'A', to: 'B', directed: false });
    expect(r2.error).toBeNull();
  });
  it('labeled undirected `-label-` (no arrowhead, keeps label)', () => {
    const r = parseMap('map\nA -ferry- B width: 12');
    expect(r.edges[0]).toMatchObject({
      from: 'A',
      to: 'B',
      label: 'ferry',
      directed: false,
      style: 'straight',
    });
    expect(r.edges[0]!.meta.width).toBe('12');
    expect(r.error).toBeNull();
  });
  it('undirected arc `~~` and labeled `~label~`', () => {
    const r = parseMap('map\nA ~~ B');
    expect(r.edges[0]).toMatchObject({ directed: false, style: 'arc' });
    const r2 = parseMap('map\nA ~trade~ B');
    expect(r2.edges[0]).toMatchObject({
      label: 'trade',
      directed: false,
      style: 'arc',
    });
    expect(r2.error).toBeNull();
  });
  it('directed labeled forms still win over undirected (regex ordering)', () => {
    const r = parseMap('map\nA -ships-> B');
    expect(r.edges[0]).toMatchObject({ label: 'ships', directed: true });
    const r2 = parseMap('map\nA ~sails~> B');
    expect(r2.edges[0]).toMatchObject({
      label: 'sails',
      directed: true,
      style: 'arc',
    });
  });
  it('hyphenated endpoint names are not split (R5)', () => {
    const r = parseMap('map\noffice-east -> hub-west');
    expect(r.edges[0]).toMatchObject({ from: 'office-east', to: 'hub-west' });
  });
  it('hub / star from a POI (AC15)', () => {
    const r = parseMap('map\npoi dcw\n  -> office-east\n  -> office-west');
    expect(r.edges.map((e) => [e.from, e.to])).toEqual([
      ['dcw', 'office-east'],
      ['dcw', 'office-west'],
    ]);
  });
  it('hub legs accept undirected + labeled tokens', () => {
    const r = parseMap('map\npoi dcw\n  -- office-east\n  -link- office-west');
    expect(r.edges[0]).toMatchObject({
      from: 'dcw',
      to: 'office-east',
      directed: false,
    });
    expect(r.edges[1]).toMatchObject({
      from: 'dcw',
      to: 'office-west',
      label: 'link',
      directed: false,
    });
  });
  it('a named hub line with no arrow is a malformed hub edge (not silently a region)', () => {
    const r = parseMap('map\npoi JFK\n  LAX');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /Malformed hub edge/.test(d.message)
      )
    ).toBe(true);
    expect(r.edges).toHaveLength(0);
    // the bare name must NOT leak through as a top-level region
    expect(r.regions ?? []).toHaveLength(0);
  });
  it('a poi metadata line (no name) under a poi still parses, not a hub error', () => {
    const r = parseMap('map\npoi JFK\n  size: 9');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(r.pois[0]!.meta.size).toBe('9');
  });
});

describe('parseMap — per-element channel keys (decision #20)', () => {
  it('a region takes heat: (→ choropleth value)', () => {
    const r = parseMap('map\nCalifornia heat: 92');
    expect(r.regions[0]!.value).toBe(92);
    expect(r.error).toBeNull();
  });
  it('size: or width: on a region is rejected (regions take heat:)', () => {
    const rs = parseMap('map\nCalifornia size: 5');
    expect(
      rs.diagnostics.some((d) => /regions take `heat:`/.test(d.message))
    ).toBe(true);
    const rw = parseMap('map\nCalifornia width: 5');
    expect(
      rw.diagnostics.some((d) => /regions take `heat:`/.test(d.message))
    ).toBe(true);
  });
  it('heat: or width: on a POI is rejected (points take size:)', () => {
    const rh = parseMap('map\npoi Tokyo heat: 5');
    expect(
      rh.diagnostics.some((d) => /points take `size:`/.test(d.message))
    ).toBe(true);
    expect(rh.pois[0]!.meta.heat).toBeUndefined(); // foreign key dropped
    const rw = parseMap('map\npoi Tokyo width: 5');
    expect(
      rw.diagnostics.some((d) => /points take `size:`/.test(d.message))
    ).toBe(true);
  });
  it('heat: or size: on a free edge is rejected (edges take width:)', () => {
    const rh = parseMap('map\nA -> B heat: 5');
    expect(
      rh.diagnostics.some((d) => /edges take `width:`/.test(d.message))
    ).toBe(true);
    const rs = parseMap('map\nA -> B size: 5');
    expect(
      rs.diagnostics.some((d) => /edges take `width:`/.test(d.message))
    ).toBe(true);
  });
  it('a route leg takes width:, a foreign size: is rejected', () => {
    const r = parseMap('map\nroute Miami\n  ~> Nassau size: 5');
    expect(
      r.diagnostics.some((d) => /edges take `width:`/.test(d.message))
    ).toBe(true);
  });
});

describe('parseMap — adversarial-review fixes', () => {
  it('#2 POI size: is retained in meta (→ marker size)', () => {
    const r = parseMap('map\npoi Tokyo size: 5');
    expect(r.pois[0]!.meta.size).toBe('5');
  });
  it('#3 a tag alias colliding with a reserved word still resolves as a tag', () => {
    const r = parseMap(
      'map\ntag Value as value\n  Big teal\nDenmark value: Big'
    );
    expect(r.regions[0]!.tags).toEqual({ value: 'Big' });
    expect(r.regions[0]!.value).toBeUndefined(); // routed to tag, not the numeric channel
  });
  it('#4 description/date are no longer reserved keys (cut 2026-06-01)', () => {
    // `description`/`date` were removed from MAP_REGISTRY — they no longer
    // dispatch as metadata, so they are NOT lifted into `meta`.
    const r = parseMap('map\nTexas description: lone star');
    expect(r.regions[0]!.meta.description).toBeUndefined();
  });
  it('#5 invalid/reserved tag-group names are flagged (validateTagGroupNames wired)', () => {
    const r = parseMap('map\ntag none as n\n  A teal');
    expect(
      r.diagnostics.some((d) =>
        /none.*reserved|reserved.*none/i.test(d.message)
      )
    ).toBe(true);
  });
  it('#6 unknown active-tag warns', () => {
    const r = parseMap('map\ntag Market as m\n  HQ teal\nactive-tag Nope');
    expect(r.diagnostics.some((d) => /active-tag/.test(d.message))).toBe(true);
  });
  it('#7 chain value attaches only to the final leg', () => {
    const r = parseMap('map\nA -> B -> C width: 9');
    expect(r.edges[0]!.meta.width).toBeUndefined();
    expect(r.edges[1]!.meta.width).toBe('9');
  });
  it('#8 a +-prefixed coord-like POI is a malformed-coord error, not a silent name', () => {
    const r = parseMap('map\npoi +39 -104');
    // valid: COORD_RE now accepts leading +
    expect(r.pois[0]!.pos).toEqual({ kind: 'coords', lat: 39, lon: -104 });
  });
  it('#10 a blank line inside a route does not truncate it', () => {
    const r = parseMap('map\nroute Miami\n  -> Nassau\n\n  -> Grand Turk');
    expect(r.routes[0]!.legs).toHaveLength(2);
    expect(r.regions).toHaveLength(0);
  });
});

describe('parseMap — surface removed (AC9)', () => {
  it('`surface` is no longer a directive — line parses as content', () => {
    const r = parseMap('map\nsurface water');
    expect(
      (r.directives as Record<string, unknown>)['surface']
    ).toBeUndefined();
  });
  it('a route leg formerly written with `surface:` now renders straight (no implied bow)', () => {
    const r = parseMap('map\nroute Tokyo\n  -> Osaka surface: water');
    expect(r.routes[0]!.legs[0]!.style).toBe('straight');
    // surface is no longer lifted onto the leg.
    expect(
      (r.routes[0]!.legs[0]! as Record<string, unknown>)['surface']
    ).toBeUndefined();
    // `surface:` is no longer a recognized key — it is NOT split off as metadata,
    // so it folds into the destination name (which then fails resolution: AC9).
    expect(r.routes[0]!.legs[0]!.dest).toMatchObject({
      kind: 'name',
      name: 'Osaka surface: water',
    });
  });
  it('a `~>` leg bows; a `->` leg stays straight (shape is per-leg)', () => {
    const r = parseMap('map\nroute Tokyo\n  ~> Osaka\n  -> Nagoya');
    expect(r.routes[0]!.legs[0]!.style).toBe('arc');
    expect(r.routes[0]!.legs[1]!.style).toBe('straight');
  });
  it('an edge with `surface:` metadata renders straight unless ~>/style arc', () => {
    const r = parseMap('map\nA -> B surface: water');
    expect(r.edges[0]!.style).toBe('straight');
    expect((r.edges[0]! as Record<string, unknown>)['surface']).toBeUndefined();
  });
});

describe('parseMap — classification & robustness (AC16, AC18, AC19, AC21)', () => {
  it('bare line is a region, not a POI; poi keyword is load-bearing (AC16)', () => {
    const r = parseMap('map\nGermany');
    expect(r.regions.map((x) => x.name)).toEqual(['Germany']);
    expect(r.pois).toHaveLength(0);
  });
  it('empty map is valid (AC19)', () => {
    const r = parseMap('map');
    expect(r.error).toBeNull();
    expect(r.diagnostics).toHaveLength(0);
    expect(r.regions).toHaveLength(0);
    expect(r.pois).toHaveLength(0);
  });
  it('inline comment stripped; bare unknown name does NOT warn (AC21)', () => {
    const r = parseMap('map\nCalifornia heat: 92 // top market\nAtlantis');
    expect(r.regions.find((x) => x.name === 'California')!.value).toBe(92);
    expect(r.regions.some((x) => x.name === 'Atlantis')).toBe(true);
    expect(
      r.diagnostics.filter((d) => /[Dd]id you mean/.test(d.message))
    ).toHaveLength(0);
  });
  it('never throws; problems surface as diagnostics (AC18)', () => {
    expect(() =>
      parseMap('map\npoi 999 999\nA ->\nweird ~ line')
    ).not.toThrow();
  });
});
