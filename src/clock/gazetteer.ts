// ============================================================
// Clock chart — city → IANA gazetteer + search (DATA, not a dep)
// ============================================================
//
// Makes IANA zones *discoverable*: an author types the city they think in
// (`London`, `NYC`, `Bombay`) and this resolves it to the canonical IANA zone.
// It also backs editor autocomplete via `searchZones()` — the same index serves
// parse-time resolution and edit-time suggestions.
//
// Three layers:
//   • BASE  — every zone in ZONE_COORDS, reverse-indexed by its last path
//     segment (`America/New_York` → "New York"). Free coverage of ~100 cities.
//   • ALIAS — hand-curated colloquial names, abbreviations, and `City, Region`
//     disambiguators that don't fall out of the IANA path (NYC, LA, Bombay,
//     Kyiv/Kiev, "London, ON").
//   • AMBIGUOUS — a normalized name that maps to more than one zone with no
//     clear default resolves to an error listing the candidates (§37.3).
//
// Zero imports beyond the dep-free resolver so it bundles into the browser
// runtime alongside the ticker.

import { ZONE_COORDS } from './zone-coords';
import { formatOffsetLabel, zoneParts } from './resolve';

/** One resolvable place: a canonical display city and the IANA zone it maps to. */
export interface GazetteerEntry {
  /** Canonical display city, e.g. "New York". */
  readonly city: string;
  /** IANA zone, e.g. "America/New_York". */
  readonly zone: string;
}

/** Normalize a name for matching: lowercase, fold accents, collapse whitespace. */
export function normalizePlace(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The last path segment of a zone, underscores → spaces (`New_York` → `New York`). */
function zoneCity(zone: string): string {
  const seg = zone.split('/').pop() ?? zone;
  return seg.replace(/_/g, ' ');
}

/**
 * Curated aliases: a colloquial name → its canonical IANA zone. Includes
 * abbreviations, historic/local names, and `City, Region` disambiguators. Keys
 * are normalized on load, so write them naturally here.
 */
const ALIAS_SEED: ReadonlyArray<readonly [string, string]> = [
  // North America — abbreviations + metros not named by their zone segment
  ['NYC', 'America/New_York'],
  ['New York City', 'America/New_York'],
  ['Boston', 'America/New_York'],
  ['Washington', 'America/New_York'],
  ['Washington DC', 'America/New_York'],
  ['DC', 'America/New_York'],
  ['Philadelphia', 'America/New_York'],
  ['Miami', 'America/New_York'],
  ['Atlanta', 'America/New_York'],
  ['LA', 'America/Los_Angeles'],
  ['Los Angeles', 'America/Los_Angeles'],
  ['San Francisco', 'America/Los_Angeles'],
  ['SF', 'America/Los_Angeles'],
  ['Seattle', 'America/Los_Angeles'],
  ['Portland', 'America/Los_Angeles'],
  ['San Diego', 'America/Los_Angeles'],
  ['Las Vegas', 'America/Los_Angeles'],
  ['Dallas', 'America/Chicago'],
  ['Houston', 'America/Chicago'],
  ['Austin', 'America/Chicago'],
  ['Chicago', 'America/Chicago'],
  ['Minneapolis', 'America/Chicago'],
  ['Denver', 'America/Denver'],
  ['Salt Lake City', 'America/Denver'],
  ['London, ON', 'America/Toronto'],
  ['Ottawa', 'America/Toronto'],
  ['Montreal', 'America/Toronto'],
  ['Honolulu', 'Pacific/Honolulu'],
  ['Hawaii', 'Pacific/Honolulu'],
  // Genuinely ambiguous: San Jose CA (Pacific) vs San José, Costa Rica.
  ['San Jose', 'America/Los_Angeles'],
  ['San Jose', 'America/Costa_Rica'],
  // Europe
  ['Kiev', 'Europe/Kyiv'],
  ['Kyiv', 'Europe/Kyiv'],
  ['Frankfurt', 'Europe/Berlin'],
  ['Munich', 'Europe/Berlin'],
  ['Hamburg', 'Europe/Berlin'],
  ['Milan', 'Europe/Rome'],
  ['Barcelona', 'Europe/Madrid'],
  ['Geneva', 'Europe/Zurich'],
  ['Saint Petersburg', 'Europe/Moscow'],
  ['St Petersburg', 'Europe/Moscow'],
  // Middle East / Asia — historic + colloquial names
  ['Bombay', 'Asia/Kolkata'],
  ['Mumbai', 'Asia/Kolkata'],
  ['Delhi', 'Asia/Kolkata'],
  ['New Delhi', 'Asia/Kolkata'],
  ['Bangalore', 'Asia/Kolkata'],
  ['Bengaluru', 'Asia/Kolkata'],
  ['Chennai', 'Asia/Kolkata'],
  ['Madras', 'Asia/Kolkata'],
  ['Calcutta', 'Asia/Kolkata'],
  ['Hyderabad', 'Asia/Kolkata'],
  ['Saigon', 'Asia/Ho_Chi_Minh'],
  ['Ho Chi Minh City', 'Asia/Ho_Chi_Minh'],
  ['Beijing', 'Asia/Shanghai'],
  ['Peking', 'Asia/Shanghai'],
  ['Shenzhen', 'Asia/Shanghai'],
  ['Guangzhou', 'Asia/Shanghai'],
  ['Abu Dhabi', 'Asia/Dubai'],
  ['Tel Aviv', 'Asia/Jerusalem'],
  ['Osaka', 'Asia/Tokyo'],
  ['Kyoto', 'Asia/Tokyo'],
  // Oceania
  ['Auckland', 'Pacific/Auckland'],
  ['Wellington', 'Pacific/Auckland'],
];

/** normalized name → all zones registered under it (for ambiguity detection). */
const NAME_INDEX = new Map<string, Set<string>>();
/** normalized name → canonical display city (first-registered wins). */
const CITY_LABEL = new Map<string, string>();
/** Every distinct entry, for search. */
const ALL_ENTRIES: GazetteerEntry[] = [];

function register(city: string, zone: string): void {
  const key = normalizePlace(city);
  if (!key) return;
  let set = NAME_INDEX.get(key);
  if (!set) {
    set = new Set();
    NAME_INDEX.set(key, set);
    CITY_LABEL.set(key, city);
  }
  if (!set.has(zone)) {
    set.add(zone);
    ALL_ENTRIES.push({ city, zone });
  }
}

// BASE layer — every coord zone by its own city segment (skip the synthetic UTC).
for (const zone of Object.keys(ZONE_COORDS)) {
  if (zone === 'UTC') continue;
  register(zoneCity(zone), zone);
}
// ALIAS layer — colloquial names win the display label for their normalized key
// only if the key is new; a base city keeps its own label.
for (const [name, zone] of ALIAS_SEED) register(name, zone);

/** The outcome of resolving a bare place name against the gazetteer. */
export type PlaceResolution =
  | { readonly kind: 'ok'; readonly zone: string; readonly city: string }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly GazetteerEntry[];
    }
  | { readonly kind: 'unknown'; readonly suggestion: string | null };

