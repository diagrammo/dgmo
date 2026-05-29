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
  ProjectionFamily,
  GeoExtent,
} from './resolved-types';
import { featureIndex, featureBbox, unionExtent, fold } from './geo';

// Projection / tier thresholds (degrees of span) — tunable (R10).
const WORLD_SPAN = 90;
const MERCATOR_MAX_SPAN = 25;
const PAD_FRACTION = 0.05;

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
    directives: parsed.directives,
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
    parsed.pois.some(
      (p) => p.pos.kind === 'name' && p.pos.scope?.startsWith('US-')
    );

  // ── Regions (R2/R12) ──
  const regions: ResolvedRegion[] = [];
  const seenRegion = new Map<string, number>(); // iso → index in regions
  let usSubdivisionReferenced = false;
  const referencedRegionIds: { topo: 'us'; id: string }[] = [];
  for (const r of parsed.regions) {
    const f = fold(r.name);
    const inCountry = countryIndex.get(f);
    const inState = usStateIndex.get(f);
    let chosen: {
      id: string;
      name: string;
      layer: 'country' | 'us-state';
    } | null = null;
    if (inCountry && inState) {
      if (usScoped) {
        chosen = { ...inState, layer: 'us-state' };
      } else {
        chosen = { ...inCountry, layer: 'country' };
      }
      warn(
        r.lineNumber,
        `"${r.name}" is both a country and a US state — resolved as ${chosen.layer} (${chosen.id}).`,
        'W_MAP_REGION_AMBIGUOUS'
      );
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
      ...(r.score !== undefined && { score: r.score }),
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
    if (registry.has(id)) {
      warn(
        line,
        `Duplicate POI "${id}" — last definition wins.`,
        'W_MAP_DUPLICATE_POI'
      );
      const existing = registry.get(id)!;
      const idx = pois.indexOf(existing);
      if (idx >= 0) pois[idx] = poi;
    } else {
      pois.push(poi);
    }
    registry.set(id, poi);
  };

  /** Resolve a name (+optional scope) against the gazetteer. */
  const lookupName = (
    name: string,
    scope: string | undefined,
    line: number,
    scopeHint: string | undefined,
    allowAmbiguous: boolean
  ): { lat: number; lon: number } | null => {
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
      return null;
    }
    let cands = idxs.map((i) => data.gazetteer.cities[i]!);
    const scopeUse = scope ?? scopeHint;
    if (scopeUse) {
      const isSub = scopeUse.includes('-');
      const filtered = cands.filter((c) =>
        isSub ? c[5] === scopeUse : c[2] === scopeUse
      );
      if (filtered.length) cands = filtered;
      else if (scope) {
        err(line, `No "${name}" found in scope ${scope}.`, 'E_MAP_SCOPE_MISS');
        return null;
      }
    }
    if (cands.length > 1) {
      if (!allowAmbiguous && !scopeUse) {
        // deferred to pass B
        return null;
      }
      // most-populous; tie-break lowest index (R11)
      cands = [...cands].sort((a, b) => b[3] - a[3]);
      if (!scope)
        warn(
          line,
          `"${name}" is ambiguous — resolved to the most-populous match.`,
          'I_MAP_AMBIGUOUS_NAME'
        );
    }
    const c = cands[0]!;
    return { lat: c[0], lon: c[1] };
  };

  const poiIdFor = (pos: PoiPos, alias: string | undefined): string => {
    if (alias) return fold(alias);
    if (pos.kind === 'coords') return `@${pos.lat},${pos.lon}`;
    return fold(pos.name);
  };

  // Pass A: coords + scoped + single-candidate (unambiguous). Defer ambiguous.
  const deferred: (typeof parsed.pois)[number][] = [];
  for (const p of parsed.pois) {
    if (p.pos.kind === 'coords') {
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
    if (got) addResolvedPoi(got.lat, got.lon, p);
    else if (!hasError(p.lineNumber)) deferred.push(p); // ambiguous, not an error → pass B
  }

  // Infer default-country from explicit directive or the most common ISO seen.
  const inferredCountry =
    parsed.directives.defaultCountry?.toUpperCase() ??
    mostCommonCountry(regions, pois) ??
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
    if (got) addResolvedPoi(got.lat, got.lon, p);
  }

  function addResolvedPoi(
    lat: number,
    lon: number,
    p: (typeof parsed.pois)[number]
  ): void {
    const id = poiIdFor(p.pos, p.alias);
    const poi: Writable<ResolvedPoi> = {
      id,
      lat,
      lon,
      ...(p.label !== undefined && { label: p.label }),
      tags: p.tags,
      meta: p.meta,
      lineNumber: p.lineNumber,
    };
    registerPoi(id, poi, p.lineNumber);
  }

  // ── Edges + routes: bind endpoints, create implicit POIs (R7/R8) ──
  const resolveEndpoint = (ref: string, line: number): string | null => {
    const f = fold(ref);
    if (registry.has(f)) return f;
    const got = lookupName(ref, undefined, line, inferredCountry, true);
    if (!got) return null;
    const poi: Writable<ResolvedPoi> = {
      id: f,
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

  const routes: ResolvedRoute[] = [];
  for (const rt of parsed.routes) {
    const stopIds: string[] = [];
    for (const stop of rt.stops) {
      let id: string | null;
      if (stop.ref.kind === 'coords') {
        id = stop.alias ? fold(stop.alias) : `@${stop.ref.lat},${stop.ref.lon}`;
        if (!registry.has(id)) {
          const poi: Writable<ResolvedPoi> = {
            id,
            lat: stop.ref.lat,
            lon: stop.ref.lon,
            tags: {},
            meta: stop.meta,
            lineNumber: stop.lineNumber,
            implicit: true,
          };
          registerPoi(id, poi, stop.lineNumber);
        }
      } else {
        id =
          stop.alias && registry.has(fold(stop.alias))
            ? fold(stop.alias)
            : resolveEndpoint(stop.ref.name, stop.lineNumber);
      }
      if (id) stopIds.push(id);
    }
    routes.push({ stopIds, meta: rt.meta, lineNumber: rt.lineNumber });
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
  // country regions contribute their country bbox
  for (const r of regions) {
    if (r.layer === 'country') {
      const bb = featureBbox(data.worldCoarse, r.iso);
      if (bb) regionBoxes.push(bb);
    }
  }
  const points: Array<[number, number]> = pois.map((p) => [p.lon, p.lat]);
  const unioned = unionExtent(regionBoxes, points);
  const DEFAULT_EXTENT: GeoExtent = [
    [-180, -85],
    [180, 85],
  ];
  const extent: GeoExtent = unioned
    ? pad(unioned, PAD_FRACTION)
    : DEFAULT_EXTENT; // empty → default

  const lonSpan = extent[1][0] - extent[0][0];
  const latSpan = extent[1][1] - extent[0][1];
  const span = Math.max(lonSpan, latSpan);
  const usDominant =
    (inferredCountry === 'US' || subdivisions.includes('us-states')) &&
    !regions.some((r) => r.layer === 'country' && r.iso !== 'US');

  let projection: ProjectionFamily;
  const override = parsed.directives.projection;
  if (
    override === 'natural-earth' ||
    override === 'albers-usa' ||
    override === 'mercator'
  ) {
    projection = override;
  } else if (usDominant) {
    projection = 'albers-usa';
  } else if (span > WORLD_SPAN) {
    projection = 'natural-earth';
  } else if (span < MERCATOR_MAX_SPAN) {
    projection = 'mercator';
  } else {
    projection = 'natural-earth';
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

  function hasError(line: number): boolean {
    return diagnostics.some((d) => d.severity === 'error' && d.line === line);
  }
}

function mostCommonCountry(
  regions: ResolvedRegion[],
  pois: ResolvedPoi[]
): string | undefined {
  const counts = new Map<string, number>();
  for (const r of regions) {
    const iso = r.layer === 'us-state' ? 'US' : r.iso;
    counts.set(iso, (counts.get(iso) ?? 0) + 1);
  }
  // POI ISO isn't stored on ResolvedPoi; country inference leans on regions +
  // explicit scope. (POIs already resolved unambiguously in pass A.)
  void pois;
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
