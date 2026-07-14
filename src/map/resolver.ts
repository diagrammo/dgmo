// Resolver (step 3): ParsedMap + MapData → ResolvedMap. SYNCHRONOUS + PURE
// (deterministic, no I/O — the async asset load lives in ./load-data.ts; DI).
// Resolves region names → ISO geometry, POI/endpoint names → coords, infers the
// basemap/scope/extent/projection, and emits resolved-identity diagnostics. See
// §24B.2/.8/.10 and the tech-spec adversarial resolutions R1–R19.
import { emit, formatDgmoError, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { MAP_DX } from './diagnostics';
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
  decodeFeatures,
  regionAt,
} from './geo';
import {
  isValidZone,
  parseFixedOffset,
  formatOffsetLabel,
} from '../clock/resolve';

/** Discriminated result of a gazetteer name lookup (#5): `defer` is "ambiguous,
 *  retry in pass B with inferred scope" — distinct from `miss` (errored, drop) so
 *  pass-A deferral never has to infer state from unrelated same-line diagnostics. */
type LookupResult =
  | { kind: 'ok'; lat: number; lon: number; iso: string; tz?: string }
  | { kind: 'defer' }
  | { kind: 'miss' };

// Projection / tier thresholds (degrees of span) — tunable (R10).
const WORLD_SPAN = 90;
// Mercator is used for everything sub-world (tight clusters AND single-continent
// regional views — a mid-latitude continent reads with its familiar conventional
// shape). Two guards push back to the equirectangular world projection: a
// world/multi-continent `span` (> WORLD_SPAN), or
// a frame that reaches into polar latitudes (> MERCATOR_MAX_LAT) where Mercator's
// sec(φ) area blow-up turns gross. Europe (≈71°N) and East Asia stay on Mercator.
const MERCATOR_MAX_LAT = 80;
const PAD_FRACTION = 0.05;
// Region/choropleth maps frame to the NAMED countries/states; a tight 5% pad cuts
// the surrounding continent right at the data edge (a Europe choropleth stops at
// ~31°E, slicing off western Russia/Ukraine). A larger pad lets the neighbouring
// land peek in as gray context for orientation. POI maps keep the tight pad — they
// already get container-region framing + the zoom floor.
const REGION_PAD_FRACTION = 0.12;
// Latitude band for a snapped world view — Tierra del Fuego (≈ −55°) to northern
// Russia/Canada (≈ +78°). Excludes most of Antarctica + the high Arctic so the
// populated continents fill the frame rather than waste it on ice.
const WORLD_LAT_SOUTH = -58;
const WORLD_LAT_NORTH = 78;
// Tightest zoom for a POI-only cluster: never frame narrower than this many
// degrees on the longer axis. The basemap is state/country geometry only (no
// counties/cities/roads), so a metro-scale frame is an empty box — clamp up to a
// multi-state window that always shows coastline + a state outline or two around
// the dots. A tight cluster (e.g. Bay Area cities) therefore frames as ≈ its
// home state + neighbours rather than the whole nation. Tunable.
const POI_ZOOM_FLOOR_DEG = 7;
// POI-only container framing reveals the region(s) that CONTAIN the dots, but a
// single POI near the edge of a tall/wide country (e.g. Cartagena at the north
// tip of Colombia) would otherwise drag the frame to that country's far edge —
// all the way to the Amazon, ~15° below the southernmost dot. Clamp the container
// union so it reveals at most `containerOvershoot(cluster)` degrees of container
// BEYOND the POI cluster on each side: northern Colombia stays for orientation,
// the empty interior is cropped.
//
// For NON-US clusters the overshoot SHRINKS as the cluster grows (tuned
// 2026-06-19). A tiny cluster has no context of its own, so it keeps the full MAX
// (8°) — enough to reveal its whole modest container (e.g. a small European
// country). A LARGE cluster already supplies its own context, so a fixed 8° just
// padded a huge container with empty land (a Ukraine/Russia strike map framed
// ~2.4× the cluster, a wide dead band above the dots). Linearly decaying the
// overshoot to MIN (3°) tightens big clusters (~1.7× cluster) without cropping
// small ones. The POI_ZOOM_FLOOR_DEG floor still guards the lower bound.
//
// US-ORIENTED maps are EXEMPT (keep the flat MAX): the national-vs-regional
// projection gate (US_NATIONAL_LON_SPAN, albers-usa vs regional Mercator) is
// calibrated against the 8°-overshoot frame span — a coast-to-Caribbean US cruise
// route clears the national threshold only because the west overshoot reaches ~8°
// past Denver. Shrinking it there would silently flip such maps off albers-usa.
// US containers (a state, CONUS) aren't the huge-empty-container problem anyway.
const CONTAINER_OVERSHOOT_MAX = 8;
const CONTAINER_OVERSHOOT_MIN = 3;
// Degrees of overshoot shed per degree of cluster span (larger span ⇒ less slack).
const CONTAINER_OVERSHOOT_DECAY = 0.3;

