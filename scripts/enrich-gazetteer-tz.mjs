// ============================================================
// Enrich the COMMITTED gazetteer.json with IANA time zones (BL-122)
// ============================================================
//
// The clock-on-map feature needs each city's IANA zone so `poi Denver clock`
// derives its local time WITHOUT the user restating the zone. The zone lives in
// the GeoNames `cities5000` source (column 18, `timezone`) — we just never
// captured it.
//
// This does NOT rebuild the gazetteer (that source is daily-rebuilt, so a full
// `build:map-data` would churn the whole city list). Instead it MATCHES each
// already-committed city to its GeoNames row (folded name + country + nearest
// coordinates) and attaches:
//   • `zones`  — the distinct IANA ids, sorted
//   • `tz`     — an array parallel to `cities`; tz[i] = index into `zones`
//                (−1 when a city has no match, which is essentially never)
// `cities` / `byName` / `alt` are preserved byte-for-byte, so nothing else in
// the pipeline shifts. Re-runnable + deterministic (canonical emit).
//
//   node scripts/enrich-gazetteer-tz.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { unzipSync, strFromU8 } from 'fflate';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAZ_PATH = resolve(HERE, '../src/map/data/gazetteer.json');
const CITIES_URL = 'https://download.geonames.org/export/dump/cities5000.zip';

const fold = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort(cmp)) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function httpsGet(url, redirectsLeft = 5) {
  return new Promise((res, rej) => {
    const req = https.get(url, { timeout: 60_000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        if (redirectsLeft <= 0) return rej(new Error('too many redirects'));
        const next = new URL(r.headers.location, url).toString();
        r.resume();
        return httpsGet(next, redirectsLeft - 1).then(res, rej);
      }
      if (r.statusCode !== 200)
        return rej(new Error(`HTTP ${r.statusCode} for ${url}`));
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks)));
    });
    req.on('error', rej);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
  });
}

const haversine = (aLat, aLon, bLat, bLon) => {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function main() {
  console.log('• fetching', CITIES_URL);
  const zip = await httpsGet(CITIES_URL);
  const files = unzipSync(new Uint8Array(zip));
  const tsv = strFromU8(files['cities5000.txt']);

  // Index GeoNames rows by folded-name + country → candidate coords + tz.
  const index = new Map();
  let rows = 0;
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length !== 19) continue;
    const name = c[1];
    const lat = Number(c[4]);
    const lon = Number(c[5]);
    const cc = c[8];
    const tz = c[17];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !cc || !tz) continue;
    const key = fold(name) + '|' + cc;
    let arr = index.get(key);
    if (!arr) index.set(key, (arr = []));
    arr.push({ lat, lon, tz });
    rows++;
  }
  console.log(`• indexed ${rows} GeoNames rows, ${index.size} name·cc keys`);

  const gaz = JSON.parse(readFileSync(GAZ_PATH, 'utf8'));
  const zones = [];
  const zoneId = new Map();
  const idFor = (z) => {
    let id = zoneId.get(z);
    if (id === undefined) {
      id = zones.length;
      zones.push(z);
      zoneId.set(z, id);
    }
    return id;
  };

  const tz = new Array(gaz.cities.length).fill(-1);
  let matched = 0;
  const misses = [];
  gaz.cities.forEach((city, i) => {
    const [lat, lon, cc, , name] = city;
    const cands = index.get(fold(name) + '|' + cc);
    if (!cands || !cands.length) {
      misses.push(name + ' (' + cc + ')');
      return;
    }
    // Nearest candidate by great-circle distance (the committed coord is the
    // 3-dp round of one of these rows, so the nearest IS the same city).
    let best = cands[0];
    let bestD = haversine(lat, lon, best.lat, best.lon);
    for (let k = 1; k < cands.length; k++) {
      const d = haversine(lat, lon, cands[k].lat, cands[k].lon);
      if (d < bestD) {
        bestD = d;
        best = cands[k];
      }
    }
    tz[i] = idFor(best.tz);
    matched++;
  });

  // Sort zones for a stable, readable table; remap tz indices accordingly.
  const order = zones.map((z, id) => ({ z, id })).sort((a, b) => cmp(a.z, b.z));
  const remap = new Array(zones.length);
  order.forEach((o, newId) => (remap[o.id] = newId));
  const sortedZones = order.map((o) => o.z);
  const tzRemapped = tz.map((id) => (id < 0 ? -1 : remap[id]));

  gaz.zones = sortedZones;
  gaz.tz = tzRemapped;

  writeFileSync(GAZ_PATH, JSON.stringify(sortKeys(gaz)) + '\n', 'utf8');
  console.log(
    `• matched ${matched}/${gaz.cities.length} cities · ${sortedZones.length} distinct zones`
  );
  if (misses.length)
    console.log(
      `• ${misses.length} unmatched (no auto-zone):`,
      misses.join(', ')
    );
  console.log('• wrote', GAZ_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
