// Map chart-type diagnostic catalog.
//
// The map resolver (`./resolver.ts`) emits every coded diagnostic through the
// shared `emit(spec, line, params)` helper against the keyed specs below — the
// wording lives here ONLY, never re-typed at the call site. Consumers (CLI
// `diagnostics`, console error-review, MCP `validate_diagram`, spec docs)
// enumerate map diagnostics via `MAP_DIAGNOSTICS` alongside every other chart
// type's `DiagnosticSpec`.
//
// Every `message` builder tolerates being called with `{}` (renders a
// representative message with empty placeholders) per the DiagnosticSpec
// contract.

import type { DiagnosticSpec } from '../diagnostics';

/** Keyed specs — referenced by the resolver's `emit()` call sites. */
export const MAP_DX = {
  // Runtime severity: 'error' (matches E_ prefix). ONE code, THREE distinct
  // emit sites in resolver.ts. The builder switches on params:
  //   • `iso` present → `No subdivision "<name>" in scope <scope> (it is <iso>).`
  //     (region names a state but the explicit US-XX scope points elsewhere)
  //   • `place: true` → `No "<name>" found in scope <scope>.`
  //     (a scoped POI/place lookup misses)
  //   • otherwise (and for the `{}` catalog render) → the REPRESENTATIVE
  //     region-scope-miss wording `No region "<name>" found in scope <scope>.`
  SCOPE_MISS: {
    code: 'E_MAP_SCOPE_MISS',
    severity: 'error',
    chartType: 'map',
    title: 'No match in the given scope',
    message: (p) =>
      p.iso !== undefined
        ? `No subdivision "${p.name ?? ''}" in scope ${p.scope ?? ''} (it is ${p.iso}).`
        : p.place
          ? `No "${p.name ?? ''}" found in scope ${p.scope ?? ''}.`
          : `No region "${p.name ?? ''}" found in scope ${p.scope ?? ''}.`,
    hint: 'Drop or correct the scope qualifier, or use an ISO code / coordinates.',
    example: 'map\nGeorgia US-CA heat: 2',
  },
  UNKNOWN_AIRPORT_CODE: {
    // Runtime severity: 'error' (matches E_ prefix).
    code: 'E_MAP_UNKNOWN_AIRPORT_CODE',
    severity: 'error',
    chartType: 'map',
    title: 'Unknown airport code',
    message: (p) =>
      `Unknown airport code "${p.code ?? ''}" — not in the bundled airport set (large hubs + US commercial). Use coordinates with \`as ${p.code ?? ''}\` if you need it.`,
    hint: 'A 3-letter token that is not a bundled IATA code — supply coordinates with `poi <lat> <lon> as <CODE>`.',
    example: 'map\npoi ZZZ',
  },
  UNKNOWN_PLACE: {
    // Runtime severity: 'error' (matches E_ prefix). `hint` (a "did you mean?"
    // suggestion) is interpolated only when a near match exists.
    code: 'E_MAP_UNKNOWN_PLACE',
    severity: 'error',
    chartType: 'map',
    title: 'Unknown place',
    message: (p) =>
      `Unknown place "${p.name ?? ''}" — not in the gazetteer.${p.hint ? ' ' + p.hint : ''} Search the exact token with \`dgmo map-search "${p.name ?? ''}"\` (or the lookup_map_location tool), or use coordinates \`poi <lat> <lon>\`.`,
    hint: 'The POI name is not in the gazetteer — check spelling or use coordinates.',
    example: 'map\npoi Nowheresville',
  },
  UNKNOWN_SUBDIVISION: {
    // Runtime severity: 'error' (matches E_ prefix). `hint` (a "did you mean?"
    // suggestion) is interpolated only when a near match exists.
    code: 'E_MAP_UNKNOWN_SUBDIVISION',
    severity: 'error',
    chartType: 'map',
    title: 'Unknown region',
    message: (p) =>
      `Unknown region "${p.name ?? ''}" — not a known country or US state.${p.hint ? ' ' + p.hint : ''} Search the exact token with \`dgmo map-search "${p.name ?? ''}"\` (or the lookup_map_location tool), use an ISO code (e.g. FR, US-CA), or coordinates.`,
    hint: 'The region is neither a known country nor a US state — check spelling or use an ISO code.',
    example: 'map\nBavaria heat: 1',
  },
  AIRPORT_SHADOWED_BY_CITY: {
    // Runtime severity: 'warning' (matches W_ prefix). Non-blocking, emitted at
    // most once per shadowed IATA code.
    code: 'W_MAP_AIRPORT_SHADOWED_BY_CITY',
    severity: 'warning',
    chartType: 'map',
    title: 'Airport code shadowed by a city',
    message: (p) =>
      `"${p.name ?? ''}" resolved to the city; "${p.code ?? ''}" is also an airport code. Use coordinates with \`as ${p.code ?? ''}\` for the airport.`,
    hint: 'A city won a token that is also a bundled airport code — use coordinates with `as <CODE>` for the airport.',
    example: 'map\npoi Ufa',
  },
  AMBIGUOUS_NAME: {
    // Runtime severity: 'warning' (matches W_ prefix).
    code: 'W_MAP_AMBIGUOUS_NAME',
    severity: 'warning',
    chartType: 'map',
    title: 'Ambiguous place name',
    message: (p) =>
      `"${p.name ?? ''}" is ambiguous — resolved to the most-populous match. Set a default with \`locale <ISO>\` (e.g. \`locale US\` / \`locale US-GA\`) to steer it.`,
    hint: 'Multiple places share this name — add a scope or `locale <ISO>` to steer it.',
    example: 'map\npoi Portland',
  },
  AMBIGUOUS_LABEL: {
    // Runtime severity: 'error' (matches E_ prefix). A route/edge referenced a
    // POI by its `label:`, but two or more declared POIs share that label, so the
    // reference can't bind to one. Disambiguate with a unique `as <alias>`.
    code: 'E_MAP_AMBIGUOUS_LABEL',
    severity: 'error',
    chartType: 'map',
    title: 'Ambiguous POI label',
    message: (p) =>
      `Reference "${p.name ?? ''}" matches the label of two or more POIs — give each a distinct \`as <alias>\` and reference the alias instead.`,
    hint: 'Multiple POIs share this label — reference a unique `as <alias>` rather than the label.',
    example: 'map\npoi 1 2 label: Depot\npoi 3 4 label: Depot',
  },
  DUPLICATE_POI: {
    // Runtime severity: 'warning' (matches W_ prefix). Only a declared-over-
    // declared collision warns; an implicit endpoint never triggers it.
    code: 'W_MAP_DUPLICATE_POI',
    severity: 'warning',
    chartType: 'map',
    title: 'Duplicate POI',
    message: (p) => `Duplicate POI "${p.id ?? ''}" — last definition wins.`,
    hint: 'Two POIs resolved to the same id — remove one or give it a distinct alias.',
    example: 'map\npoi Tokyo\npoi Tokyo',
  },
  DUPLICATE_REGION: {
    // Runtime severity: 'warning' (matches W_ prefix).
    code: 'W_MAP_DUPLICATE_REGION',
    severity: 'warning',
    chartType: 'map',
    title: 'Duplicate region',
    message: (p) =>
      `Duplicate region "${p.name ?? ''}" — last definition wins.`,
    hint: 'The same region is defined twice — remove the earlier definition.',
    example: 'map\nCalifornia heat: 1\nCalifornia heat: 9',
  },
  REGION_AMBIGUOUS: {
    // Runtime severity: 'warning' (matches W_ prefix). Suppressed under a US
    // scope (`locale US`, an explicit ISO scope, or another US-state reference).
    code: 'W_MAP_REGION_AMBIGUOUS',
    severity: 'warning',
    chartType: 'map',
    title: 'Region is both a country and a US state',
    message: (p) =>
      `"${p.name ?? ''}" is both a country and a US state — resolved as ${p.layer ?? ''} (${p.chosenId ?? ''}). Pin it with an ISO code (${p.stateId ?? ''} / ${p.countryId ?? ''}) or name + scope ("${p.name ?? ''} US" / "${p.name ?? ''} ${p.countryId ?? ''}").`,
    hint: 'The name collides between a country and a US state — pin it with an ISO code or a `US` / `US-XX` scope.',
    example: 'map\nGeorgia heat: 2',
  },
  CLOCK_TZ_INVALID: {
    // Runtime severity: 'warning' (matches W_ prefix). The `clock` channel is on
    // and a POI carried a `tz:` that is neither a known IANA zone nor a fixed
    // offset — the pin renders normally but gets no time card (BL-122).
    code: 'W_MAP_CLOCK_TZ_INVALID',
    severity: 'warning',
    chartType: 'map',
    title: 'Unrecognized time zone',
    message: (p) =>
      `\`tz: ${p.name ?? ''}\` is not a known IANA zone or offset — this pin renders without a time card. Use an IANA id (\`Asia/Tokyo\`) or a fixed offset (\`UTC+9\`).`,
    hint: 'Use an IANA zone id (`Asia/Tokyo`) or a fixed offset (`UTC+9`).',
    example: 'map\nclock\npoi Tokyo tz: Asia/Tokyo',
  },
} satisfies Record<string, DiagnosticSpec>;

export const MAP_DIAGNOSTICS: DiagnosticSpec[] = Object.values(MAP_DX);