/** Per-cluster container overshoot (deg). US-oriented maps keep the flat MAX (the
 *  albers-usa national gate is calibrated to it); other maps get full MAX for a
 *  tight cluster, decaying to MIN for a large one. `span` = the cluster's larger
 *  lon/lat extent. */
function containerOvershoot(span: number, usOriented: boolean): number {
  if (usOriented) return CONTAINER_OVERSHOOT_MAX;
  return Math.max(
    CONTAINER_OVERSHOOT_MIN,
    Math.min(
      CONTAINER_OVERSHOOT_MAX,
      CONTAINER_OVERSHOOT_MAX - CONTAINER_OVERSHOOT_DECAY * span
    )
  );
}
// Above this longitudinal span a US POI-only extent is "national" — use the
// albers-usa composite (CONUS conic + AK/HI insets) instead of regional Mercator.
// CONUS spans ≈58° lon; 48° is "most of the country". Tunable.
const US_NATIONAL_LON_SPAN = 48;
// Sub-national US auto-zoom (map-us-subnational-zoom). A US region/choropleth map
// whose authored data occupies a geographically COMPACT slice of the country
// zooms to that slice (conic-equal-area, like every non-US regional view) instead
// of always framing the whole nation on albers-usa. "Compact" = the raw data bbox
// covers less than US_SUBNATIONAL_AREA_FRACTION of the CONUS bbox AREA. Area (not
// lon-span) is used so a near-national diagonal (e.g. WA+FL) stays national while
// a tight cluster (the Northeast) or a tall corridor zooms. CONUS_BBOX ≈ the
// contiguous 48 (≈1416 deg²); the fraction bisects the empty gap between a
// regional cluster (≲0.15) and a national map (≳0.9). Tunable.
const CONUS_BBOX: GeoExtent = [
  [-125, 25],
  [-66, 49],
];
const US_SUBNATIONAL_AREA_FRACTION = 0.4;

/** Rectangular (lon×lat) area of a bbox in deg² — NOT d3 `geoArea` (spherical).
 *  The gate frames with a lon/lat bbox anyway, so a planar ratio is the honest
 *  measure of "how much of the country does this occupy". */
function bboxArea(b: GeoExtent): number {
  return (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]);
}

/** True when a US data extent is compact enough to zoom to (sub-national) rather
 *  than frame the whole nation. Pure + side-effect-free (unit-tested in isolation
 *  with no fixtures/render). Pass the RAW unpadded data-union bbox, not the padded
 *  framing extent — the fraction is calibrated on raw data bboxes. */
export function isSubNationalUsExtent(bbox: GeoExtent | null): boolean {
  if (!bbox) return false;
  return bboxArea(bbox) / bboxArea(CONUS_BBOX) < US_SUBNATIONAL_AREA_FRACTION;
}

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

/** Classifies a bare-coordinate POI as a North-American neighbour (vs a far-away
 *  blocker) when deciding `albers-usa`. Used only for bare coords — named POIs
 *  carry an ISO. This deliberately only covers what `looksUS`'s broad box does
 *  NOT: the Atlantic-Canada strip east of −64° (Newfoundland/Labrador/Nova
 *  Scotia, e.g. St. John's at −52.7) which falls outside `looksUS`'s
 *  [−180, −64] longitude window. Most of Canada and all of Mexico already pass
 *  `looksUS` (their lon is ≤ −64, lat ≥ 15) so they never reach here. The
 *  latitude is capped at 72° (matching `looksUS`) so a high-Arctic coord is NOT
 *  treated as a neighbour — that would both distort the conus fit and collide
 *  with the Alaska inset bbox (`inAlaska`, lat ≥ 51 ∧ lon ≤ −129). NOTE: the
 *  east strip can also catch the SE-Greenland coast (rare, acceptable; named
 *  GL/DK POIs are unaffected since they classify by ISO). */
function looksNorthAmericaNeighbor(lat: number, lon: number): boolean {
  return lat >= 14 && lat <= 72 && lon >= -141 && lon <= -52;
}

/** A bbox that (near-)spans the whole globe — the sentinel spherical geoBounds
 *  returns for a malformed/missing feature. Such a box is useless for framing. */
function isWholeSphere(bb: GeoExtent): boolean {
  return (
    bb[0][0] <= -179 && bb[1][0] >= 179 && bb[0][1] <= -89 && bb[1][1] >= 89
  );
}

