// Map geo-query (step-5 inspector backend). A SEPARATE entry from the renderer:
// `renderMap` returns void + mutates the DOM, so it cannot hand back a query
// handle. `createMapGeoQuery` re-runs the deterministic parse→resolve→layout
// pipeline (cheap, lazy — only when the app arms Inspect) and wraps the fitted
// projection captured on the layout, exposing:
//   - invert(px,py)  — composite/stretch-aware pixel → [lon,lat]
//   - project(lonLat) — [lon,lat] → pixel (re-project pins/markers each render)
//   - locate(px,py)  — ONE unified result card (coords + reverse-geocode + tokens)
//   - cities(extent?) — culled + projected gazetteer cities for the all-cities layer
//
// DI: `data: MapData` is injected by the caller (the Node-only `loadMapData` is
// never called here), so this is browser-safe — no `node:fs`, no boundary
// TopoJSON pulled into the synchronous render bundle (F7/AC15).
import type { PaletteColors } from '../palettes/types';
import { parseMap } from './parser';
import { resolveMap } from './resolver';
import { layoutMap } from './layout';
import type { MapLayout } from './layout';
import { decodeFeatures, regionAt } from './geo';
import type { DecodedFeature } from './geo';
import { pixelToLonLat, lonLatToPixel } from './invert';
import type { MapData, GeoExtent } from './resolved-types';
import type { Gazetteer } from './data/types';
import type { DgmoError } from '../diagnostics';

/** Nearest gazetteer city to a point: the real haversine distance, plus the
 *  canonical name + ISO + (US-only) subdivision for token shaping. `lon`/`lat`
 *  are the city's own gazetteer coordinates (so callers can mark it on the map,
 *  distinct from the inspected point). */
export interface NearestCity {
  readonly name: string;
  readonly iso: string;
  readonly sub?: string;
  readonly distanceKm: number;
  readonly lon: number;
  readonly lat: number;
}

/** A region declaration with its canonical/primary form plus bare alternates
 *  (behind the card's "other forms" expander). */
export interface RegionToken {
  /** Explicit scoped form, shown first (`Florida US-FL` / `France FR`). */
  readonly primary: string;
  /** Bare forms (bare ISO, bare code, bare name). */
  readonly alternates: string[];
}

/** Paste-ready DGMO tokens for one inspected point — each round-trips through the
 *  map parser with zero diagnostics (the app inserts verbatim, never synthesizes
 *  syntax). */
export interface ResultTokens {
  /** Positional POI line, e.g. `poi 40.7608 -111.891` (NEVER `@lat,lon`). */
  readonly coordPoiLine: string;
  /** US-state region tokens — null when the click isn't in a US state. */
  readonly state: RegionToken | null;
  /** Country region tokens — null over open ocean (no country). */
  readonly country: RegionToken | null;
  /** Scoped city token (`New York US-NY` / `Paris FR`), or a bare ambiguous name. */
  readonly city: { readonly token: string; readonly ambiguous: boolean } | null;
}

/** The single unified Inspect result. */
export interface ResultCard {
  readonly lonLat: [number, number];
  readonly country: { iso: string; name: string } | null;
  readonly state: { iso: string; name: string } | null;
  readonly nearestCity: NearestCity | null;
  readonly tokens: ResultTokens;
}

/** A gazetteer city projected to screen pixels for the all-cities overlay. */
export interface ProjectedCity {
  readonly name: string;
  readonly iso: string;
  readonly sub?: string;
  readonly lon: number;
  readonly lat: number;
  readonly px: number;
  readonly py: number;
  readonly pop: number;
}

export interface MapGeoQuery {
  /** Pixel → `[lon,lat]`, or null for an out-of-domain pixel. */
  invert(px: number, py: number): [number, number] | null;
  /** `[lon,lat]` → pixel, or null if it projects nowhere. */
  project(lonLat: readonly [number, number]): [number, number] | null;
  /** One click → the unified result card, or null if the pixel inverts to
   *  nothing (graceful "no location"). */
  locate(px: number, py: number): ResultCard | null;
  /** Culled + projected cities for the all-cities layer (population-primary). */
  cities(extent?: GeoExtent): ProjectedCity[];
  /** Layout-time diagnostics (e.g. best-effort surface-route warnings). These are
   *  dimension-dependent, so they live on the geo-query (bound to the rendered
   *  layout) rather than the resolver. Callers merge them with `resolved.diagnostics`. */
  readonly diagnostics: readonly DgmoError[];
}

export interface CreateMapGeoQueryOptions {
  readonly content: string;
  readonly width: number;
  readonly height: number;
  /** Injected map assets — same `MapData` the app passes to `renderMap`. */
  readonly data: MapData;
  /** Same palette/isDark the app renders with (geometry is palette-independent,
   *  but `layoutMap` mandates them). */
  readonly palette: PaletteColors;
  readonly isDark: boolean;
}

const EARTH_R_KM = 6371;
const DEG = Math.PI / 180;

/** Great-circle distance in km (haversine; no d3 dependency). */
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Each decade of population is worth this many km of "pull" — so a notable city
// a little farther beats a tiny suburb that's technically closer (A4). Tuned so
// a ~200k-pop city (log10≈5.3) outranks a ~5k hamlet (log10≈3.7) within ~20 km.
const POP_PULL_KM = 12;

/** Nearest gazetteer city, blending true distance with notability (A4). Returns
 *  the chosen city's REAL `distanceKm` regardless of the ranking blend (F4). */
