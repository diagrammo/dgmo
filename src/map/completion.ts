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
import type { Gazetteer, RegionName } from './data/types';

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
}

export interface MapCompletionOptions {
  /** Max results (default 12). */
  readonly limit?: number;
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
  if (matched.size === 0) return [];

  const ranked = [...matched]
    .filter((i) => gazetteer.cities[i] !== undefined)
    .sort((a, b) => {
      const pa = gazetteer.cities[a]![3];
      const pb = gazetteer.cities[b]![3];
      return pb - pa || a - b; // pop desc, then deterministic index
    })
    .slice(0, limit);

  return ranked.map((i) => {
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
      ...(sub !== undefined && { sub }),
    };
  });
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
