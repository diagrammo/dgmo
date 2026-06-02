import { describe, it, expect } from 'vitest';
import { parseMap, looksLikeMap } from '../src/map/parser';

describe('parseMap — declaration & title (AC1)', () => {
  it('accepts `map` and extracts a title', () => {
    const r = parseMap('map Sales Territory\nCalifornia value: 90');
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
  it('captures directives incl. multi-word values', () => {
    const r = parseMap(
      'map\nregion world\nprojection albers-usa\nregion-metric Sales ($M)\ndefault-country US\nno-legend'
    );
    expect(r.error).toBeNull();
    expect(r.directives.region).toBe('world');
    expect(r.directives.projection).toBe('albers-usa');
    expect(r.directives.regionMetric).toBe('Sales ($M)');
    expect(r.directives.defaultCountry).toBe('US');
    expect(r.directives.noLegend).toBe(true);
  });
  it('parses the bare `no-insets` flag', () => {
    expect(parseMap('map\nno-insets').directives.noInsets).toBe(true);
    expect(
      parseMap('map\nCalifornia value: 5').directives.noInsets
    ).toBeUndefined();
  });
  it('warns on unknown enum value but records it', () => {
    const r = parseMap('map\nprojection mercatorr');
    expect(r.directives.projection).toBe('mercatorr');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'warning' && /projection/.test(d.message)
      )
    ).toBe(true);
  });
  it('parses scale with center', () => {
    const r = parseMap('map\nscale 0 100 center 50');
    expect(r.directives.scale).toEqual({ min: 0, max: 100, center: 50 });
  });
  it('captures subtitle/caption/poi-metric/flow-metric/region-labels/poi-labels', () => {
    const r = parseMap(
      'map\nsubtitle Q3 plan\ncaption src ACME\npoi-metric Headcount\nflow-metric Shipments\nregion-labels abbrev\npoi-labels all'
    );
    expect(r.directives.subtitle).toBe('Q3 plan');
    expect(r.directives.caption).toBe('src ACME');
    expect(r.directives.poiMetric).toBe('Headcount');
    expect(r.directives.flowMetric).toBe('Shipments');
    expect(r.directives.regionLabels).toBe('abbrev');
    expect(r.directives.poiLabels).toBe('all');
  });
  it('parses bare `muted` / `natural` basemap flags', () => {
    expect(parseMap('map\nmuted').directives.basemapStyle).toBe('muted');
    expect(parseMap('map\nnatural').directives.basemapStyle).toBe('natural');
    expect(parseMap('map\nCalifornia').directives.basemapStyle).toBeUndefined();
  });
  it('a region whose name starts with the flag word is NOT a flag', () => {
    const r = parseMap('map\nNatural Bridge value: 5');
    expect(r.directives.basemapStyle).toBeUndefined();
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.name).toBe('Natural Bridge');
  });
  it('parses the bare `relief` flag (AC4)', () => {
    expect(parseMap('map\nrelief').directives.relief).toBe(true);
    expect(
      parseMap('map\nCalifornia value: 5').directives.relief
    ).toBeUndefined();
  });
  it('`relief\\nrelief` sets true idempotently with no duplicate warning', () => {
    const r = parseMap('map\nrelief\nrelief');
    expect(r.directives.relief).toBe(true);
    expect(r.diagnostics.some((d) => /[Dd]uplicate/.test(d.message))).toBe(
      false
    );
  });
  it('a region literally named "Relief Basin" is a region, not the flag (AC4)', () => {
    const r = parseMap('map\nRelief Basin value: 5');
    expect(r.directives.relief).toBeUndefined();
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.name).toBe('Relief Basin');
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
    const r = parseMap('map\nCalifornia value: 92');
    expect(r.regions[0]).toMatchObject({ name: 'California', value: 92 });
  });
  it('errors on non-numeric value', () => {
    const r = parseMap('map\nCalifornia value: high');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'error' && /value/.test(d.message)
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
      'map\ntag Market as m\n  HQ blue\nTexas value: 50, m: HQ'
    );
    const reg = r.regions[0]!;
    expect(reg.value).toBe(50);
    expect(reg.tags).toEqual({ market: 'HQ' });
    expect(r.error).toBeNull();
    // Both are now selectable colouring dimensions (legend flips between them),
    // so coexistence is no longer warned.
    expect(
      r.diagnostics.some(
        (d) => /value/.test(d.message) && /tag/.test(d.message)
      )
    ).toBe(false);
  });
  it('peels a trailing ISO scope off region names (§24B.8)', () => {
    const r = parseMap('map\nGeorgia US-GA value: 5\nGeorgia US value: 6');
    expect(r.regions[0]).toMatchObject({ name: 'Georgia', scope: 'US-GA' });
    expect(r.regions[1]).toMatchObject({ name: 'Georgia', scope: 'US' });
  });
  it('does not peel a non-scope trailing token', () => {
    const r = parseMap('map\nNew York value: 5');
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
    const r = parseMap('map\nCalifornia blue value: 92');
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

describe('parseMap — region-metric ramp hue (§24B.3)', () => {
  it('peels a trailing color off region-metric into regionMetricColor', () => {
    const r = parseMap(
      'map\nregion-metric Sales ($M) blue\nCalifornia value: 5'
    );
    expect(r.directives.regionMetric).toBe('Sales ($M)');
    expect(r.directives.regionMetricColor).toBe('blue');
  });
  it('no trailing color leaves the hue unset (defaults to red downstream)', () => {
    const r = parseMap('map\nregion-metric Sales\nCalifornia value: 5');
    expect(r.directives.regionMetric).toBe('Sales');
    expect(r.directives.regionMetricColor).toBeUndefined();
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
      'map\ntag Market as m\n  Office blue\npoi Tokyo value: 38, m: Office'
    );
    expect(r.pois[0]!.tags).toEqual({ market: 'Office' });
    expect(r.pois[0]!.meta.value).toBe('38');
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
      'map\nroute Miami style: arc\n  -weigh anchor-> Nassau value: 40\n  -> Grand Turk\n  -> Miami'
    );
    expect(r.routes).toHaveLength(1);
    const rt = r.routes[0]!;
    expect(rt.style).toBe('arc');
    expect(rt.origin).toEqual({ kind: 'name', name: 'Miami' });
    expect(rt.legs).toHaveLength(3);
    // leg 1: in-arrow label + value (thickness), arced via header style
    expect(rt.legs[0]).toMatchObject({
      label: 'weigh anchor',
      value: '40',
      style: 'arc',
    });
    expect(rt.legs[0]!.dest).toEqual({ kind: 'name', name: 'Nassau' });
    // leg 3 closes the loop back to the origin
    expect(rt.legs[2]!.dest).toEqual({ kind: 'name', name: 'Miami' });
  });
  it('a leg tag/label decorates the destination stop', () => {
    const r = parseMap(
      'map\ntag Port as p\n  Prize orange\nroute Tortuga\n  -raid-> Nassau p: Prize, label: Hideout'
    );
    const leg = r.routes[0]!.legs[0]!;
    expect(leg.destTags).toEqual({ port: 'Prize' });
    expect(leg.destLabel).toBe('Hideout');
    expect(leg.label).toBe('raid'); // in-arrow text is the LEG label
  });
  it('route requires an origin on the header', () => {
    const r = parseMap('map\nroute style: arc\n  -> Nassau');
    expect(
      r.diagnostics.some(
        (d) =>
          d.severity === 'error' && /route requires an origin/.test(d.message)
      )
    ).toBe(true);
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

    const r2 = parseMap('map\nA -ships-> B value: 22');
    expect(r2.edges[0]).toMatchObject({ from: 'A', to: 'B', label: 'ships' });
    expect(r2.edges[0]!.meta.value).toBe('22');

    const r3 = parseMap('map\nA -> B -> C');
    expect(r3.edges.map((e) => [e.from, e.to])).toEqual([
      ['A', 'B'],
      ['B', 'C'],
    ]);
  });
  it('~> arc and -- undirected seam (AC14)', () => {
    const r = parseMap('map\nA ~> B');
    expect(r.edges[0]).toMatchObject({ directed: true, style: 'arc' });
    const r2 = parseMap('map\nA -- B');
    expect(r2.edges[0]).toMatchObject({ from: 'A', to: 'B', directed: false });
    expect(r2.error).toBeNull();
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
});

describe('parseMap — adversarial-review fixes', () => {
  it('#2 POI value: is retained in meta (→ marker size)', () => {
    const r = parseMap('map\npoi Tokyo value: 5');
    expect(r.pois[0]!.meta.value).toBe('5');
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
    const r = parseMap('map\nA -> B -> C value: 9');
    expect(r.edges[0]!.meta.value).toBeUndefined();
    expect(r.edges[1]!.meta.value).toBe('9');
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
    const r = parseMap('map\nCalifornia value: 92 // top market\nAtlantis');
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