function nearestCity(
  lonLat: readonly [number, number],
  gazetteer: Gazetteer
): NearestCity | null {
  const [lon, lat] = lonLat;
  let best: { score: number; idx: number; dist: number } | null = null;
  const cities = gazetteer.cities;
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i]!;
    const dist = haversineKm(lat, lon, c[0], c[1]);
    const score = dist - POP_PULL_KM * Math.log10((c[3] || 0) + 1);
    if (!best || score < best.score) best = { score, idx: i, dist };
  }
  if (!best) return null;
  const c = cities[best.idx]!;
  return {
    name: c[4],
    iso: c[2],
    ...(c[5] !== undefined && { sub: c[5] }),
    distanceKm: best.dist,
    lat: c[0],
    lon: c[1],
  };
}

/** Round a coordinate to 2 dp (≈1 km — within a pixel even at single-state zoom;
 *  a POI dot is 6+ px wide, so more decimals are false precision invisible on the
 *  rendered map). */
function roundCoord(n: number): number {
  return Number(n.toFixed(2));
}

/** Build the paste-ready tokens for one inspected point. Display name + ISO come
 *  from the matched boundary feature itself (no `region-names.json` dependency).*/
function buildTokens(
  lonLat: readonly [number, number],
  region: {
    country: { iso: string; name: string } | null;
    state: { iso: string; name: string } | null;
  },
  city: NearestCity | null
): ResultTokens {
  const coordPoiLine = `poi ${roundCoord(lonLat[1])} ${roundCoord(lonLat[0])}`;

  // Region token forms are validated against the RESOLVER, not just the parser
  // (a token can parse yet fail to resolve). Verified resolving forms:
  //   - US state: `Florida US-FL` (scoped) and bare `US-FL` / `Florida`. NOTE a
  //     bare 2-letter code (`FL`) is REJECTED ("Unknown subdivision") — only the
  //     `US-FL` form resolves — so it is intentionally NOT offered.
  //   - Country: the BARE name (`United States of America`) or bare ISO (`US`).
  //     The scoped `<name> <iso>` form does NOT resolve for a country whose
  //     subdivisions are loaded (the scope makes the resolver hunt for a
  //     SUBDIVISION named after the country) — so a country leads with its name.
  let stateTok: RegionToken | null = null;
  if (region.state) {
    const { iso, name } = region.state; // iso like `US-FL`
    stateTok = { primary: `${name} ${iso}`, alternates: [iso, name] };
  }

  let countryTok: RegionToken | null = null;
  if (region.country) {
    const { iso, name } = region.country; // iso like `FR` / `US`
    countryTok = { primary: name, alternates: [iso] };
  }

  // The nearest-city row inserts a POI for that city, so the token is a POSITIONAL
  // `poi <City> <scope>` line — a bare `<City> <scope>` would parse as a REGION
  // declaration and fail to resolve. Scope = the US subdivision (US-only), else
  // the country ISO; bare `poi <City>` when neither disambiguates.
  let cityTok: ResultTokens['city'] = null;
  if (city) {
    const scope = city.sub ?? (city.iso || '');
    cityTok = scope
      ? { token: `poi ${city.name} ${scope}`, ambiguous: false }
      : { token: `poi ${city.name}`, ambiguous: true };
  }

  return { coordPoiLine, state: stateTok, country: countryTok, city: cityTok };
}

const MAX_CITY_DOTS = 250;

/** Construct a geo-query handle bound to the layout for `(content, width,
 *  height, data, palette, isDark)`. Deterministic: identical inputs ⇒ the same
 *  fitted projection the rendered SVG used, so inverted clicks align. */
export function createMapGeoQuery(opts: CreateMapGeoQueryOptions): MapGeoQuery {
  const { content, width, height, data, palette, isDark } = opts;
  const resolved = resolveMap(parseMap(content), data);
  const layout: MapLayout = layoutMap(
    resolved,
    data,
    { width, height },
    { palette, isDark }
  );

  // Decode the boundary features ONCE (review L3) — country containment against
  // world-detail (50m); US-state against us-states (10m).
  const countries: DecodedFeature[] = decodeFeatures(data.worldDetail);
  const states: DecodedFeature[] = decodeFeatures(data.usStates);
  const gazetteer = data.gazetteer;

  const invert = (px: number, py: number): [number, number] | null =>
    pixelToLonLat(layout, px, py);
  const project = (
    lonLat: readonly [number, number]
  ): [number, number] | null => lonLatToPixel(layout, lonLat);

  const locate = (px: number, py: number): ResultCard | null => {
    const lonLat = invert(px, py);
    if (!lonLat) return null;
    const region = regionAt(lonLat, countries, states);
    const city = nearestCity(lonLat, gazetteer);
    return {
      lonLat,
      country: region.country,
      state: region.state,
      nearestCity: city,
      tokens: buildTokens(lonLat, region, city),
    };
  };

  const cities = (extent?: GeoExtent): ProjectedCity[] => {
    // Population-primary cull (extent only a coarse secondary filter — review
    // L-NEW-3): the data extent is NOT the visible viewport when a wide map is
    // scrolled, so rank by population and cap, keeping only on-canvas dots.
    const sorted = [...gazetteer.cities].sort((a, b) => b[3] - a[3]);
    const out: ProjectedCity[] = [];
    for (const c of sorted) {
      const [lat, lon, iso, pop, name, sub] = c;
      if (extent) {
        const [[w, s], [e, n]] = extent;
        if (lon < w || lon > e || lat < s || lat > n) continue;
      }
      const p = project([lon, lat]);
      if (!p) continue;
      if (p[0] < 0 || p[0] > width || p[1] < 0 || p[1] > height) continue;
      out.push({
        name,
        iso,
        ...(sub !== undefined && { sub }),
        lon,
        lat,
        px: p[0],
        py: p[1],
        pop,
      });
      if (out.length >= MAX_CITY_DOTS) break;
    }
    return out;
  };

  return { invert, project, locate, cities, diagnostics: layout.diagnostics };
}