/** Levenshtein distance, capped early once it exceeds `max` (returns max+1). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length]!;
}

/** Closest known city name to `key` within edit distance 2, or null. */
function didYouMean(key: string): string | null {
  let best: string | null = null;
  let bestD = 3;
  for (const [name, label] of CITY_LABEL) {
    const d = editDistance(key, name, 2);
    if (d < bestD) {
      bestD = d;
      best = label;
    }
  }
  return best;
}

/**
 * Resolve a bare place name (NOT an IANA id or UTC offset — the parser handles
 * those first) to a zone. Exact/alias hit → `ok`; a name mapping to multiple
 * zones → `ambiguous` with the candidates; nothing close → `unknown` with an
 * optional did-you-mean.
 */
export function resolvePlace(name: string): PlaceResolution {
  const key = normalizePlace(name);
  const set = NAME_INDEX.get(key);
  if (set?.size === 1) {
    const zone = [...set][0]!;
    // Always the canonical city derived from the zone, so an alias like "NYC"
    // or "Bombay" still displays as "New York" / "Kolkata".
    return { kind: 'ok', zone, city: zoneCity(zone) };
  }
  if (set && set.size > 1) {
    const candidates = [...set].map((zone) => ({ city: zoneCity(zone), zone }));
    return { kind: 'ambiguous', candidates };
  }
  return { kind: 'unknown', suggestion: didYouMean(key) };
}

/** One autocomplete suggestion: a city, the zone it resolves to, and its live offset. */
export interface ZoneSuggestion {
  readonly city: string;
  readonly zone: string;
  /** Current UTC offset label (`UTC+1`), computed live at `nowMs`. */
  readonly offsetLabel: string;
}

/**
 * Search the gazetteer for editor autocomplete. Matches `query` against city
 * names, aliases, and raw IANA text; ranks exact → prefix → substring, then
 * alphabetically. Offsets are computed live at `nowMs` so the dropdown shows the
 * current UTC offset next to each candidate. Returns up to `limit` results.
 */
export function searchZones(
  query: string,
  nowMs: number,
  limit = 8
): ZoneSuggestion[] {
  const q = normalizePlace(query);
  if (!q) return [];
  const seen = new Set<string>();
  const scored: { city: string; zone: string; score: number }[] = [];
  const consider = (city: string, zone: string, haystack: string): void => {
    const dedup = `${normalizePlace(city)}|${zone}`;
    if (seen.has(dedup)) return;
    let score: number;
    if (haystack === q) score = 0;
    else if (haystack.startsWith(q)) score = 1;
    else if (haystack.includes(q)) score = 2;
    else return;
    seen.add(dedup);
    scored.push({ city, zone, score });
  };
  for (const e of ALL_ENTRIES) {
    consider(e.city, e.zone, normalizePlace(e.city));
  }
  // Also let a slash-y or region query hit the raw IANA text (`america/new`).
  if (q.includes('/') || q.length >= 3) {
    for (const e of ALL_ENTRIES) {
      consider(e.city, e.zone, e.zone.toLowerCase());
    }
  }
  scored.sort((a, b) => a.score - b.score || a.city.localeCompare(b.city));
  return scored.slice(0, limit).map(({ city, zone }) => ({
    city,
    zone,
    offsetLabel: zoneParts(zone, nowMs).offsetLabel || formatOffsetLabel(0),
  }));
}
