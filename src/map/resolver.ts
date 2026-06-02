// Resolver (step 3): ParsedMap + MapData → ResolvedMap. SYNCHRONOUS + PURE
// (deterministic, no I/O — the async asset load lives in ./load-data.ts; DI).
// Resolves region names → ISO geometry, POI/endpoint names → coords, infers the
// basemap/scope/extent/projection, and emits resolved-identity diagnostics. See
// §24B.2/.8/.10 and the tech-spec adversarial resolutions R1–R19.
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { Writable } from '../utils/brand';
import type { ParsedMap, PoiPos } from './types';
import type {
  MapData,
  ResolvedMap,
  ResolvedRegion,
  ResolvedPoi,
  ResolvedEdge,
  ResolvedRoute,
  ResolvedRouteLeg,
  ProjectionFamily,
  GeoExtent,
} from './resolved-types';
import {
  featureIndex,
  featureBbox,
  featureBboxPrimary,
  unionExtent,
  fold,
} from './geo';

/** Discriminated result of a gazetteer name lookup (#5): `defer` is "ambiguous,
 *  retry in pass B with inferred scope" — distinct from `miss` (errored, drop) so
 *  pass-A deferral never has to infer state from unrelated same-line diagnostics. */
type LookupResult =
  | { kind: 'ok'; lat: number; lon: number; iso: string }
  | { kind: 'defer' }
  | { kind: 'miss' };

// Projection / tier thresholds (degrees of span) — tunable (R10).
const WORLD_SPAN = 90;
// Mercator is used for everything sub-world (tight clusters AND single-continent
// regional views — a mid-latitude continent reads with its familiar conventional
// shape, where equirectangular squashes it). Two guards push back to
// equirectangular: a world/multi-continent `span` (> WORLD_SPAN), or a frame that
// reaches into polar latitudes (> MERCATOR_MAX_LAT) where Mercator's sec(φ) area
// blow-up turns gross. Europe (≈71°N) and East Asia stay comfortably on Mercator.
const MERCATOR_MAX_LAT = 80;
const PAD_FRACTION = 0.05;
// Latitude band for a snapped world view — Tierra del Fuego (≈ −55°) to northern
// Russia/Canada (≈ +78°). Excludes most of Antarctica + the high Arctic so the
// populated continents fill the frame rather than waste it on ice.
const WORLD_LAT_SOUTH = -58;
const WORLD_LAT_NORTH = 78;

// Long-form (or common-alias) country name → the folded Natural-Earth display
// name actually shipped in world-coarse (#6). The NE coarse layer abbreviates a
// handful of names ("Dem. Rep. Congo", "W. Sahara", …) that a user would never
// type; this rescues them. ISO-code matching (featureIndex id keys) covers the
// rest. Keys/values are pre-folded (lowercase, diacritics stripped).
const REGION_ALIASES: Readonly<Record<string, string>> = {
  // Common everyday names → the Natural-Earth display name actually shipped.
  'united states': 'united states of america',
  usa: 'united states of america',
  america: 'united states of america',
  uk: 'united kingdom',
  'western sahara': 'w. sahara',
  'democratic republic of the congo': 'dem. rep. congo',
  'dr congo': 'dem. rep. congo',
  drc: 'dem. rep. congo',
  'dominican republic': 'dominican rep.',
  'falkland islands': 'falkland is.',
  'ivory coast': "cote d'ivoire",
  'central african republic': 'central african rep.',
  'equatorial guinea': 'eq. guinea',
  'solomon islands': 'solomon is.',
  'bosnia and herzegovina': 'bosnia and herz.',
  'south sudan': 's. sudan',
  'north macedonia': 'macedonia',
  'czech republic': 'czechia',
};

// US state (+ DC) postal abbreviations. A bare trailing two-letter scope token
// that is one of these resolves to the US STATE `US-XX` (not the colliding
// ISO 3166-1 country code — e.g. `CA` = California, not Canada) and signals US
// scope (§24B.8, 2026-06-01). Non-state two-letter tokens (`CR`, `FR`) stay
// country codes. Trade-off: a foreign country whose code collides with a state
// (DE/IN/AR/CO/LA/PA/…) can't be picked by bare code — use the city name alone
// (most-populous) or coordinates.
const US_STATE_POSTAL: ReadonlySet<string> = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
]);

