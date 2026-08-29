#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// build-airports-snapshot.mjs — refresh the PINNED OurAirports snapshot that
// `buildAirports()` (in build-map-data.mjs) reads to emit airports.json.
//
// This is the ONLY thing that touches the network for airport data, and you run
// it DELIBERATELY (~annually, or when a user reports a missing/wrong airport) —
// NOT as part of any build. See docs/dev-notes/map-airport-data.md for the full
// maintenance flow + the "don't run the full build:map-data to regen airports"
// gotcha.
//
// It downloads OurAirports airports.csv and prunes it to a lean, deterministic
// slice: the primary gate (scheduled_service=yes + a 3-letter iata_code) and only
// the columns the build consumes, sorted by IATA code for a stable git diff. The
// build's geo-weighting (US large+medium / intl large) is applied LATER, in
// buildAirports — this snapshot is the broader "scheduled airports" universe so
// the filter logic stays visible/auditable in code, not baked into the data.
//
// Usage:
//   node scripts/build-airports-snapshot.mjs                 # fetch live source
//   node scripts/build-airports-snapshot.mjs ./airports.csv  # use a local CSV
//
// After running: regenerate airports.json (offline) + re-check size/collisions +
// run tests + bump PROVENANCE + the "last captured" date in the dev-note.
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'scripts/airports-snapshot.csv');
const SOURCE_URL =
  'https://davidmegginson.github.io/ourairports-data/airports.csv';

// Only the columns buildAirports() reads — keeps the committed snapshot lean.
const KEEP_COLS = [
  'type',
  'name',
  'latitude_deg',
  'longitude_deg',
  'iso_country',
  'scheduled_service',
  'iata_code',
];

/** Minimal RFC-4180-ish CSV row parser (quoted fields may embed commas/quotes).
 *  Byte-identical to parseCsvLine in build-map-data.mjs. */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Re-quote a field for output (quote iff it contains a comma/quote/newline). */
const csvField = (s) =>
  /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;

async function loadSource(arg) {
  if (arg) {
    console.log(`reading local CSV: ${arg}`);
    return readFileSync(resolve(process.cwd(), arg), 'utf8');
  }
  console.log(`fetching ${SOURCE_URL}`);
  if (typeof globalThis.fetch !== 'function') {
    throw new Error(
      'global fetch unavailable — pass a local CSV path (download airports.csv first)'
    );
  }
  const r = await fetch(SOURCE_URL);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${SOURCE_URL}`);
  return r.text();
}

async function main() {
  const text = await loadSource(process.argv[2]);
  const lines = text.split('\n').filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const c of KEEP_COLS) {
    if (col[c] === undefined) {
      throw new Error(`source missing expected column "${c}" (schema drift?)`);
    }
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const iata = c[col.iata_code];
    const sched = c[col.scheduled_service];
    // Primary gate only: scheduled service + a real 3-letter IATA code. The
    // type/country geo-weighting is buildAirports()' job, not the snapshot's.
    if (sched !== 'yes') continue;
    if (!iata || !/^[A-Za-z]{3}$/.test(iata)) continue;
    rows.push(KEEP_COLS.map((k) => c[col[k]]));
  }
  if (rows.length < 1000) {
    throw new Error(
      `only ${rows.length} candidate rows — source schema drift?`
    );
  }

  // Deterministic order: IATA code, then name — a stable git diff across refreshes.
  const iataIdx = KEEP_COLS.indexOf('iata_code');
  const nameIdx = KEEP_COLS.indexOf('name');
  rows.sort((a, b) => {
    if (a[iataIdx] !== b[iataIdx]) return a[iataIdx] < b[iataIdx] ? -1 : 1;
    return a[nameIdx] < b[nameIdx] ? -1 : a[nameIdx] > b[nameIdx] ? 1 : 0;
  });

  const out =
    [KEEP_COLS.map(csvField).join(',')]
      .concat(rows.map((r) => r.map(csvField).join(',')))
      .join('\n') + '\n';
  writeFileSync(OUT, out, 'utf8');
  console.log(
    `wrote ${OUT}\n  ${rows.length} candidate rows / ${(out.length / 1024).toFixed(0)} KB raw / ${(gzipSync(Buffer.from(out)).length / 1024).toFixed(0)} KB gz`
  );
  console.log(
    'next: regenerate airports.json offline (see docs/dev-notes/map-airport-data.md), then test + bump PROVENANCE.'
  );
}

main().catch((e) => {
  console.error('build-airports-snapshot FAILED:', e.message);
  process.exit(1);
});
