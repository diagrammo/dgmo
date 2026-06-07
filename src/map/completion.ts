// Map place-completion source (step 6): gazetteer-fed autocomplete for `poi` /
// edge / route lines. PURE + SYNC + DETERMINISTIC + DEPENDENCY-INJECTED — the
// caller (the app's CM6 completion source) supplies the `Gazetteer` (the same
// asset the renderer uses) and maps the results to editor completions. Distinct
// from completion.ts's directive/doc-symbol completion. See §24B.5/.8.
//
// NOTE: a local `fold` is intentionally duplicated here (NOT imported from
// ./geo) so this module — exported from the main index — stays free of the
// d3-geo / topojson imports that geo.ts pulls in. Keep it byte-identical to the
// resolver/geo folding so matches agree.
import type { Gazetteer, RegionName, AirportData } from './data/types';

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Group thousands without `Intl` (deterministic across runtimes/locales). */
const groupThousands = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface MapPlaceCompletion {
  /** Canonical display name (original casing), e.g. `Portland`. */
  readonly name: string;
  /** Text to insert. ISO-qualified (`Portland US-OR`) iff the name is
   *  ambiguous in the gazetteer; bare otherwise (disambiguate-once, §24B.8). */
  readonly insert: string;
  /** Menu label (`Portland — US-OR` when ambiguous, else `Portland`). */
  readonly label: string;
  /** Secondary detail, e.g. `US-OR · 652,503`. */
  readonly detail: string;
  readonly iso: string;
  readonly sub?: string;
  readonly pop: number;
  /** `'airport'` for IATA-code entries (icon/grouping affordance); absent or
   *  `'city'` for gazetteer cities. Cities rank above airports for a shared
   *  prefix so ~1500 codes never bury city names (ADR-5). */
  readonly kind?: 'city' | 'airport';
}

export interface MapCompletionOptions {
  /** Max results (default 12). */
  readonly limit?: number;
  /** IATA-coded airports (`airports.json`). When supplied, airport codes
   *  matching the prefix are offered as a second (post-city) group. Optional —
   *  absent (old DI bundles / no asset) just yields city-only completions. */
  readonly airports?: AirportData;
  /** Resolver-inferred map scope (country `US` or subdivision `US-CA`). Biases
   *  airport ranking so in-region airports sort above out-of-region same-prefix
   *  ones (ADR-6). Pure rank, never a filter — cross-region airports still
   *  appear. App passes the document's inferred scope in (Slice 2). */
  readonly scopeISO?: string;
}

/**
 * Prefix-match city names + alternate-name aliases against the gazetteer,
 * rank by population (desc; stable tie-break by gazetteer index), and emit
 * ISO-qualified insert text only for ambiguous (same-named) places.
 *
 * Pure + deterministic. Empty/blank query → `[]` (the caller gates min length).
 */