/** A bare two-letter scope token that names a US state → its `US-XX` 3166-2 id
 *  (`OR` → `US-OR`), else null. Case-insensitive. */
function usStateFromBareScope(scope: string | undefined): string | null {
  if (!scope) return null;
  const up = scope.toUpperCase();
  return US_STATE_POSTAL.has(up) ? `US-${up}` : null;
}

/** Rough US bounding box (incl. AK across the dateline, HI, PR) for classifying
 *  bare coordinate POIs as US-or-not when deciding `albers-usa` (#13). */
function looksUS(lat: number, lon: number): boolean {
  if (lat < 15 || lat > 72) return false;
  // continental + AK + HI + Caribbean territories: lon in [-180, -64];
  // Aleutians wrap past the antimeridian to ~+172.
  return (lon >= -180 && lon <= -64) || lon >= 172;
}

export function resolveMap(parsed: ParsedMap, data: MapData): ResolvedMap {
  const diagnostics: DgmoError[] = [...parsed.diagnostics]; // seed with parse diags (R14)
  const err = (line: number, message: string, code?: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'error', code));
  };
  const warn = (line: number, message: string, code?: string): void => {
    diagnostics.push(makeDgmoError(line, message, 'warning', code));
  };

  const result: Writable<ResolvedMap> = {
    title: parsed.title,
    ...(parsed.directives.subtitle !== undefined && {
      subtitle: parsed.directives.subtitle,
    }),
    ...(parsed.directives.caption !== undefined && {
      caption: parsed.directives.caption,
    }),
    tagGroups: [...parsed.tagGroups],
    // Shallow-copy so the resolved model never aliases the parser's mutable
    // directives object (#11). NOTE: tag→region-fill COLOR binding is the
    // renderer's job (step 4) — the resolver only carries `tags` + `tagGroups`
    // through; it never resolves a tag value to a palette color (#10).
    directives: { ...parsed.directives },
    basemaps: { world: 'coarse', subdivisions: [] },
    regions: [],
    pois: [],
    edges: [],
    routes: [],
    extent: [
      [-180, -85],
      [180, 85],
    ] as GeoExtent,
    projection: 'natural-earth',
    diagnostics,
    error: parsed.error,
  };

  // Per-layer indexes (never merged — R12; coarse is the authoritative name
  // index, ids shared with detail — R13).
  const countryIndex = featureIndex(data.worldCoarse);
  const usStateIndex = featureIndex(data.usStates);
  const allNames = [
    ...[...countryIndex.values()].map((v) => v.name),
    ...[...usStateIndex.values()].map((v) => v.name),
  ];

  // ── US-scope signal (drives the country-vs-state collision, R2) ──
  const usScoped =
    parsed.directives.region === 'us-states' ||
    parsed.directives.defaultCountry?.toUpperCase() === 'US' ||
    parsed.regions.some((r) => {
      const f = fold(r.name);
      return usStateIndex.has(f) && !countryIndex.has(f);
    }) ||
    parsed.regions.some(
      (r) =>
        r.scope === 'US' ||
        r.scope?.startsWith('US-') ||
        usStateFromBareScope(r.scope) !== null
    ) ||
    parsed.pois.some(
      (p) =>
        p.pos.kind === 'name' &&
        (p.pos.scope?.startsWith('US-') ||
          usStateFromBareScope(p.pos.scope) !== null)
    );

  // ── Regions (R2/R12) ──
  const regions: ResolvedRegion[] = [];
  const seenRegion = new Map<string, number>(); // iso → index in regions
  let usSubdivisionReferenced = false;
  const referencedRegionIds: { topo: 'us'; id: string }[] = [];
  for (const r of parsed.regions) {
    const f = fold(r.name);
    // Country match: folded name, then ISO-code key (featureIndex id keys), then
    // the long-form→NE-abbrev alias table (#6).
    const inCountry =
      countryIndex.get(f) ??
      (REGION_ALIASES[f] ? countryIndex.get(REGION_ALIASES[f]!) : undefined);
    const inState = usStateIndex.get(f);
    let chosen: {
      id: string;
      name: string;
      layer: 'country' | 'us-state';
    } | null = null;
    // Explicit ISO scope (§24B.8): force the country-vs-state pick and skip the
    // ambiguity warning. `US`/`US-XX` → state; any other 2-letter code → country.
    const scope = r.scope;
    if (scope) {
      const wantsState = scope === 'US' || scope.startsWith('US-');
      if (wantsState && inState) {
        if (scope.startsWith('US-') && inState.id !== scope) {
          err(
            r.lineNumber,
            `No subdivision "${r.name}" in scope ${scope} (it is ${inState.id}).`,
            'E_MAP_SCOPE_MISS'
          );
          continue;
        }
        chosen = { ...inState, layer: 'us-state' };
      } else if (!wantsState && inCountry) {
        chosen = { ...inCountry, layer: 'country' };
      } else {
        err(
          r.lineNumber,
          `No region "${r.name}" found in scope ${scope}.`,
          'E_MAP_SCOPE_MISS'
        );
        continue;
      }
    } else if (inCountry && inState) {
      if (usScoped) {
        // A US scope (e.g. `region us-states`) makes the state the unambiguous
        // intent — resolve silently, no disambiguation warning needed.
        chosen = { ...inState, layer: 'us-state' };
      } else {
        chosen = { ...inCountry, layer: 'country' };
        // Teach the disambiguation syntax so the author can pin it explicitly.
        // Suggest the non-redundant forms: a bare ISO code, or name + scope.
        warn(
          r.lineNumber,
          `"${r.name}" is both a country and a US state — resolved as ${chosen.layer} (${chosen.id}). Pin it with an ISO code (${inState.id} / ${inCountry.id}) or name + scope ("${r.name} US" / "${r.name} ${inCountry.id}").`,
          'W_MAP_REGION_AMBIGUOUS'
        );
      }
    } else if (inState) {
      chosen = { ...inState, layer: 'us-state' };
    } else if (inCountry) {
      chosen = { ...inCountry, layer: 'country' };
    }
    if (!chosen) {
      const hint = suggest(r.name, allNames);
      err(
        r.lineNumber,
        `Unknown subdivision "${r.name}".${hint ? ' ' + hint : ''}`,
        'E_MAP_UNKNOWN_SUBDIVISION'
      );
      continue;
    }
    if (chosen.layer === 'us-state') {
      usSubdivisionReferenced = true;
      referencedRegionIds.push({ topo: 'us', id: chosen.id });
    }
    const resolved: ResolvedRegion = {
      iso: chosen.id,
      name: chosen.name,
      layer: chosen.layer,
      ...(r.value !== undefined && { value: r.value }),
      ...(r.color !== undefined && { color: r.color }),
      tags: r.tags,
      meta: r.meta,
      lineNumber: r.lineNumber,
    };
    const prev = seenRegion.get(chosen.id);
    if (prev !== undefined) {
      warn(
        r.lineNumber,
        `Duplicate region "${chosen.name}" — last definition wins.`,
        'W_MAP_DUPLICATE_REGION'
      );
      regions[prev] = resolved;
    } else {
      seenRegion.set(chosen.id, regions.length);
      regions.push(resolved);
    }
  }

  // ── POIs: two-pass (R9) ──
  const registry = new Map<string, Writable<ResolvedPoi>>();
  const pois: Writable<ResolvedPoi>[] = [];

  const registerPoi = (
    id: string,
    poi: Writable<ResolvedPoi>,
    line: number
  ): void => {
    const existing = registry.get(id);
    if (existing) {
      // An implicit endpoint POI must never clobber an explicitly declared one
      // (#8). resolveEndpoint already guards with `registry.has`, but keep the
      // invariant local to registration so no caller can violate it.
      if (poi.implicit && !existing.implicit) return;
      // Only a declared-over-declared collision is a user-facing duplicate.
      if (!poi.implicit && !existing.implicit) {
        warn(
          line,
          `Duplicate POI "${id}" — last definition wins.`,
          'W_MAP_DUPLICATE_POI'
        );
      }
      const idx = pois.indexOf(existing);
      if (idx >= 0) pois[idx] = poi;
    } else {
      pois.push(poi);
    }
    registry.set(id, poi);
  };

  /** Resolve a name (+optional scope) against the gazetteer (#5 discriminated). */
  const lookupName = (
    name: string,
    scope: string | undefined,
    line: number,
    scopeHint: string | undefined,
    allowAmbiguous: boolean
  ): LookupResult => {
    const f = fold(name);
    let idxs = data.gazetteer.byName[f];
    if (!idxs?.length) {
      const aliasIdx = data.gazetteer.alt[f];
      if (aliasIdx !== undefined) idxs = [aliasIdx];
    }
    if (!idxs?.length) {
      const cityNames = data.gazetteer.cities.map((c) => c[4]);
      const hint = suggest(name, cityNames);
      err(
        line,
        `Unknown place "${name}" (not in the gazetteer; use coordinates).${hint ? ' ' + hint : ''}`,
        'E_MAP_UNKNOWN_PLACE'
      );
      return { kind: 'miss' };
    }
    let cands = idxs.map((i) => data.gazetteer.cities[i]!);
    const scopeUse = scope ?? scopeHint;
    if (scopeUse) {
      // ISO 3166-2 subdivision scope is `XX-…` (two letters + dash). A bare
      // two-letter token that names a US state resolves as the `US-XX`
      // subdivision (`CA` = California, §24B.8) — NOT the colliding country
      // code; any other bare two-letter token is a 3166-1 country code.
      const bareState = usStateFromBareScope(scopeUse);
      const subScope = /^[A-Za-z]{2}-/.test(scopeUse) ? scopeUse : bareState;
      const filtered = cands.filter((c) =>
        subScope ? c[5] === subScope : c[2] === scopeUse
      );
      if (filtered.length) cands = filtered;
      else if (scope) {
        err(line, `No "${name}" found in scope ${scope}.`, 'E_MAP_SCOPE_MISS');
        return { kind: 'miss' };
      }
    }
    if (cands.length > 1) {
      if (!allowAmbiguous && !scopeUse) {
        return { kind: 'defer' }; // ambiguous, no scope → pass B
      }
      // most-populous; tie-break lowest index (R11 — byName is NOT pop-ordered).
      cands = [...cands].sort((a, b) => b[3] - a[3]);
      if (!scope)
        warn(
          line,
          `"${name}" is ambiguous — resolved to the most-populous match.`,
          'W_MAP_AMBIGUOUS_NAME'
        );
    }
    const c = cands[0]!;
    return { kind: 'ok', lat: c[0], lon: c[1], iso: c[2] };
  };

  const poiIdFor = (pos: PoiPos, alias: string | undefined): string => {
    if (alias) return fold(alias);
    if (pos.kind === 'coords') return `@${pos.lat},${pos.lon}`;
    return fold(pos.name);
  };

  // POI-country tally, fed to default-country inference (#3) and the US-dominant
  // projection test (#13). Named POIs contribute their gazetteer ISO; bare-coord
  // POIs contribute a rough US-or-not classification (no reverse-geocode).
  const poiCountries: string[] = [];
  let anyNonUsPoi = false;
  const noteCountry = (iso: string | undefined): void => {
    if (iso) {
      poiCountries.push(iso);
      if (iso !== 'US') anyNonUsPoi = true;
    }
  };

  // Pass A: coords + scoped + single-candidate (unambiguous). Defer ambiguous.
  const deferred: (typeof parsed.pois)[number][] = [];
  for (const p of parsed.pois) {
    if (p.pos.kind === 'coords') {
      if (!looksUS(p.pos.lat, p.pos.lon)) anyNonUsPoi = true;
      addResolvedPoi(p.pos.lat, p.pos.lon, p);
      continue;
    }
    const got = lookupName(
      p.pos.name,
      p.pos.scope,
      p.lineNumber,
      undefined,
      false
    );
    if (got.kind === 'ok') {
      noteCountry(got.iso);
      addResolvedPoi(got.lat, got.lon, p);
    } else if (got.kind === 'defer') {
      deferred.push(p); // ambiguous, not an error → pass B
    }
    // `miss` already errored; drop.
  }

  // Infer default-country from explicit directive or the most common ISO across
  // resolved regions AND Pass-A POIs (#3 — POIs were previously voided, so a
  // POI-only US map never inferred US).
  const inferredCountry =
    parsed.directives.defaultCountry?.toUpperCase() ??
    mostCommonCountry(regions, poiCountries) ??
    undefined;

  // Pass B: ambiguous bare names, scoped by inferred default-country.
  for (const p of deferred) {
    if (p.pos.kind !== 'name') continue;
    const got = lookupName(
      p.pos.name,
      p.pos.scope,
      p.lineNumber,
      inferredCountry,
      true
    );
    if (got.kind === 'ok') {
      noteCountry(got.iso);
      addResolvedPoi(got.lat, got.lon, p);
    }
  }

  function addResolvedPoi(
    lat: number,
    lon: number,
    p: (typeof parsed.pois)[number]
  ): void {
    const id = poiIdFor(p.pos, p.alias);
    const name = p.pos.kind === 'name' ? p.pos.name : p.alias;
    const poi: Writable<ResolvedPoi> = {
      id,
      ...(name !== undefined && { name }),
      lat,
      lon,
      ...(p.label !== undefined && { label: p.label }),
      ...(p.color !== undefined && { color: p.color }),
      tags: p.tags,
      meta: p.meta,
      lineNumber: p.lineNumber,
    };
    registerPoi(id, poi, p.lineNumber);
  }

  // ── Edges + routes: bind endpoints, create implicit POIs (R7/R8) ──
  // A POI declared with an alias (`poi Chicago as central`) registers under its
  // id (`central`), so an endpoint that references it by NAME (`… -> Chicago`)
  // misses the id registry. Map declared names → id so such a reference binds to
  // the existing POI instead of spawning a duplicate implicit one on the same
  // spot (only aliased POIs need this — a name-only POI's id already IS its
  // folded name).
  const declaredByName = new Map<string, string>();
  for (const p of pois) {
    const fn = p.name ? fold(p.name) : undefined;
    if (fn && fn !== p.id && !declaredByName.has(fn))
      declaredByName.set(fn, p.id);
  }
  const resolveEndpoint = (ref: string, line: number): string | null => {
    const f = fold(ref);
    if (registry.has(f)) return f;
    const aliased = declaredByName.get(f);
    if (aliased) return aliased;
    const got = lookupName(ref, undefined, line, inferredCountry, true);
    if (got.kind !== 'ok') return null;
    noteCountry(got.iso);
    const poi: Writable<ResolvedPoi> = {
      id: f,
      name: ref,
      lat: got.lat,
      lon: got.lon,
      tags: {},
      meta: {},
      lineNumber: line,
      implicit: true,
    };
    registerPoi(f, poi, line);
    return f;
  };

  const edges: ResolvedEdge[] = [];
  for (const e of parsed.edges) {
    const fromId = resolveEndpoint(e.from, e.lineNumber);
    const toId = resolveEndpoint(e.to, e.lineNumber);
    if (!fromId || !toId) continue; // ungeocodable endpoint → drop (error already pushed)
    edges.push({
      fromId,
      toId,
      ...(e.label !== undefined && { label: e.label }),
      directed: e.directed,
      style: e.style,
      meta: e.meta,
      lineNumber: e.lineNumber,
    });
  }

  // Resolve a route stop to a POI id, registering it (with its inline tags/label/
  // size value) or binding to an already-declared POI. Returns null if a named
  // stop can't be geocoded. Unlike the old code, stop metadata is NO LONGER
  // dropped — it rides onto the created POI (fixes the named-stop meta bug).
  const resolveStop = (
    pos: PoiPos,
    alias: string | undefined,
    label: string | undefined,
    tags: Readonly<Record<string, string>>,
    sizeValue: string | undefined,
    line: number
  ): string | null => {
    const meta: Record<string, string> =
      sizeValue !== undefined ? { value: sizeValue } : {};
    if (pos.kind === 'coords') {
      const id = alias ? fold(alias) : `@${pos.lat},${pos.lon}`;
      if (!looksUS(pos.lat, pos.lon)) anyNonUsPoi = true;
      if (!registry.has(id)) {
        registerPoi(
          id,
          {
            id,
            ...(alias !== undefined && { name: alias }),
            lat: pos.lat,
            lon: pos.lon,
            ...(label !== undefined && { label }),
            tags,
            meta,
            lineNumber: line,
          },
          line
        );
      }
      return id;
    }
    // Named stop: bind to an existing declared POI if present, else geocode + create.
    const f = fold(pos.name);
    if (registry.has(f)) return f;
    const aliased = declaredByName.get(f);
    if (aliased) return aliased;
    const got = lookupName(pos.name, pos.scope, line, inferredCountry, true);
    if (got.kind !== 'ok') return null;
    noteCountry(got.iso);
    registerPoi(
      f,
      {
        id: f,
        name: pos.name,
        lat: got.lat,
        lon: got.lon,
        ...(label !== undefined && { label }),
        tags,
        meta,
        lineNumber: line,
      },
      line
    );
    return f;
  };

  const routes: ResolvedRoute[] = [];
  for (const rt of parsed.routes) {
    const originId = resolveStop(
      rt.origin,
      rt.originAlias,
      rt.originLabel,
      rt.originTags,
      rt.originValue,
      rt.lineNumber
    );
    if (!originId) continue; // can't anchor the route → drop (error already pushed)
    const stopIds: string[] = [originId];
    const legs: ResolvedRouteLeg[] = [];
    let prevId = originId;
    for (const leg of rt.legs) {
      const destId = resolveStop(
        leg.dest,
        leg.destAlias,
        leg.destLabel,
        leg.destTags,
        undefined, // a leg's `value:` is leg thickness, not the dest's size
        leg.lineNumber
      );
      if (!destId) continue; // ungeocodable destination → skip this leg
      legs.push({
        fromId: prevId,
        toId: destId,
        ...(leg.label !== undefined && { label: leg.label }),
        style: leg.style,
        ...(leg.value !== undefined && { value: leg.value }),
        lineNumber: leg.lineNumber,
      });
      if (!stopIds.includes(destId)) stopIds.push(destId); // unique markers (loop-close dedupe)
      prevId = destId;
    }
    routes.push({ stopIds, legs, lineNumber: rt.lineNumber });
  }

  // ── Basemaps + scope ──
  const subdivisions: Array<'us-states'> = [];
  if (usSubdivisionReferenced || parsed.directives.region === 'us-states')
    subdivisions.push('us-states');

  // ── Extent + projection (R5/R10) ──
  const regionBoxes: GeoExtent[] = [];
  for (const ref of referencedRegionIds) {
    const bb = featureBbox(data.usStates, ref.id);
    if (bb) regionBoxes.push(bb);
  }
  // country regions contribute their country bbox — but framed on the dominant
  // landmass, ignoring far-detached minor territories (e.g. French Guiana) so a
  // Europe map naming France doesn't auto-fit across the Atlantic (R5).
  for (const r of regions) {
    if (r.layer === 'country') {
      const bb = featureBboxPrimary(data.worldCoarse, r.iso);
      if (bb) regionBoxes.push(bb);
    }
  }
  const points: Array<[number, number]> = pois.map((p) => [p.lon, p.lat]);
  const unioned = unionExtent(regionBoxes, points);
  const DEFAULT_EXTENT: GeoExtent = [
    [-180, -85],
    [180, 85],
  ];
  let extent: GeoExtent = unioned ? pad(unioned, PAD_FRACTION) : DEFAULT_EXTENT; // empty → default

  const lonSpan = extent[1][0] - extent[0][0];
  const latSpan = extent[1][1] - extent[0][1];
  const span = Math.max(lonSpan, latSpan);
  const maxAbsLat = Math.max(Math.abs(extent[0][1]), Math.abs(extent[1][1]));
  // albers-usa only covers US territory: choose it only when the map is truly
  // US-only — no non-US country region AND no POI outside the US (#13). Without
  // the POI guard a `default-country US` + Tokyo map projected to garbage.
  // albers-usa is the US-only composite projection — it insets AK/HI and clips
  // out all non-US land. Use it only when the map actually renders US STATES (an
  // explicit `region us-states` or US-state region fills), NOT merely because the
  // POIs happen to be US: a pure POI/route map across the US should stay on a
  // geographic projection so neighbour land (Mexico, Central America, the
  // Caribbean, Canada) still draws.
  const usDominant =
    (subdivisions.includes('us-states') ||
      regions.some((r) => r.layer === 'us-state')) &&
    !regions.some((r) => r.layer === 'country' && r.iso !== 'US') &&
    !anyNonUsPoi;

  let projection: ProjectionFamily;
  const override = parsed.directives.projection;
  if (
    override === 'equirectangular' ||
    override === 'natural-earth' ||
    override === 'albers-usa' ||
    override === 'mercator'
  ) {
    projection = override;
  } else if (usDominant) {
    projection = 'albers-usa';
  } else if (span > WORLD_SPAN || maxAbsLat > MERCATOR_MAX_LAT) {
    // World/multi-continent scale (or a polar-reaching frame): equirectangular
    // fills the frame edge-to-edge, never clips the continents at the boundary
    // (naturalEarth's curved sides overrun a corner-based fit), and avoids
    // Mercator's gross sec(φ) area blow-up near the poles. `projection
    // natural-earth` opts back into the curved look explicitly.
    projection = 'equirectangular';
  } else {
    // Tight clusters AND single-continent regional views: Mercator gives every
    // mid-latitude landmass its familiar conventional shape (equirectangular
    // squashes a continent like Europe horizontally).
    projection = 'mercator';
  }

  // World-scale framing (R10): a multi-continent spread frames most cleanly as
  // the conventional Greenwich-centred world rectangle. The tight-arc longitude
  // union is unstable for sparse global points — and an antimeridian-crossing
  // country box (the US, via its Aleutians) wraps the union to an Asia-centred
  // window that splits the Americas at the seam. When the data occupies at
  // least half the globe in longitude, snap to full longitude AND widen the
  // latitude band to the populated world (≈ Tierra del Fuego → northern
  // Russia/Canada) so the map reads as a standard world view with every
  // continent shown — not a thin band cropped to the data's latitudes (which
  // would slice off South Africa, southern Argentina, northern Russia, …). The
  // ≥180° gate leaves regional spreads tight — `region` continents (Europe
  // ≈70°, Asia ≈155°) and antimeridian clusters (mercator anyway) untouched.
  // Applies to both world projections (equirectangular default + natural-earth).
  if (lonSpan >= 180) {
    extent = [
      [-180, Math.min(extent[0][1], WORLD_LAT_SOUTH)],
      [180, Math.max(extent[1][1], WORLD_LAT_NORTH)],
    ];
  }

  result.regions = regions;
  result.pois = pois;
  result.edges = edges;
  result.routes = routes;
  result.basemaps = {
    world: span > WORLD_SPAN ? 'coarse' : 'detail',
    subdivisions,
  };
  result.extent = extent;
  result.projection = projection;
  result.error = parsed.error ?? firstError(diagnostics);
  // `Writable` widens the GeoExtent tuple to an array; the runtime value is a
  // correct GeoExtent, so cast back on return (through unknown — tuple vs array).
  return result as unknown as ResolvedMap;
}