export function resolveMap(parsed: ParsedMap, data: MapData): ResolvedMap {
  const diagnostics: DgmoError[] = [...parsed.diagnostics]; // seed with parse diags (R14)
  // Folded tokens already flagged as "city shadows an airport code" — emit the
  // W_MAP_AIRPORT_SHADOWED_BY_CITY hint at most once per code (ADR-2, F9).
  const shadowedAirports = new Set<string>();

  const result: Writable<ResolvedMap> = {
    title: parsed.title,
    ...(parsed.directives.caption !== undefined && {
      caption: parsed.directives.caption,
    }),
    tagGroups: [...parsed.tagGroups],
    // Shallow-copy so the resolved model never aliases the parser's mutable
    // directives object (#11). NOTE: tag→region-fill COLOR binding is the
    // renderer's job (step 4) — the resolver only carries `tags` + `tagGroups`
    // through; it never resolves a tag value to a palette color (#10).
    directives: { ...parsed.directives },
    basemaps: { world: 'detail', subdivisions: [] },
    regions: [],
    pois: [],
    edges: [],
    routes: [],
    extent: [
      [-180, -85],
      [180, 85],
    ] as GeoExtent,
    projection: 'equirectangular',
    poiFrameContainers: [],
    diagnostics,
    error: parsed.error,
  };

  // Per-layer indexes (never merged — R12; coarse is the authoritative name
  // index, ids shared with detail — R13). LOAD-BEARING: `worldCoarse` (110m) is
  // NOT used for rendering anymore (the world basemap is pinned to detail/50m,
  // see basemaps assignment below) — it is retained solely as this name index
  // (featureIndex) and the dominant-landmass bbox source (featureBboxPrimary).
  // Do not delete it.
  const countryIndex = featureIndex(data.worldCoarse);
  const usStateIndex = featureIndex(data.usStates);
  const allNames = [
    ...[...countryIndex.values()].map((v) => v.name),
    ...[...usStateIndex.values()].map((v) => v.name),
  ];

  // ── locale <ISO> → country + optional subdivision (§24B.8) ──
  const localeRaw = parsed.directives.locale?.toUpperCase();
  const localeCountry = localeRaw ? localeRaw.split('-')[0] : undefined;
  const localeSubdivision =
    localeRaw && /^[A-Z]{2}-/.test(localeRaw) ? localeRaw : undefined;

  // ── US-scope signal (drives the country-vs-state collision, R2) ──
  const usScoped =
    localeCountry === 'US' ||
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
  // AK/HI national guard (map-us-subnational-zoom): a choropleth that colors
  // Alaska or Hawaii is inherently a national composite map (the insets only make
  // sense on albers-usa), so it never sub-national auto-zooms. Tracked ISO-based
  // here because `referencedRegionIds` is not in scope at the projection block.
  let hasAlaskaRef = false;
  let hasHawaiiRef = false;
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
          diagnostics.push(
            emit(MAP_DX.SCOPE_MISS, r.lineNumber, {
              name: r.name,
              scope,
              iso: inState.id,
            })
          );
          continue;
        }
        chosen = { ...inState, layer: 'us-state' };
      } else if (!wantsState && inCountry) {
        chosen = { ...inCountry, layer: 'country' };
      } else {
        diagnostics.push(
          emit(MAP_DX.SCOPE_MISS, r.lineNumber, { name: r.name, scope })
        );
        continue;
      }
    } else if (inCountry && inState) {
      if (usScoped) {
        // A US scope (e.g. `locale US`) makes the state the unambiguous
        // intent — resolve silently, no disambiguation warning needed.
        chosen = { ...inState, layer: 'us-state' };
      } else {
        chosen = { ...inCountry, layer: 'country' };
        // Teach the disambiguation syntax so the author can pin it explicitly.
        // Suggest the non-redundant forms: a bare ISO code, or name + scope.
        diagnostics.push(
          emit(MAP_DX.REGION_AMBIGUOUS, r.lineNumber, {
            name: r.name,
            layer: chosen.layer,
            chosenId: chosen.id,
            stateId: inState.id,
            countryId: inCountry.id,
          })
        );
      }
    } else if (inState) {
      chosen = { ...inState, layer: 'us-state' };
    } else if (inCountry) {
      chosen = { ...inCountry, layer: 'country' };
    }
    if (!chosen) {
      const hint = suggest(r.name, allNames);
      diagnostics.push(
        emit(MAP_DX.UNKNOWN_SUBDIVISION, r.lineNumber, { name: r.name, hint })
      );
      continue;
    }
    if (chosen.layer === 'us-state') {
      usSubdivisionReferenced = true;
      if (chosen.id === 'US-AK') hasAlaskaRef = true;
      if (chosen.id === 'US-HI') hasHawaiiRef = true;
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
      diagnostics.push(
        emit(MAP_DX.DUPLICATE_REGION, r.lineNumber, { name: chosen.name })
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
        diagnostics.push(emit(MAP_DX.DUPLICATE_POI, line, { id }));
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
      // Airports are the LOWEST-precedence identifier tier (ADR-2): consulted
      // only after city `byName` + `alt` miss, so a real city always wins a
      // shared token. Exact folded-code match — never defers. Returns just
      // {lat,lon,iso} like a city; the POI renders the user's typed token ("JFK")
      // as its label, so there is no airport-specific label work.
      const airIdx = data.airports?.airportIata?.[f];
      if (airIdx !== undefined) {
        const a = data.airports!.airports[airIdx];
        if (a) return { kind: 'ok', lat: a[0], lon: a[1], iso: a[2] };
      }
      // A 3-letter token that resolved to neither a city nor a bundled airport is
      // almost always an airport code the set doesn't cover — give the targeted
      // hint (with the `as XXX` coords escape hatch) instead of the generic miss.
      if (/^[A-Za-z]{3}$/.test(name)) {
        const code = name.toUpperCase();
        diagnostics.push(emit(MAP_DX.UNKNOWN_AIRPORT_CODE, line, { code }));
        return { kind: 'miss' };
      }
      const cityNames = data.gazetteer.cities.map((c) => c[4]);
      const hint = suggest(name, cityNames);
      diagnostics.push(emit(MAP_DX.UNKNOWN_PLACE, line, { name, hint }));
      return { kind: 'miss' };
    }
    // Keep each candidate's gazetteer index so the resolved city's IANA zone
    // (`gazetteer.tz[i]` → `gazetteer.zones[…]`, BL-122) can ride back out.
    let cands = idxs.map((i) => ({ i, c: data.gazetteer.cities[i]! }));
    const scopeUse = scope ?? scopeHint;
    if (scopeUse) {
      // ISO 3166-2 subdivision scope is `XX-…` (two letters + dash). A bare
      // two-letter token that names a US state resolves as the `US-XX`
      // subdivision (`CA` = California, §24B.8) — NOT the colliding country
      // code; any other bare two-letter token is a 3166-1 country code.
      const bareState = usStateFromBareScope(scopeUse);
      const subScope = /^[A-Za-z]{2}-/.test(scopeUse) ? scopeUse : bareState;
      const filtered = cands.filter(({ c }) =>
        subScope ? c[5] === subScope : c[2] === scopeUse
      );
      if (filtered.length) cands = filtered;
      else if (scope) {
        diagnostics.push(
          emit(MAP_DX.SCOPE_MISS, line, { name, scope, place: true })
        );
        return { kind: 'miss' };
      }
    }
    if (cands.length > 1) {
      if (!allowAmbiguous && !scopeUse) {
        return { kind: 'defer' }; // ambiguous, no scope → pass B
      }
      // most-populous; tie-break lowest index (R11 — byName is NOT pop-ordered).
      cands = [...cands].sort((a, b) => b.c[3] - a.c[3]);
      if (!scope) diagnostics.push(emit(MAP_DX.AMBIGUOUS_NAME, line, { name }));
    }
    const { i: cityIdx, c } = cands[0]!;
    // Shadow hint (ADR-2/F9): the token resolved to a city but is ALSO a bundled
    // IATA code (e.g. `Ufa` city vs UFA airport). Non-blocking, once per code, and
    // only for the `byName` overlap set (an `alt`-alias hit whose key differs from
    // the IATA fold is not flagged — a documented limit).
    if (
      data.airports?.airportIata?.[f] !== undefined &&
      !shadowedAirports.has(f)
    ) {
      shadowedAirports.add(f);
      const code = name.toUpperCase();
      diagnostics.push(
        emit(MAP_DX.AIRPORT_SHADOWED_BY_CITY, line, { name, code })
      );
    }
    const zoneId = data.gazetteer.tz?.[cityIdx];
    const gazTz =
      zoneId !== undefined && zoneId >= 0
        ? data.gazetteer.zones?.[zoneId]
        : undefined;
    return {
      kind: 'ok',
      lat: c[0],
      lon: c[1],
      iso: c[2],
      ...(gazTz !== undefined && { tz: gazTz }),
    };
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
  let anyUsPoi = false;
  // `anyNonNaPoi` = a POI outside North America (not US/CA/MX). Gates the relaxed
  // US-orientation test (#13): US + Canada/Mexico content keeps `albers-usa`, but
  // anything beyond NA forces a geographic projection that frames all content.
  let anyNonNaPoi = false;
  const noteCountry = (iso: string | undefined): void => {
    if (iso) {
      poiCountries.push(iso);
      if (iso === 'US') anyUsPoi = true;
      if (iso !== 'US' && iso !== 'CA' && iso !== 'MX') anyNonNaPoi = true;
    }
  };

  // Pass A: coords + scoped + single-candidate (unambiguous). Defer ambiguous.
  const deferred: (typeof parsed.pois)[number][] = [];
  for (const p of parsed.pois) {
    if (p.pos.kind === 'coords') {
      if (looksUS(p.pos.lat, p.pos.lon)) anyUsPoi = true;
      else if (!looksNorthAmericaNeighbor(p.pos.lat, p.pos.lon))
        anyNonNaPoi = true;
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
      addResolvedPoi(got.lat, got.lon, p, got.tz);
    } else if (got.kind === 'defer') {
      deferred.push(p); // ambiguous, not an error → pass B
    }
    // `miss` already errored; drop.
  }

  // Infer default-country from explicit directive or the most common ISO across
  // resolved regions AND Pass-A POIs (#3 — POIs were previously voided, so a
  // POI-only US map never inferred US).
  const inferredCountry =
    localeCountry ?? mostCommonCountry(regions, poiCountries) ?? undefined;
  // A `locale US-GA` subdivision further scopes ambiguous bare cities to that
  // state (soft preference — see lookupName); else fall back to the country.
  const inferredScope = localeSubdivision ?? inferredCountry;

  // Pass B: ambiguous bare names, scoped by the inferred locale.
  for (const p of deferred) {
    if (p.pos.kind !== 'name') continue;
    const got = lookupName(
      p.pos.name,
      p.pos.scope,
      p.lineNumber,
      inferredScope,
      true
    );
    if (got.kind === 'ok') {
      noteCountry(got.iso);
      addResolvedPoi(got.lat, got.lon, p, got.tz);
    }
  }

  function addResolvedPoi(
    lat: number,
    lon: number,
    p: (typeof parsed.pois)[number],
    gazTz?: string
  ): void {
    const id = poiIdFor(p.pos, p.alias);
    const name = p.pos.kind === 'name' ? p.pos.name : p.alias;
    const tz = resolveTz(p, gazTz);
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
      ...(tz !== undefined && { tz: tz.zone }),
      ...(tz?.fixedOffsetMin !== undefined && {
        tzFixedOffsetMin: tz.fixedOffsetMin,
      }),
    };
    registerPoi(id, poi, p.lineNumber);
  }

  /** BL-122 clock channel: resolve the IANA zone for a POI flagged `clock`.
   *  The place determines the zone — a named city inherits `gazTz` (the
   *  gazetteer's GeoNames zone). An explicit `tz:` is an OVERRIDE, required only
   *  for bare-coord pins (no gazetteer entry) and honored elsewhere (with a warn
   *  if it contradicts the city's known zone). Accepts a fixed offset (`UTC+9`,
   *  DST-blind) or an IANA id. Returns undefined (no card) when the pin isn't
   *  flagged, or is flagged but has neither an override nor a derivable zone. */
  function resolveTz(
    p: (typeof parsed.pois)[number],
    gazTz: string | undefined
  ): { zone: string; fixedOffsetMin?: number } | undefined {
    if (!p.clock) return undefined;
    const raw = p.meta['tz']?.trim();
    const line = p.lineNumber;
    if (raw) {
      const off = parseFixedOffset(raw);
      if (off !== null)
        return { zone: formatOffsetLabel(off), fixedOffsetMin: off };
      if (isValidZone(raw)) {
        // A named city whose explicit tz contradicts its real zone is almost
        // always a mistake (`poi Denver tz: UTC`) — flag it, but honor the
        // author's override.
        if (gazTz && raw !== gazTz)
          diagnostics.push(
            emit(MAP_DX.CLOCK_TZ_OVERRIDE, line, { name: raw, tz: gazTz })
          );
        return { zone: raw };
      }
      diagnostics.push(emit(MAP_DX.CLOCK_TZ_INVALID, line, { name: raw }));
      return undefined;
    }
    if (gazTz) return { zone: gazTz };
    // Flagged `clock` but no zone to be had: a bare-coord pin (or the rare city
    // GeoNames didn't zone). Renders the marker, no card — tell the author how.
    diagnostics.push(emit(MAP_DX.CLOCK_TZ_NEEDED, line, {}));
    return undefined;
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
  // A route/edge may also reference a POI by its display `label:` — humans reuse
  // what they SEE on the map, not an alias they have to invent. Map folded label
  // → id, but only when unique: a label shared by ≥2 POIs is ambiguous, and a
  // reference to it errors (asking for an `as <alias>`) rather than silently
  // binding to an arbitrary one. Label lookup sits BELOW id/name/alias and ABOVE
  // the gazetteer (declared content wins over an implicit geocode).
  const declaredByLabel = new Map<string, string>();
  const ambiguousLabel = new Set<string>();
  for (const p of pois) {
    const fl = p.label ? fold(p.label) : undefined;
    if (!fl) continue;
    if (declaredByLabel.has(fl)) ambiguousLabel.add(fl);
    else declaredByLabel.set(fl, p.id);
  }
  // Resolve a reference against declared POI labels. Returns the id, or 'ambiguous'
  // when ≥2 POIs share the label (caller errors), or undefined for no match.
  const resolveByLabel = (f: string): string | 'ambiguous' | undefined => {
    if (ambiguousLabel.has(f)) return 'ambiguous';
    return declaredByLabel.get(f);
  };
  const resolveEndpoint = (ref: string, line: number): string | null => {
    const f = fold(ref);
    if (registry.has(f)) return f;
    const aliased = declaredByName.get(f);
    if (aliased) return aliased;
    const byLabel = resolveByLabel(f);
    if (byLabel === 'ambiguous') {
      diagnostics.push(emit(MAP_DX.AMBIGUOUS_LABEL, line, { name: ref }));
      return null;
    }
    if (byLabel) return byLabel;
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
      tags: e.tags,
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
      if (looksUS(pos.lat, pos.lon)) anyUsPoi = true;
      else if (!looksNorthAmericaNeighbor(pos.lat, pos.lon)) anyNonNaPoi = true;
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
    const byLabel = resolveByLabel(f);
    if (byLabel === 'ambiguous') {
      diagnostics.push(emit(MAP_DX.AMBIGUOUS_LABEL, line, { name: pos.name }));
      return null;
    }
    if (byLabel) return byLabel;
    const got = lookupName(pos.name, pos.scope, line, inferredScope, true);
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
        {}, // a leg tag colours the LINE (§24B.6), not the destination stop
        undefined, // a leg's `width:` is leg thickness, not the dest's size
        leg.lineNumber
      );
      if (!destId) continue; // ungeocodable destination → skip this leg
      legs.push({
        fromId: prevId,
        toId: destId,
        ...(leg.label !== undefined && { label: leg.label }),
        style: leg.style,
        ...(leg.value !== undefined && { value: leg.value }),
        tags: leg.tags,
        lineNumber: leg.lineNumber,
      });
      if (!stopIds.includes(destId)) stopIds.push(destId); // unique markers (loop-close dedupe)
      prevId = destId;
    }
    routes.push({ stopIds, legs, lineNumber: rt.lineNumber });
  }

  // ── Basemaps + scope ──
  // "US-oriented" = there is US content AND all other content stays within North
  // America (US, Canada, or Mexico — no non-NA POI, no non-US/CA/MX country
  // fill). Such a map renders as the conventional US states map: the full state
  // mesh on albers-usa, every state outlined even with no data — including a
  // POI-only named-city map (§24B.2), and now also a US map with a Canadian or
  // Mexican neighbour POI/fill (the neighbour is framed alongside, never clipped).
  // "Has US content" is STATE-level (a US state fill, a US POI, or `locale US`)
  // — NOT a country-level `United States` fill, which means "treat the US as one
  // unit" and should keep the country shape, not explode into 50 states.
  const hasUsContent =
    usSubdivisionReferenced || anyUsPoi || localeCountry === 'US';
  const usOriented =
    !anyNonNaPoi &&
    !regions.some(
      (r) => r.layer === 'country' && !['US', 'CA', 'MX'].includes(r.iso)
    ) &&
    hasUsContent;

  const subdivisions: Array<'us-states'> = [];
  // Draw the US state mesh in two cases:
  //   1. `usSubdivisionReferenced` — a US state is named as a data region
  //      (e.g. `California heat: 92`), so the states ARE the subject; detail
  //      them even on a global projection alongside non-NA content.
  //   2. `usOriented` — US content with everything else inside North America,
  //      i.e. the conventional US states map (including a POI-only named-city
  //      map, or a US map with a Canadian/Mexican neighbour).
  // Deliberately NOT drawn for bare US POIs on an otherwise-global map (e.g. a
  // worldwide backbone with `us-east-1` + Tokyo + Mumbai): the map already knows
  // it spans beyond NA (`anyNonNaPoi`), so exploding the US into 50 states reads
  // as noise, not signal. Such a map renders country-only.
  if (usSubdivisionReferenced || usOriented) subdivisions.push('us-states');

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
  // Sub-national US auto-zoom gate (map-us-subnational-zoom). Computed from the
  // RAW unpadded union (NOT the padded `extent` below, which inflates area ~1.5×).
  // `usSubNational` decides WHETHER to zoom; the projection-family picker below
  // still keys off span as before. `localeUsForced` = `locale US` with no
  // subdivision → the author asked for the whole-country frame, so stay national
  // even on compact data.
  const usSubNational = isSubNationalUsExtent(unioned);
  const localeUsForced = localeCountry === 'US' && !localeSubdivision;
  const DEFAULT_EXTENT: GeoExtent = [
    [-180, -85],
    [180, 85],
  ];
  // Region/choropleth maps get a wider context pad; POI maps stay tight (the
  // isPoiOnly block below re-pads container bboxes with PAD_FRACTION anyway).
  const basePad = regions.length > 0 ? REGION_PAD_FRACTION : PAD_FRACTION;
  let extent: GeoExtent = unioned ? pad(unioned, basePad) : DEFAULT_EXTENT; // empty → default

  const isPoiOnly = pois.length > 0 && regions.length === 0;

  // POI-only region framing (R-poi-region): snap the frame to the region(s) that
  // CONTAIN the POIs, not an arbitrary window. Reverse-geocode each POI to its US
  // state / country (point-in-polygon), then frame to the union of those regions'
  // bboxes — so a cluster of Bay Area cities shows the whole of California, with
  // the containing region available for labelling. Falls back to the raw POI
  // extent when a POI sits outside every polygon (open ocean). The floor below
  // still applies as a *minimum* so a tiny container (e.g. Rhode Island) keeps
  // breathing room.
  const containerRegionIds: string[] = []; // 'US-CA' (state) or 'FR' (country)
  if (isPoiOnly) {
    const countries = decodeFeatures(data.worldDetail);
    const states = decodeFeatures(data.usStates);
    const seen = new Set<string>();
    const containerBoxes: GeoExtent[] = [];
    for (const p of pois) {
      const { country, state } = regionAt([p.lon, p.lat], countries, states);
      const id = state?.iso ?? country?.iso;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      containerRegionIds.push(id);
      // On a US-oriented map a foreign-NEIGHBOUR POI (a Canadian/Mexican city)
      // frames by just its POINT, never its whole country — §24B.2: "A Canada/
      // Mexico POI expands the frame by just its point (the US barely shrinks)".
      // Pulling in Canada's full bbox here would drag the frame up to ~83°N (the
      // point is already in `points`, so it still shows). US states still
      // contribute their bbox (so a Bay Area cluster frames all of California).
      const bb = state
        ? featureBbox(data.usStates, id)
        : usOriented
          ? null
          : featureBboxPrimary(data.worldCoarse, id);
      // Skip a degenerate whole-sphere bbox: spherical geoBounds returns the full
      // globe for a malformed/missing geometry, which would blow the frame out to
      // the entire world. Real region geometry never spans the full sphere — fall
      // back to the raw POI extent (+ floor) instead.
      if (bb && !isWholeSphere(bb)) containerBoxes.push(bb);
    }
    const containerUnion = unionExtent(containerBoxes, points);
    if (containerUnion)
      extent = pad(
        clampContainerToCluster(containerUnion, points, usOriented),
        PAD_FRACTION
      );
  }

  // POI-only fit-to-cluster zoom floor. With region framing above, the extent is
  // usually the containing region(s); the floor only kicks in for a tiny region
  // or a POI that fell outside every polygon. Expand a too-tight extent
  // symmetrically about its centroid until the longer axis reaches
  // POI_ZOOM_FLOOR_DEG so recognizable land always frames the dots. Uniform scale
  // preserves the aspect; the layout's fitExtent letterboxes to canvas.
  // Also applies to a sub-national US region map (map-us-subnational-zoom) so a
  // single tiny state (e.g. Rhode Island) keeps neighbour context instead of
  // over-zooming into near-blank land. `usSubNational` is derived from the raw
  // union above, so flooring the framing `extent` here doesn't feed back into it.
  // Gated on `usOriented` — `usSubNational` is a pure area-vs-CONUS ratio, true
  // for ANY small bbox, so without this guard a compact non-US region (e.g. a
  // single small European country) would be floored too, regressing AC10.
  if (isPoiOnly || (usSubNational && usOriented)) {
    const cx = (extent[0][0] + extent[1][0]) / 2;
    const cy = (extent[0][1] + extent[1][1]) / 2;
    const lon = extent[1][0] - extent[0][0];
    const lat = extent[1][1] - extent[0][1];
    const longer = Math.max(lon, lat);
    if (longer > 0 && longer < POI_ZOOM_FLOOR_DEG) {
      const k = POI_ZOOM_FLOOR_DEG / longer;
      const halfLon = (lon * k) / 2;
      const halfLat = (lat * k) / 2;
      extent = [
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
      ];
    }
  }

  const lonSpan = extent[1][0] - extent[0][0];
  const latSpan = extent[1][1] - extent[0][1];
  const span = Math.max(lonSpan, latSpan);
  const maxAbsLat = Math.max(Math.abs(extent[0][1]), Math.abs(extent[1][1]));
  // albers-usa is the national US composite (insets AK/HI when referenced, the
  // conic projects neighbour land around the states). Choose it exactly when the
  // map is US-oriented (#13): US content plus only US/Canada/Mexico elsewhere.
  // Content reaching BEYOND North America fails `usOriented` and stays on a
  // geographic world/regional projection that frames everything. Note: this
  // intentionally snaps a POI-only US city map to the national frame ("show all
  // states") rather than fit-zooming to the cluster on a geographic projection.
  // (§24B.2 — projection is inferred, never configured.)
  // A compact US region/choropleth that should zoom rather than frame the nation
  // (map-us-subnational-zoom): US-oriented, area-compact, not a POI map, and not
  // forced national by an AK/HI inset or `locale US`.
  const usSubNationalZoom =
    usOriented &&
    usSubNational &&
    !isPoiOnly &&
    !hasAlaskaRef &&
    !hasHawaiiRef &&
    !localeUsForced;
  let projection: ProjectionFamily;
  if (
    usOriented &&
    lonSpan < US_NATIONAL_LON_SPAN &&
    (isPoiOnly || usSubNationalZoom)
  ) {
    // Sub-national US, zoomed: regional Mercator. North is straight up everywhere
    // (vertical meridians) — a conic equal-area fans its meridians toward the pole
    // so an off-centre region visibly tilts, which reads wrong for a "zoom into the
    // US" view. Area distortion across a sub-national frame is negligible, and the
    // POI-cluster path already uses Mercator here. Covers both a POI cluster (fit
    // to the floored extent) and a compact region/choropleth. The us-states mesh
    // is still drawn (subdivisions via usOriented), so neighbours frame the data.
    projection = 'mercator';
  } else if (usOriented) {
    // National US frame: spread-out region data, a wide corridor (lonSpan ≥ the
    // national threshold), a POI map that spans the country, an AK/HI composite,
    // or an explicit `locale US` whole-country request. (§24B.2 — albers-usa.)
    projection = 'albers-usa';
  } else if (span > WORLD_SPAN || maxAbsLat > MERCATOR_MAX_LAT) {
    // World/multi-continent scale (or a polar-reaching frame). Every world map —
    // data choropleth OR dataless reference — gets equirectangular: a clean,
    // conventional rectangular wall-map frame. (Trade: not equal-area, so a
    // choropleth's high-latitude regions stretch vertically — accepted for the
    // consistent rectangular look over Equal Earth's area honesty.)
    projection = 'equirectangular';
  } else {
    // Tight clusters AND single-continent regional views: a conic equal-area
    // (Albers) projection, parameterized per-extent in the layout. This is the
    // conventional atlas projection for a single mid-latitude continent — it
    // keeps familiar country shapes (no world-projection horizontal squash) and,
    // unlike Mercator, does NOT vertically inflate high-latitude land. That
    // inflation is what pushed a Europe choropleth's colored mass into the bottom
    // ~30% of the frame (Scandinavia's stretch wasted the upper half on empty
    // ocean); equal-area framing re-centers the data and scales the land larger.
    projection = 'conic-equal-area';
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
  // Applies to the equirectangular world projection (data + reference alike).
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
    // Tier is intentionally pinned to detail (50m) at ALL scales. Diagrammo maps
    // are presentational (palette tints, relief hachures, POI hubs), not
    // survey-grade — recognizability > generalization: 110m coarse drops the
    // Italian boot to a stump at world scale. `WORLD_SPAN` lives on only for the
    // projection decision (the `usOriented`/`span > WORLD_SPAN` chain above); it
    // no longer gates basemap resolution.
    // `worldCoarse` is still loaded — it's the authoritative name/bbox index
    // (featureIndex, featureBboxPrimary), not dead code.
    world: 'detail',
    subdivisions,
  };
  result.extent = extent;
  result.projection = projection;
  result.poiFrameContainers = containerRegionIds;
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