export function completeMapPlaces(
  query: string,
  gazetteer: Gazetteer,
  opts?: MapCompletionOptions
): MapPlaceCompletion[] {
  const q = fold(query);
  if (!q) return [];
  const limit = opts?.limit ?? 12;

  // Collect matching `cities` indices (de-duped) from names + aliases.
  const matched = new Set<number>();
  for (const [key, list] of Object.entries(gazetteer.byName)) {
    if (key.startsWith(q)) for (const i of list) matched.add(i);
  }
  for (const [key, idx] of Object.entries(gazetteer.alt)) {
    if (key.startsWith(q)) matched.add(idx);
  }

  // Airport prefix matches (optional asset; guarded for absent bundles, F5/#8).
  // Folded IATA code → index into `airports`. Scope-match (current map's country)
  // then code-alpha — NOT pop (always 0) and NOT type (the tuple has no type).
  const airports = opts?.airports;
  const scopeCountry = opts?.scopeISO ? opts.scopeISO.slice(0, 2) : undefined;
  const airportHits: Array<{ code: string; name: string; iso: string }> = [];
  if (airports?.airportIata) {
    for (const [key, idx] of Object.entries(airports.airportIata)) {
      if (!key.startsWith(q)) continue;
      const a = airports.airports[idx];
      if (a) airportHits.push({ code: key, name: a[4], iso: a[2] });
    }
  }

  // Relaxed early-return: only when BOTH groups are empty (an airport-only prefix
  // must still complete — the old city-only `matched.size === 0` blocked it).
  if (matched.size === 0 && airportHits.length === 0) return [];

  // Cities first (pop desc), then airports — cities fill the limit slots first.
  // Slice the sorted index list to `limit` BEFORE building items (a short prefix
  // matches thousands of cities; mapping them all per keystroke is wasted work —
  // airports are appended after, so they never starve cities).
  const cityItems: MapPlaceCompletion[] = [...matched]
    .filter((i) => gazetteer.cities[i] !== undefined)
    .sort((a, b) => {
      const pa = gazetteer.cities[a]![3];
      const pb = gazetteer.cities[b]![3];
      return pb - pa || a - b; // pop desc, then deterministic index
    })
    .slice(0, limit)
    .map((i) => {
      const c = gazetteer.cities[i]!;
      const [, , iso, pop, name, sub] = c;
      const ambiguous = (gazetteer.byName[fold(name)]?.length ?? 0) > 1;
      const qualifier = sub ?? iso;
      const insert = ambiguous ? `${name} ${qualifier}` : name;
      const label = ambiguous ? `${name} — ${qualifier}` : name;
      const detail = `${qualifier} · ${groupThousands(pop)}`;
      return {
        name,
        insert,
        label,
        detail,
        iso,
        pop,
        kind: 'city' as const,
        ...(sub !== undefined && { sub }),
      };
    });

  const airportItems: MapPlaceCompletion[] = airportHits
    .sort((a, b) => {
      const sa = scopeCountry && a.iso === scopeCountry ? 0 : 1;
      const sb = scopeCountry && b.iso === scopeCountry ? 0 : 1;
      return sa - sb || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    })
    .map(({ code, name, iso }) => {
      const upper = code.toUpperCase();
      return {
        name,
        insert: upper,
        label: upper,
        detail: `Airport · ${name}`,
        iso,
        pop: 0,
        kind: 'airport' as const,
      };
    });

  return [...cityItems, ...airportItems].slice(0, limit);
}

export interface MapRegionCompletion {
  /** Display name = insert text (the resolver disambiguates cross-layer
   *  collisions like Georgia by map scope, §24B.8). */
  readonly name: string;
  /** ISO 3166-1/3166-2 id. */
  readonly iso: string;
  readonly layer: 'country' | 'us-state';
  /** Secondary detail, e.g. `US state · US-CA` or `Country · DE`. */
  readonly detail: string;
}

/**
 * Prefix-match fill-able region names (countries + US states) for region-fill
 * lines. Matches the folded display name OR the ISO code; deterministic
 * (alphabetical by name, then layer). Pure. Empty query → `[]`.
 *
 * `regions` is injected (the `region-names.json` asset, shipped in dist/map-data
 * alongside the gazetteer). Cross-layer same-name (Georgia: country GE + state
 * US-GA) yields both entries, distinguished by `detail`.
 */
export function completeMapRegions(
  query: string,
  regions: readonly RegionName[],
  opts?: MapCompletionOptions
): MapRegionCompletion[] {
  const q = fold(query);
  if (!q) return [];
  const limit = opts?.limit ?? 12;

  return regions
    .filter(
      (r) => fold(r.name).startsWith(q) || r.iso.toLowerCase().startsWith(q)
    )
    .sort(
      (a, b) =>
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
        (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0)
    )
    .slice(0, limit)
    .map((r) => ({
      name: r.name,
      iso: r.iso,
      layer: r.layer,
      detail:
        r.layer === 'us-state' ? `US state · ${r.iso}` : `Country · ${r.iso}`,
    }));
}
