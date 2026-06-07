# Maintaining the map airport data (`airports.json`)

**What this covers:** how the IATA-airport data for the `map` chart type is built,
how to regenerate it safely, and **when to refresh the pinned source**. Read this
before touching anything under `src/map/data/airports*` or `scripts/airports-*`.

> **Snapshot last captured: 2026-06-07** (OurAirports `airports.csv`).
> **Review cadence: ~once a year** — see "Periodic refresh" below. Airports open,
> close, and occasionally re-letter; the pinned snapshot does **not** update itself.

---

## The files

| File | Tracked? | What it is |
| ---- | -------- | ---------- |
| `scripts/airports-snapshot.csv` | committed | **Pinned source.** A lean, offline slice of OurAirports `airports.csv` — only rows with `scheduled_service=yes` + a 3-letter `iata_code`, and only the columns the build uses. ~308 KB. This is the input the build reads. |
| `src/map/data/airports.json` | committed | **Runtime asset.** `{ airports: GazetteerEntry[], airportIata }`, ~38 KB gz. Generated from the snapshot. Loaded only for map diagrams (separate optional asset). |
| `src/map/data/airport-collisions.json` | committed | `{ collisions }` — folded IATA codes that are also a gazetteer city name (currently `["aba","ufa"]`). Guards the "city wins" precedence invariant; a test asserts the build's live set equals this file. |

`buildAirports()` lives in `scripts/build-map-data.mjs`.

---

## ⚠️ The gotcha: do NOT run the full `pnpm build:map-data` to regenerate airports

`build-map-data.mjs` regenerates **every** map asset in one run, and most of them
are **fetched live over the network**. One of those — the city **gazetteer**
(`gazetteer.json`) — comes from GeoNames' `cities5000` dump, which is **rebuilt
daily and has no pinnable version**.

So if you run the full build just to refresh airports, you also re-download
GeoNames and silently **re-emit `gazetteer.json`** (and world/US/lakes/etc.),
drifting committed data that has nothing to do with airports — a coordinate
shifts, a city drops — and it sneaks into your "airport" commit.

**Airports are pinned and offline precisely to avoid this.** Regenerate them in
isolation against the *already-committed* gazetteer.

## Regenerate airports only (offline, deterministic)

From the `dgmo/` directory:

```js
// regen-airports.mjs — run with `node regen-airports.mjs`
import { readFileSync } from 'node:fs';
import { buildAirports, writeJson } from './scripts/build-map-data.mjs';

const gaz = JSON.parse(readFileSync('src/map/data/gazetteer.json', 'utf8'));
const built = buildAirports(gaz);                 // reads the committed snapshot; reads gaz READ-ONLY
writeJson('airports.json', built.airports);       // → src/map/data/airports.json
writeJson('airport-collisions.json', { collisions: built.collisions });
console.log(`kept ${built.stats.count} airports; collisions: ${built.collisions.join(', ') || 'none'}`);
```

This makes **zero network calls**, never mutates the gazetteer, and is
byte-deterministic (re-running yields an identical file). After regenerating:

```bash
pnpm build                 # copies the asset into dist/map-data/
pnpm vitest run tests/map-data.test.ts tests/map-resolver.test.ts tests/map-completion.test.ts
```

Then update the airport entries in `src/map/data/PROVENANCE.json` (sha256/bytes/gz
of `airports.json`, `counts.airports`, the snapshot hash) — the build normally
writes these, but an isolated regen doesn't, so refresh them by hand or the
provenance test will lag. (Easiest: recompute hashes in the same script.)

---

## Periodic refresh (refresh the pinned snapshot)

The snapshot is frozen on purpose (deterministic builds, no surprise drift), so it
will **go stale** as airports change. Refresh it deliberately ~annually, or when a
user reports a missing/wrong airport.

1. Refresh the pinned snapshot with the committed generator (fetches OurAirports,
   prunes to the primary gate + the build's columns, sorted by IATA code for a
   stable diff). Review the resulting `git diff scripts/airports-snapshot.csv`:

   ```bash
   node scripts/build-airports-snapshot.mjs            # fetch live source
   # or, offline:
   curl -sL -o /tmp/airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
   node scripts/build-airports-snapshot.mjs /tmp/airports.csv
   ```

2. Regenerate `airports.json` + `airport-collisions.json` from the new snapshot
   (the offline recipe above).
3. **Re-check the size budget.** `airports.json` must stay under its 42 KB gz
   ceiling (`GZ_CEILINGS['airports.json']` in `build-map-data.mjs`). If OurAirports
   has grown a lot, either keep coords at 2 decimals (already the size lever) or
   re-baseline the ceiling deliberately.
4. **Re-check the collision set.** If `airport-collisions.json` changed, the city
   names involved gained/lost an IATA twin — fine, the committed fixture just needs
   to match the new build output (the test enforces equality).
5. Run the full map test suite + `pnpm typecheck`. Update the "last captured" date
   at the top of this note and the `PROVENANCE.json` airport entries.
6. Ship it in a normal dgmo release.

### Selection criteria (what's in the set, and why)

- **Primary gate:** `scheduled_service = yes` — the truest proxy for "a code a
  human would type into a flight diagram" (nobody diagrams a flight to an airport
  with no scheduled service).
- **Geo-weighting on top:** US gets `large_airport` **and** `medium_airport` (all
  scheduled commercial — captures regionals like John Wayne `SNA`); the rest of the
  world gets `large_airport` only (the big hubs).
- **Dedup:** on a duplicate IATA code, keep the higher `type`, tie-break by lower
  code string (deterministic).
- Coords are rounded to **2 decimals** (~1 km — sub-pixel at map scale, and the
  knob that keeps the file under budget). The gazetteer uses 3; airports use 2 on
  purpose.

> Reality vs. the original estimate: OurAirports tags ~1063 non-US airports
> `large_airport` (≈3× the ~350 first guessed), so the set is ~1565 airports /
> ~38 KB gz, not the ~800 / ~25 KB first sketched. That's expected — the size
> budget is **measured**, not assumed (the build records the actual gz delta).

## Source & license

OurAirports — `https://davidmegginson.github.io/ourairports-data/airports.csv`
(mirror of `https://ourairports.com/data/`). **Public domain.** Recorded in
`src/map/data/PROVENANCE.json` under `sources.ourairports`.

## Related

- Spec: `docs/dgmo-language-spec.md` §24B.8/.10/.11 + the 2026-06-07 decision-log entry.
- Tech-spec: `_bmad-output/implementation-artifacts/tech-spec-map-airport-iata-codes.md`.
- ADR-4 (pinned snapshot, not live rebuild) and the city-wins precedence (ADR-2)
  are documented in the tech-spec.