/** Asymmetric container clamp (R-poi-region overshoot guard). Container framing
 *  reveals the region(s) holding the POIs, but one POI at the edge of a tall/wide
 *  country drags the frame to that country's far edge. Cap how far the frame
 *  extends BEYOND the POI cluster on each side at CONTAINER_OVERSHOOT_DEG, while
 *  letting a genuinely tighter container edge still bound the frame (so a small
 *  country shows whole, but a cluster inside a giant one stays on the cluster).
 *
 *  Each longitude side clamps independently. A container edge is a usable outer
 *  bound only when it sits within the normal [-180, 180] range AND on the correct
 *  side of the cluster; an antimeridian-crossing container (Russia, Fiji, NZ, the
 *  US via the Aleutians) reports a degenerate east (> 180, or numerically < its
 *  own west), so that side falls back to cluster ± overshoot instead of skipping
 *  the clamp entirely (which previously blew a western-Russia cluster out to a
 *  world frame). Latitude never wraps, so it always clamps. Assumes the POI
 *  cluster itself does not straddle the seam — true for any regional cluster. */
function clampContainerToCluster(
  container: GeoExtent,
  points: Array<[number, number]>,
  usOriented: boolean
): GeoExtent {
  const poi = unionExtent([], points);
  if (!poi) return container;
  let [[west, south], [east, north]] = container;
  const [[pWest, pSouth], [pEast, pNorth]] = poi;
  // Overshoot shrinks with cluster size for non-US maps (see containerOvershoot):
  // a big cluster already orients itself, so it gets less surrounding slack than a
  // tiny one. US-oriented maps keep the flat MAX (the albers-usa gate needs it).
  const over = containerOvershoot(
    Math.max(pEast - pWest, pNorth - pSouth),
    usOriented
  );
  south = Math.max(south, pSouth - over);
  north = Math.min(north, pNorth + over);
  const wOver = pWest - over;
  const eOver = pEast + over;
  // West edge usable iff in range and not east of the cluster's west.
  west = west >= -180 && west <= pWest ? Math.max(west, wOver) : wOver;
  // East edge usable iff in range and not west of the cluster's east.
  east = east <= 180 && east >= pEast ? Math.min(east, eOver) : eOver;
  return [
    [west, south],
    [east, north],
  ];
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