function mostCommonCountry(
  regions: ResolvedRegion[],
  poiCountries: string[]
): string | undefined {
  const counts = new Map<string, number>();
  for (const r of regions) {
    const iso = r.layer === 'us-state' ? 'US' : r.iso;
    counts.set(iso, (counts.get(iso) ?? 0) + 1);
  }
  // Pass-A-resolved POI countries now count too (#3): a POI-only US map infers
  // `default-country=US`.
  for (const iso of poiCountries) {
    counts.set(iso, (counts.get(iso) ?? 0) + 1);
  }
  // Iterate alphabetically and keep on strictly-greater count, so a tie resolves
  // to the alphabetically-first ISO — deterministic (#14).
  let best: string | undefined;
  let bestN = 0;
  for (const [iso, n] of [...counts.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1
  )) {
    if (n > bestN) {
      bestN = n;
      best = iso;
    }
  }
  return best;
}

function pad(e: GeoExtent, frac: number): GeoExtent {
  const dLon = (e[1][0] - e[0][0]) * frac || 1;
  const dLat = (e[1][1] - e[0][1]) * frac || 1;
  return [
    [Math.max(-180, e[0][0] - dLon), Math.max(-90, e[0][1] - dLat)],
    [Math.min(540, e[1][0] + dLon), Math.min(90, e[1][1] + dLat)],
  ] as GeoExtent;
}

function firstError(diags: DgmoError[]): string | null {
  const e = diags.find((d) => d.severity === 'error');
  return e ? formatDgmoError(e) : null;
}
