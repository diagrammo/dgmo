#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// build-map-data.mjs — offline, deterministic build for the `map` chart type's
// static geographic assets. Produces committed JSON in src/map/data/:
//   world-coarse.json  world-detail.json  us-states.json  gazetteer.json
//   + types.ts (hand-written, never overwritten here) + PROVENANCE.json + README.md
//
// DEV-ONLY. Never wired into prebuild/build/test. Run manually:
//   pnpm build:map-data
//
// Spec: _bmad-output/implementation-artifacts/tech-spec-map-data-build.md
// Determinism: sorted keys, fixed coord precision (gazetteer floats only — NEVER
// TopoJSON arcs/transform), no timestamps in output, pinned source versions.
//
// Data sources (CC BY 4.0 GeoNames; Natural Earth/US Census via world-atlas/
// us-atlas). Attribution in src/map/data/README.md. GeoNames has no pinnable
// snapshot (rebuilt daily) — the COMMITTED gazetteer.json is the source of truth;
// PROVENANCE.json is the audit trail.
// =============================================================================

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import https from 'node:https';
import { unzipSync, strFromU8 } from 'fflate';

const require = createRequire(import.meta.url);
const mapshaper = require('mapshaper');

// --- Node guard (R10): engines floor is >=20.6; global fetch is experimental
// on 20.x, so fall back to node:https when fetch is absent. -----------------
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 6)) {
  console.error(`Node >= 20.6 required (have ${process.versions.node})`);
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/map/data');

// --- Pinned sources ---------------------------------------------------------
const SOURCES = {
  // Two world tiers from TWO sources (by design — different feature counts, so
  // no cross-tier key-set equality): 110m for world-scale coarse (~11-18KB gz),
  // 50m for regional detail (islands present). Matches §24B.11.
  worldCoarse: {
    version: '2.0.2',
    url: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json',
  },
  worldDetail: {
    version: '2.0.2',
    url: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json',
  },
  usAtlas: {
    version: '3.0.1',
    url: 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json',
  },
  geonames: {
    // Daily-rebuilt; NOT version-pinnable. Committed gazetteer.json is canonical.
    citiesUrl: 'https://download.geonames.org/export/dump/cities5000.zip',
    license: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
  },
  lakes: {
    // Natural Earth 110m physical lakes (incl. the Great Lakes) — drawn as water
    // over land, since the country/state polygons don't carve lakes out.
    version: 'natural-earth 110m (martynafford snapshot)',
    url: 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/110m/physical/ne_110m_lakes.json',
  },
  rivers: {
    // Natural Earth 110m river + lake centerlines — drawn as thin water lines
    // over land. The 110m tier is Natural Earth's own "major rivers" curation
    // (Amazon, Nile, Mississippi, Yangtze, …) — small by design ("nothing big").
    version: 'natural-earth 110m (martynafford snapshot)',
    url: 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/110m/physical/ne_110m_rivers_lake_centerlines.json',
  },
  naLand: {
    // Natural Earth 10m countries, CLIPPED to a North-America bbox: crisp
    // neighbour context (Canada/Mexico) under the albers-usa US view so the
    // surrounding land matches the 10m states instead of the coarser world tiers.
    version: 'natural-earth 10m (nvkelso vector snapshot)',
    url: 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_admin_0_countries.geojson',
  },
  naLakes: {
    // Natural Earth 10m lakes, clipped to the same NA bbox and filtered to the
    // major (scalerank ≤ 2) lakes — the Great Lakes etc. at states resolution.
    version: 'natural-earth 10m (martynafford snapshot)',
    url: 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/physical/ne_10m_lakes.json',
  },
  mountainRanges: {
    // Natural Earth 10m geography regions, filtered to FEATURECLA "Range/mtn" —
    // notable mountain ranges (Rockies, Andes, Alps, Himalayas, …) drawn as a
    // subtle hachure relief cue when the `relief` directive is on. Hand-drawn
    // label-regions (not elevation-derived), so coarse by nature; v1 is single
    // tier (no height). The 10m tier carries ~70 more ranges than 50m (better
    // coverage of smaller CA/inter-mountain ranges); per-range outlines match 50m,
    // so MOUNTAIN_RETAIN does the heavy lifting on shape fidelity (see below).
    // License: public domain (Natural Earth).
    version: 'natural-earth 10m (nvkelso vector snapshot)',
    url: 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_geography_regions_polys.geojson',
  },
  marineCoarse: {
    // Natural Earth 110m geography marine polys — oceans + major seas/bays/gulfs.
    // Source of the `context-labels` orientation water names (no rivers/reefs).
    version: 'natural-earth 110m (nvkelso vector snapshot)',
    url: 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_geography_marine_polys.geojson',
  },
  marineDetail: {
    // Natural Earth 50m geography marine polys — adds smaller seas, gulfs, bays,
    // straits, channels, sounds (scalerank 0..4). The detail tier for water names.
    version: 'natural-earth 50m (nvkelso vector snapshot)',
    url: 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_geography_marine_polys.geojson',
  },
};

// --- Tunable constants (tuned empirically; see build log for actual sizes) --
const WORLD_COARSE_RETAIN = 40; // % of 110m — world-scale; islands vanish
const WORLD_DETAIL_RETAIN = 20; // % of 50m — regional/zoom; islands survive
const US_RETAIN = 15; // % of 10m
const QUANT_COARSE = 10_000; // TopoJSON quantization (size lever)
const QUANT_DETAIL = 6_000;
const QUANT_US = 10_000;
const LAKES_RETAIN = 20; // % of 110m lakes
const QUANT_LAKES = 10_000;
const RIVERS_RETAIN = 40; // % of 110m river centerlines (thin lines — keep shape)
const QUANT_RIVERS = 10_000;
// Mountain ranges: `-simplify N%` RETAINS N% of vertices — higher = crisper AND
// bigger. Tuned for SHAPE FIDELITY first, not size (the Task 0 eyeball lever).
// These polys are coarse hand-drawn label-regions (Sierra Nevada is ~36 verts,
// the Rockies ~114), so over-simplifying collapses CA/Rockies into ugly triangles
// — at the old 8% Sierra Nevada was ~3 verts. Measured on the 10m data: 8%→14KB,
// 30%→21KB, 50%→26.5KB, 80%→33KB gz. 50% keeps the outlines smooth while staying
// under the 30KB ceiling; raise the ceiling (not lower this) for more fidelity.
const MOUNTAIN_RETAIN = 50; // % of 10m geography_regions_polys mountain polys
const QUANT_MOUNTAIN = 10_000;
// North-America clip: lon -140..-52, lat 10..66 (CONUS + Canada/Mexico/Caribbean
// edge). Keeps the crisp 10m assets small while covering everything the conic
// US frame can show.
const NA_BBOX = '-140,10,-52,66';
const NA_LAND_RETAIN = 18; // % of 10m countries (post-clip)
const NA_LAKES_RETAIN = 35; // % of 10m lakes (post-clip)
const NA_LAKES_SCALERANK = 2; // keep only major lakes (Great Lakes etc.)
const QUANT_NA = 10_000;
const COORD_PRECISION = 3; // gazetteer lat/lon decimals
const WORLD_POP_FLOOR = 500_000; // "world majors"
const US_POP_FLOOR = 50_000; // US cities; capitals force-included below this
const MIN_KEPT_CITIES = 1000; // build fails if the gazetteer comes out near-empty (F8)
// gz ceilings (bytes). Generous-but-real; build fails loud if exceeded.
const GZ_CEILINGS = {
  'world-coarse.json': 25_000,
  'world-detail.json': 60_000,
  'us-states.json': 15_000,
  'lakes.json': 6_000,
  'rivers.json': 8_000,
  'na-land.json': 40_000,
  'na-lakes.json': 14_000,
  // ~30KB (not 20) — headroom for fidelity escalation (higher retain %, 10m
  // bump, or widening to Plateau/Foothills). A deliberate bump past this means
  // re-baselining the ceiling, not silently raising simplification.
  'mountain-ranges.json': 30_000,
  // ~115 tuple entries (oceans/seas/gulfs/bays/straits/channels/sounds) at ~3KB
  // gz; 6KB leaves headroom for name growth without re-baselining.
  'water-bodies.json': 6_000,
  'gazetteer.json': 70_000,
  'region-names.json': 8_000,
  // Airports (OurAirports IATA-coded): own ceiling, separate from gazetteer's
  // 70KB gate. Measured ~38KB gz at 1565 airports / 2-decimal coords; 42KB
  // leaves headroom for name growth. A deliberate bump means re-baselining here.
  'airports.json': 42_000,
};

// --- ISO 3166-1 numeric -> alpha-2 (embedded; from lukes/ISO-3166, ADR-6) ---
// 249 entries. Static ISO data — never fetched at build time.
const ISO_NUMERIC_COMPACT =
  '004:AF 008:AL 010:AQ 012:DZ 016:AS 020:AD 024:AO 028:AG 031:AZ 032:AR 036:AU 040:AT 044:BS 048:BH 050:BD 051:AM 052:BB 056:BE 060:BM 064:BT 068:BO 070:BA 072:BW 074:BV 076:BR 084:BZ 086:IO 090:SB 092:VG 096:BN 100:BG 104:MM 108:BI 112:BY 116:KH 120:CM 124:CA 132:CV 136:KY 140:CF 144:LK 148:TD 152:CL 156:CN 158:TW 162:CX 166:CC 170:CO 174:KM 175:YT 178:CG 180:CD 184:CK 188:CR 191:HR 192:CU 196:CY 203:CZ 204:BJ 208:DK 212:DM 214:DO 218:EC 222:SV 226:GQ 231:ET 232:ER 233:EE 234:FO 238:FK 239:GS 242:FJ 246:FI 248:AX 250:FR 254:GF 258:PF 260:TF 262:DJ 266:GA 268:GE 270:GM 275:PS 276:DE 288:GH 292:GI 296:KI 300:GR 304:GL 308:GD 312:GP 316:GU 320:GT 324:GN 328:GY 332:HT 334:HM 336:VA 340:HN 344:HK 348:HU 352:IS 356:IN 360:ID 364:IR 368:IQ 372:IE 376:IL 380:IT 384:CI 388:JM 392:JP 398:KZ 400:JO 404:KE 408:KP 410:KR 414:KW 417:KG 418:LA 422:LB 426:LS 428:LV 430:LR 434:LY 438:LI 440:LT 442:LU 446:MO 450:MG 454:MW 458:MY 462:MV 466:ML 470:MT 474:MQ 478:MR 480:MU 484:MX 492:MC 496:MN 498:MD 499:ME 500:MS 504:MA 508:MZ 512:OM 516:NA 520:NR 524:NP 528:NL 531:CW 533:AW 534:SX 535:BQ 540:NC 548:VU 554:NZ 558:NI 562:NE 566:NG 570:NU 574:NF 578:NO 580:MP 581:UM 583:FM 584:MH 585:PW 586:PK 591:PA 598:PG 600:PY 604:PE 608:PH 612:PN 616:PL 620:PT 624:GW 626:TL 630:PR 634:QA 638:RE 642:RO 643:RU 646:RW 652:BL 654:SH 659:KN 660:AI 662:LC 663:MF 666:PM 670:VC 674:SM 678:ST 682:SA 686:SN 688:RS 690:SC 694:SL 702:SG 703:SK 704:VN 705:SI 706:SO 710:ZA 716:ZW 724:ES 728:SS 729:SD 732:EH 740:SR 744:SJ 748:SZ 752:SE 756:CH 760:SY 762:TJ 764:TH 768:TG 772:TK 776:TO 780:TT 784:AE 788:TN 792:TR 795:TM 796:TC 798:TV 800:UG 804:UA 807:MK 818:EG 826:GB 831:GG 832:JE 833:IM 834:TZ 840:US 850:VI 854:BF 858:UY 860:UZ 862:VE 876:WF 882:WS 887:YE 894:ZM';
const ISO_NUMERIC_TO_ALPHA2 = Object.fromEntries(
  ISO_NUMERIC_COMPACT.split(' ').map((p) => p.split(':'))
);

// world-atlas features with no numeric id (R4). Kosovo -> de-facto XK; the rest
// have no ISO code and are dropped or merged (documented). Any NEW no-id feature
// = hard fail.
const NAME_TO_ISO2_FALLBACK = { Kosovo: 'XK' };
// Disputed/unrecognized territories that border a sovereign parent in the source
// and would otherwise leave an unfilled HOLE if simply dropped: world-atlas models
// them as a SEPARATE polygon sharing a border arc with the parent (Somaliland is
// carved OUT of Somalia, N. Cyprus out of Cyprus). Dropping the child orphaned
// that shared boundary and the child's interior rendered as background. Merge each
// child into its parent (dissolving the shared arc) so the parent fills solid —
// the politically-neutral default of folding the territory into the internationally
// recognized state. Keyed by child feature name -> parent feature name.
const MERGE_INTO_PARENT = {
  Somaliland: 'Somalia',
  'N. Cyprus': 'Cyprus',
};
// No sovereign parent to merge into / negligible footprint — dropped outright
// (scattered islands, a glacier high in Kashmir); neither leaves a visible hole.
const DROP_NAMES = new Set(['Indian Ocean Ter.', 'Siachen Glacier']);

// --- US FIPS -> ISO 3166-2 (embedded; 56 = 50 states + DC + 5 territories, R7) -
const FIPS_TO_ISO2 = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP',
  '72': 'PR', '78': 'VI',
};
// 50 states + DC (territories excluded) — the positive presence check (F10).
const US_TERRITORIES = new Set(['AS', 'GU', 'MP', 'PR', 'VI']);
const STATE_DC_CODES = Object.values(FIPS_TO_ISO2)
  .filter((u) => !US_TERRITORIES.has(u))
  .map((u) => `US-${u}`);

// --- US state capitals (force-included regardless of US_POP_FLOOR, R12) ------
// Matched by (folded name, US-XX). Guarantees small capitals (Montpelier ~8k,
// Pierre ~14k) survive — they're present in cities5000 (>=5k floor).
const US_CAPITALS = {
  AL: 'Montgomery', AK: 'Juneau', AZ: 'Phoenix', AR: 'Little Rock',
  CA: 'Sacramento', CO: 'Denver', CT: 'Hartford', DE: 'Dover',
  FL: 'Tallahassee', GA: 'Atlanta', HI: 'Honolulu', ID: 'Boise',
  IL: 'Springfield', IN: 'Indianapolis', IA: 'Des Moines', KS: 'Topeka',
  KY: 'Frankfort', LA: 'Baton Rouge', ME: 'Augusta', MD: 'Annapolis',
  MA: 'Boston', MI: 'Lansing', MN: 'Saint Paul', MS: 'Jackson',
  MO: 'Jefferson City', MT: 'Helena', NE: 'Lincoln', NV: 'Carson City',
  NH: 'Concord', NJ: 'Trenton', NM: 'Santa Fe', NY: 'Albany',
  NC: 'Raleigh', ND: 'Bismarck', OH: 'Columbus', OK: 'Oklahoma City',
  OR: 'Salem', PA: 'Harrisburg', RI: 'Providence', SC: 'Columbia',
  SD: 'Pierre', TN: 'Nashville', TX: 'Austin', UT: 'Salt Lake City',
  VT: 'Montpelier', VA: 'Richmond', WA: 'Olympia', WV: 'Charleston',
  WI: 'Madison', WY: 'Cheyenne',
};
const CAPITAL_KEYS = new Set(
  Object.entries(US_CAPITALS).map(([st, name]) => `${fold(name)}|US-${st}`)
);

// --- Curated abbreviation/exonym aliases (F5) -------------------------------
// Folded alias → matcher. Small + high-signal (unlike mined col-4 fragments).
// Resolved to the most-populous matching city at build time; `sub` pins a US
// subdivision, else `iso` pins the country. Names must match GeoNames' display.
const CURATED_ALIASES = {
  nyc: { name: 'New York City', iso: 'US' },
  la: { name: 'Los Angeles', iso: 'US' },
  sf: { name: 'San Francisco', iso: 'US' },
  dc: { name: 'Washington', sub: 'US-DC' },
  vegas: { name: 'Las Vegas', iso: 'US' },
  philly: { name: 'Philadelphia', iso: 'US' },
  nola: { name: 'New Orleans', iso: 'US' },
  'washington dc': { name: 'Washington', sub: 'US-DC' },
};

// =============================================================================
// Helpers
// =============================================================================

/** Locale-independent ASCII fold for matching/keys (R13/R21). */
function fold(s) {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Codepoint comparator (locale-independent; -1/0/1). */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Recursively sort object keys (codepoint order; no locale). Arrays keep order.
 *  Does NOT round numbers — gazetteer coords are pre-rounded at build; TopoJSON
 *  arcs/transform must never be rounded (R11). */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort(cmp)) {
      out[k] = sortKeys(v[k]);
    }
    return out;
  }
  return v;
}

/** Canonical emit: sorted keys, minified, LF, trailing newline (Decision 7). */
function writeJson(name, obj) {
  const text = JSON.stringify(sortKeys(obj)) + '\n';
  writeFileSync(resolve(OUT, name), text, 'utf8');
  return Buffer.from(text, 'utf8');
}

const round = (n) => Number(n.toFixed(COORD_PRECISION));

/** GET a URL with node:https (fetch fallback for Node 20.x), returns Buffer.
 *  Bounded redirects (resolved against the base URL) + a request timeout so a
 *  redirect loop or a hung CDN can't wedge the build (F7). */
function httpsGet(url, redirectsLeft = 5) {
  return new Promise((res, rej) => {
    const req = https.get(url, { timeout: 30_000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        if (redirectsLeft <= 0) return rej(new Error(`Too many redirects: ${url}`));
        const next = new URL(r.headers.location, url).href; // handles relative Location
        return httpsGet(next, redirectsLeft - 1).then(res, rej);
      }
      if (r.statusCode !== 200) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode} for ${url}`));
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout: ${url}`)));
    req.on('error', rej);
  });
}

async function download(url) {
  if (typeof globalThis.fetch === 'function') {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
  }
  return httpsGet(url);
}

// sha256 of each fetched source's raw bytes — recorded in PROVENANCE so a future
// regenerate diff can distinguish upstream drift from a real regression (F14).
const sourceHashes = {};

/** Download + validate (R14/Decision 14). kind: 'topojson' | 'zip'. */
async function fetchValidated(url, kind) {
  console.log(`  fetch ${url}`);
  const buf = await download(url);
  if (buf.length < 1024) throw new Error(`Suspiciously small (${buf.length}B): ${url}`);
  sourceHashes[url] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  if (kind === 'topojson') {
    const head = buf.subarray(0, 64).toString('utf8').trimStart();
    if (!head.startsWith('{')) throw new Error(`Not JSON (CDN error page?): ${url}`);
    const topo = JSON.parse(buf.toString('utf8'));
    if (topo.type !== 'Topology' || !topo.objects || !Object.keys(topo.objects).length) {
      throw new Error(`Not a valid TopoJSON Topology: ${url}`);
    }
    return topo;
  }
  if (kind === 'zip') {
    // PK\x03\x04 local-file-header magic (R2 — node:zlib can't read PKZIP).
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error(`Not a zip: ${url}`);
    return buf;
  }
  return buf;
}

/** Extract a named .txt entry from a GeoNames zip Buffer (R2, fflate). Pins the
 *  expected filename so a schema/file change can't silently mis-select (F8). */
function unzipEntry(zipBuf, expectedName) {
  const files = unzipSync(new Uint8Array(zipBuf));
  if (!files[expectedName]) {
    throw new Error(`zip missing expected entry "${expectedName}" (has: ${Object.keys(files).join(', ')})`);
  }
  return strFromU8(files[expectedName]);
}

// =============================================================================
// Geometry: re-key TopoJSON by ISO code
// =============================================================================

/** Build the lakes layer (Natural Earth 110m physical lakes) as a simplified
 *  TopoJSON `lakes` object, ids assigned by index. Source is GeoJSON (not
 *  TopoJSON), so it's fetched raw and converted via mapshaper. */
async function buildLakes(url) {
  console.log('• lakes (110m physical)');
  console.log(`  fetch ${url}`);
  const buf = await download(url);
  if (buf.length < 1024) throw new Error(`lakes: suspiciously small (${buf.length}B)`);
  sourceHashes[url] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  const geo = JSON.parse(buf.toString('utf8'));
  geo.features.forEach((f, i) => { f.id = `lake-${i}`; });
  const out = await mapshaper.applyCommands(
    `-i in.json -rename-layers lakes -simplify ${LAKES_RETAIN}% keep-shapes -o quantization=${QUANT_LAKES} format=topojson out.json`,
    { 'in.json': Buffer.from(JSON.stringify(geo)) }
  );
  const topo = JSON.parse(Buffer.from(out['out.json']).toString('utf8'));
  const geoms = topo.objects.lakes.geometries;
  geoms.forEach((g, i) => { if (g.id == null) g.id = `lake-${i}`; });
  console.log(`  lakes: ${geoms.length}`);
  return topo;
}

/** Build the rivers layer (Natural Earth 110m river/lake centerlines) as a
 *  simplified TopoJSON `rivers` object, ids assigned by index. Source is GeoJSON
 *  (LineString/MultiLineString), fetched raw and converted via mapshaper. Unlike
 *  lakes there is no `keep-shapes` (a polygon flag) — these are open lines. */
async function buildRivers(url) {
  console.log('• rivers (110m centerlines)');
  console.log(`  fetch ${url}`);
  const buf = await download(url);
  if (buf.length < 1024) throw new Error(`rivers: suspiciously small (${buf.length}B)`);
  sourceHashes[url] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  const geo = JSON.parse(buf.toString('utf8'));
  geo.features.forEach((f, i) => { f.id = `river-${i}`; });
  const out = await mapshaper.applyCommands(
    `-i in.json -rename-layers rivers -simplify ${RIVERS_RETAIN}% -o quantization=${QUANT_RIVERS} format=topojson out.json`,
    { 'in.json': Buffer.from(JSON.stringify(geo)) }
  );
  const topo = JSON.parse(Buffer.from(out['out.json']).toString('utf8'));
  const geoms = topo.objects.rivers.geometries;
  geoms.forEach((g, i) => { if (g.id == null) g.id = `river-${i}`; });
  console.log(`  rivers: ${geoms.length}`);
  return topo;
}

/** Build the NA-clipped 10m land layer: crisp neighbour context for the
 *  albers-usa US view. Clip to NA_BBOX, simplify, rekey by ISO 3166-1 alpha-2
 *  (matching the world tiers so the resolver/renderer treat it identically),
 *  and strip per-feature properties (renderer derives nothing from them). */
async function buildNaLand(url) {
  console.log('• na-land (10m countries, NA-clipped)');
  console.log(`  fetch ${url}`);
  const buf = await download(url);
  if (buf.length < 1024) throw new Error(`na-land: suspiciously small (${buf.length}B)`);
  sourceHashes[url] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  const out = await mapshaper.applyCommands(
    `-i in.json -clip bbox=${NA_BBOX} -simplify ${NA_LAND_RETAIN}% keep-shapes -rename-layers countries -o quantization=${QUANT_NA} format=topojson out.json`,
    { 'in.json': buf }
  );
  const topo = JSON.parse(Buffer.from(out['out.json']).toString('utf8'));
  const geoms = topo.objects.countries.geometries;
  const kept = [];
  for (const g of geoms) {
    const p = g.properties || {};
    const iso = p.ISO_A2_EH || p.ISO_A2 || p.iso_a2;
    if (iso && iso !== '-99') {
      g.id = iso;
      delete g.properties;
      kept.push(g);
    }
  }
  topo.objects.countries.geometries = kept;
  console.log(`  na-land countries: ${kept.length}`);
  return topo;
}

/** Build the NA-clipped 10m major-lakes layer (Great Lakes etc.) — the lakes
 *  counterpart to buildNaLand, used in place of the coarse 110m `lakes` under
 *  the US view. Clip to NA_BBOX, drop minor lakes by scalerank, simplify. */
async function buildNaLakes(url) {
  console.log('• na-lakes (10m lakes, NA-clipped)');
  console.log(`  fetch ${url}`);
  const buf = await download(url);
  if (buf.length < 1024) throw new Error(`na-lakes: suspiciously small (${buf.length}B)`);
  sourceHashes[url] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  const geo = JSON.parse(buf.toString('utf8'));
  geo.features.forEach((f, i) => { f.id = `lake-${i}`; });
  const out = await mapshaper.applyCommands(
    `-i in.json -clip bbox=${NA_BBOX} -filter 'scalerank <= ${NA_LAKES_SCALERANK}' -simplify ${NA_LAKES_RETAIN}% keep-shapes -rename-layers lakes -o quantization=${QUANT_NA} format=topojson out.json`,
    { 'in.json': Buffer.from(JSON.stringify(geo)) }
  );
  const topo = JSON.parse(Buffer.from(out['out.json']).toString('utf8'));
  const geoms = topo.objects.lakes.geometries;
  geoms.forEach((g, i) => { g.id = `lake-${i}`; delete g.properties; });
  console.log(`  na-lakes: ${geoms.length}`);
  return topo;
}

/** Build the mountain-ranges layer (Natural Earth 50m geography_regions_polys,
 *  filtered to FEATURECLA "Range/mtn"). Source is GeoJSON with UPPERCASE props
 *  (FEATURECLA/NAME/REGION + ~30 multilingual NAME_* fields that MUST be
 *  stripped). Drops Antarctica (a relief smear on the clipped world frame),
 *  strips to {name, cla}, assigns synthetic ids (decodeLayer keys by g.id — NE
 *  polys have none, so without ids the layer collapses to one feature), then
 *  simplifies. Single tier (NE has no elevation on these polys). */
async function buildMountainRanges(url) {
  console.log('• mountain-ranges (10m geography regions, Range/mtn)');
  console.log(`  fetch ${url}`);
  const buf = await download(url);
  if (buf.length < 1024) throw new Error(`mountain-ranges: suspiciously small (${buf.length}B)`);
  sourceHashes[url] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  const geo = JSON.parse(buf.toString('utf8'));
  const kept = [];
  for (const f of geo.features) {
    const p = f.properties || {};
    const cla = p.FEATURECLA ?? p.featurecla;
    const region = p.REGION ?? p.region;
    if (cla !== 'Range/mtn') continue;
    if (region === 'Antarctica') continue;
    const name = p.NAME ?? p.name ?? '';
    f.properties = { name, cla }; // drop the ~30 multilingual NAME_* fields
    f.id = `mtn-${kept.length}`;
    kept.push(f);
  }
  if (!kept.length) throw new Error('mountain-ranges: no Range/mtn features (source schema drift?)');
  geo.features = kept;
  const out = await mapshaper.applyCommands(
    `-i in.json -rename-layers ranges -simplify ${MOUNTAIN_RETAIN}% keep-shapes -o quantization=${QUANT_MOUNTAIN} format=topojson out.json`,
    { 'in.json': Buffer.from(JSON.stringify(geo)) }
  );
  const topo = JSON.parse(Buffer.from(out['out.json']).toString('utf8'));
  const geoms = topo.objects.ranges.geometries;
  // Re-assign synthetic ids by index (topojson conversion may not carry the
  // GeoJSON Feature.id through); decodeLayer requires unique non-null ids.
  geoms.forEach((g, i) => { g.id = `mtn-${i}`; });
  console.log(`  mountain-ranges: ${geoms.length}`);
  return topo;
}

// --- Water bodies (context-labels orientation layer) ------------------------
// featurecla → WaterKind. `river`/`reef` are intentionally excluded (Decision 5).
const WATER_KIND = new Set(['ocean', 'sea', 'gulf', 'bay', 'strait', 'channel', 'sound']);
// Single editorial override layer (Decision 11): the ONE auditable place a
// generated name can be hand-adjusted. Keyed by the Natural Earth `name`.
const WATER_NAME_OVERRIDES = { 'Gulf of Mexico': 'Gulf of America' };

// Curated extra label anchors for the big oceans, keyed by display name. Natural
// Earth ships ONE inner point per ocean (mid-basin), which projects off-frame on
// a zoomed-in COASTAL view — so the layout's edge-clamp drops it and a regional
// map of, say, California shows no "Pacific Ocean". These coastal `[lat, lon]`
// alternates (all open water) give the multi-anchor picker a point near a coast
// to clamp to the frame edge. The mid-basin NE point stays primary for world
// views. Emitted as the optional 6th tuple element `alt` (see WaterBodyEntry).
const WATER_ALT_ANCHORS = {
  'North Pacific Ocean': [[36, -126], [47, -131], [55, -143], [35, 160], [15, 165]],
  'South Pacific Ocean': [[-20, -110], [-40, -95], [-15, 170], [-35, 170]],
  'North Atlantic Ocean': [[40, -55], [30, -45], [50, -25], [15, -45]],
  'South Atlantic Ocean': [[-25, -35], [-40, -15], [-10, -20]],
};

/** Natural Earth ships a few names ALL-CAPS (SOUTHERN OCEAN, INDIAN OCEAN);
 *  title-case multi-word all-caps names for display consistency with the rest. */
function normalizeWaterName(name) {
  if (name !== name.toUpperCase() || !/\s/.test(name)) return name;
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build the water-bodies orientation gazetteer from Natural Earth marine polys
 *  (110m oceans/major-seas + 50m detail). Emits TUPLE entries `[lat, lon, name,
 *  tier, kind]` (NOT topology — the layout just needs label anchors). Anchor =
 *  mapshaper inner point (guaranteed inside the polygon). De-duped across tiers
 *  by folded name (110m first → oceans keep their broad-tier anchor). Rivers and
 *  reefs are dropped (Decision 5). Single editorial override applied (Decision 11). */
async function buildWaterBodies(coarseUrl, detailUrl) {
  console.log('• water-bodies (110m + 50m geography marine polys)');
  const seen = new Set();
  const entries = [];
  for (const url of [coarseUrl, detailUrl]) {
    console.log(`  fetch ${url}`);
    const buf = await download(url);
    if (buf.length < 1024) throw new Error(`water-bodies: suspiciously small (${buf.length}B)`);
    sourceHashes[url] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
    const geo = JSON.parse(buf.toString('utf8'));
    // Inner label points (one per polygon feature), carrying properties through.
    geo.features.forEach((f, i) => { f.id = `w-${i}`; });
    const out = await mapshaper.applyCommands(
      '-i in.json -points inner -o out.json',
      { 'in.json': Buffer.from(JSON.stringify(geo)) }
    );
    const pts = JSON.parse(Buffer.from(out['out.json']).toString('utf8'));
    for (const f of pts.features) {
      const p = f.properties || {};
      const cla = p.featurecla ?? p.FEATURECLA;
      if (!WATER_KIND.has(cla)) continue; // drop river/reef/unknown
      const rawName = p.name ?? p.NAME;
      if (!rawName) continue;
      const name = WATER_NAME_OVERRIDES[rawName] ?? normalizeWaterName(rawName);
      const key = fold(rawName);
      if (seen.has(key)) continue; // 110m wins for oceans/major seas
      seen.add(key);
      const [lon, lat] = f.geometry.coordinates;
      const tier = Number.isFinite(p.scalerank) ? p.scalerank : 5;
      const alt = WATER_ALT_ANCHORS[name];
      entries.push(
        alt
          ? [round(lat), round(lon), name, tier, cla, alt]
          : [round(lat), round(lon), name, tier, cla]
      );
    }
  }
  if (!entries.length) throw new Error('water-bodies: no marine features (source schema drift?)');
  // Deterministic order: tier, then name (codepoint).
  entries.sort((a, b) => a[3] - b[3] || cmp(a[2], b[2]));
  console.log(`  water-bodies: ${entries.length}`);
  return { entries };
}

/** Simplify a TopoJSON Buffer (keep-shapes; quantization is the size lever). */
async function simplify(topoBuf, retainPct, quantization) {
  const out = await mapshaper.applyCommands(
    `-i in.json -simplify ${retainPct}% keep-shapes -o quantization=${quantization} format=topojson out.json`,
    { 'in.json': topoBuf }
  );
  return JSON.parse(Buffer.from(out['out.json']).toString('utf8'));
}

/** TopoJSON arc-index -> ones'-complement real index (negative = reversed arc). */
const arcRealIdx = (v) => (v < 0 ? ~v : v);

/** Absolute (quantized-integer) start/end nodes of an arc reference, accounting
 *  for reversal. Arcs are delta-encoded; equality of these nodes is exact, so
 *  rings can be stitched by node matching. */
function arcEndpoints(arcs, v) {
  const rev = v < 0;
  const arc = arcs[rev ? ~v : v];
  let x = 0,
    y = 0,
    first = null,
    last = null;
  for (const d of arc) {
    x += d[0];
    y += d[1];
    if (first === null) first = [x, y];
    last = [x, y];
  }
  return rev ? { start: last, end: first } : { start: first, end: last };
}
const sameNode = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Dissolve two single-ring polygons that share exactly one boundary arc into one
 *  ring: drop the shared arc (present in both with opposite orientation) and
 *  re-stitch the survivors into a single closed ring by node matching. Returns the
 *  merged ring (array of arc indices) or null if the inputs don't fit that shape
 *  (caller falls back to dropping the child — no crash, worst case the old hole). */
function dissolveSharedArcRing(arcs, ringA, ringB) {
  let shared = null;
  for (const a of ringA)
    for (const b of ringB)
      if (arcRealIdx(a) === arcRealIdx(b) && a < 0 !== b < 0) shared = arcRealIdx(a);
  if (shared == null) return null;
  const pool = [...ringA, ...ringB].filter((v) => arcRealIdx(v) !== shared);
  if (!pool.length) return null;
  const ring = [pool.shift()];
  const startNode = arcEndpoints(arcs, ring[0]).start;
  let endNode = arcEndpoints(arcs, ring[0]).end;
  while (pool.length) {
    const i = pool.findIndex((v) => sameNode(arcEndpoints(arcs, v).start, endNode));
    if (i < 0) return null; // dangling — can't form a single ring
    const next = pool.splice(i, 1)[0];
    ring.push(next);
    endNode = arcEndpoints(arcs, next).end;
  }
  return sameNode(endNode, startNode) ? ring : null;
}

/** Fold disputed-territory child polygons (Somaliland, N. Cyprus) into their
 *  sovereign parent so the parent fills solid instead of leaving an orphaned-
 *  boundary hole. Mutates the geometry list in place. Each child must share a
 *  single arc with a single-ring parent; otherwise it's left for the rekey loop
 *  to drop (the prior behaviour). Returns the set of merged child names. */
function mergeDisputedTerritories(topo, obj) {
  const arcs = topo.arcs;
  const byName = new Map(obj.geometries.map((g) => [g.properties?.name, g]));
  const merged = new Set();
  for (const [childName, parentName] of Object.entries(MERGE_INTO_PARENT)) {
    const child = byName.get(childName);
    const parent = byName.get(parentName);
    // Tier may omit either; only Polygon↔Polygon single-ring merges are handled.
    if (
      !child ||
      !parent ||
      child.type !== 'Polygon' ||
      parent.type !== 'Polygon' ||
      parent.arcs.length !== 1 ||
      child.arcs.length !== 1
    )
      continue;
    const ring = dissolveSharedArcRing(arcs, parent.arcs[0], child.arcs[0]);
    if (!ring) continue;
    parent.arcs = [ring];
    merged.add(childName);
    child.__drop = true;
  }
  obj.geometries = obj.geometries.filter((g) => !g.__drop);
  return merged;
}

/** Re-key world geometries by ISO 3166-1 alpha-2 (fail-loud, R1/R4/R8/R15). */
function rekeyWorld(topo) {
  const objName = topo.objects.countries ? 'countries' : Object.keys(topo.objects)[0];
  const obj = topo.objects[objName];
  if (!obj) throw new Error('world: no geometry object');
  // Fold Somaliland/N. Cyprus into Somalia/Cyprus before keying — afterwards no
  // unmapped child remains (any that failed to merge falls through to the drop).
  const merged = [...mergeDisputedTerritories(topo, obj)];
  const dropped = [];
  for (const g of obj.geometries) {
    if (g.id != null && typeof g.id !== 'string') {
      throw new Error(`world: non-string id ${JSON.stringify(g.id)} (leading-zero risk)`);
    }
    const name = g.properties?.name;
    let iso = g.id != null ? ISO_NUMERIC_TO_ALPHA2[g.id] : undefined;
    if (!iso) iso = NAME_TO_ISO2_FALLBACK[name];
    if (!iso) {
      // Outright-drop names, plus any merge child that couldn't be merged in this
      // tier (no parent / unexpected shape) — drop rather than crash the build.
      if (DROP_NAMES.has(name) || name in MERGE_INTO_PARENT) {
        dropped.push(name);
        g.__drop = true;
        continue;
      }
      throw new Error(`world: unmapped feature id=${g.id} name=${JSON.stringify(name)}`);
    }
    g.id = iso;
  }
  obj.geometries = obj.geometries.filter((g) => !g.__drop);
  // keep only the named object; drop 'land'/etc (R1)
  topo.objects = { countries: obj };
  return { topo, dropped, merged, keys: obj.geometries.map((g) => g.id) };
}

/** Re-key US states by ISO 3166-2 US-XX (fail-loud, R7). */
function rekeyUS(topo) {
  const objName = topo.objects.states ? 'states' : Object.keys(topo.objects)[0];
  const obj = topo.objects[objName];
  if (!obj) throw new Error('us: no geometry object');
  for (const g of obj.geometries) {
    if (g.id != null && typeof g.id !== 'string') {
      throw new Error(`us: non-string id ${JSON.stringify(g.id)}`);
    }
    const usps = FIPS_TO_ISO2[g.id];
    if (!usps) throw new Error(`us: unmapped FIPS id=${g.id} name=${JSON.stringify(g.properties?.name)}`);
    g.id = `US-${usps}`;
  }
  topo.objects = { states: obj };
  const keys = new Set(obj.geometries.map((g) => g.id));
  // assert all 50 states + DC are present by code (not just a count, F10)
  const missing = STATE_DC_CODES.filter((k) => !keys.has(k));
  if (missing.length) throw new Error(`us: missing states/DC: ${missing.join(', ')}`);
  return { topo, keys: [...keys] };
}

// =============================================================================
// Gazetteer (cities5000)
// =============================================================================

function buildGazetteer(tsv) {
  // Pass 1: collect kept city records. Pass 2: sort DETERMINISTICALLY (so array
  // indices don't depend on un-pinnable GeoNames TSV row order — F2), then assign
  // indices and build byName. alt is a small curated abbreviation map resolved
  // against the built cities (F5 — no noisy col-4 transliteration mining).
  const recs = [];
  let droppedRows = 0,
    minDate = '9999-99-99',
    maxDate = '0000-00-00';
  const capitalsHit = new Set();

  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length !== 19) {
      droppedRows++;
      continue;
    }
    const name = c[1];
    const lat = Number(c[4]);
    const lon = Number(c[5]);
    const cc = c[8]; // ISO alpha-2 country
    const admin1 = c[10];
    const pop = Number(c[14]);
    const modDate = c[18];
    // strict guard (R15/Decision 15)
    if (
      !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      !Number.isInteger(pop) || pop < 0 || !cc
    ) {
      droppedRows++;
      continue;
    }
    const sub = cc === 'US' && admin1 ? `US-${admin1}` : undefined;
    const foldedName = fold(name);
    const isCapital = sub && CAPITAL_KEYS.has(`${foldedName}|${sub}`);
    if (isCapital) capitalsHit.add(sub);

    // inclusion: world majors OR (US >= US floor) OR a US state capital
    const include =
      pop >= WORLD_POP_FLOOR || (cc === 'US' && pop >= US_POP_FLOOR) || isCapital;
    if (!include) continue;

    if (modDate && modDate < minDate) minDate = modDate;
    if (modDate && modDate > maxDate) maxDate = modDate;
    recs.push({ lat: round(lat), lon: round(lon), cc, pop, name, sub, foldedName });
  }

  // Deterministic order, independent of source row order: name, country, sub,
  // pop desc, lon, lat (total order — no ties).
  recs.sort(
    (a, b) =>
      cmp(a.foldedName, b.foldedName) ||
      cmp(a.cc, b.cc) ||
      cmp(a.sub || '', b.sub || '') ||
      b.pop - a.pop ||
      a.lon - b.lon ||
      a.lat - b.lat
  );

  const cities = [];
  const byName = {};
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const tuple = [r.lat, r.lon, r.cc, r.pop, r.name];
    if (r.sub) tuple.push(r.sub);
    cities.push(tuple);
    (byName[r.foldedName] ||= []).push(i);
  }

  // Curated aliases → most-populous matching city index (F5). Skip any that
  // don't resolve (warn) or that collide with a real city name (byName wins).
  const alt = {};
  const missingAliases = [];
  for (const [alias, m] of Object.entries(CURATED_ALIASES)) {
    if (byName[alias]) continue; // a real city already owns this key
    const want = fold(m.name);
    let best = -1;
    for (let i = 0; i < cities.length; i++) {
      const t = cities[i];
      if (fold(t[4]) !== want) continue;
      if (m.sub ? t[5] !== m.sub : t[2] !== m.iso) continue;
      if (best < 0 || t[3] > cities[best][3]) best = i;
    }
    if (best >= 0) alt[alias] = best;
    else missingAliases.push(alias);
  }

  return {
    gaz: { cities, byName, alt },
    stats: {
      kept: cities.length, droppedRows, minDate, maxDate,
      capitalsHit: [...capitalsHit].sort(), aliases: Object.keys(alt).length,
      missingAliases,
    },
  };
}

// =============================================================================
// Airports (OurAirports, IATA-coded) — emitted as a SEPARATE airports.json
// =============================================================================

// Pinned, OFFLINE source: a committed lean slice of OurAirports' airports.csv
// (rows with scheduled_service=yes + a 3-letter iata_code; only the columns we
// use). ADR-4: a frozen/hashed snapshot, not a live rebuild — OurAirports is
// community-edited with no release tags, so a live fetch could silently drift a
// coord or drop a hub. Regenerating the snapshot is a deliberate, reviewed bump.
const AIRPORT_SNAPSHOT = resolve(ROOT, 'scripts/airports-snapshot.csv');
// Airport coords are rounded to 2 decimals (~1km) — sub-pixel at world/regional
// map scale (a 10km airport↔city offset is already invisible), and the size lever
// that keeps airports.json under its ceiling. Distinct from the gazetteer's 3.
const AIRPORT_COORD_PRECISION = 2;
const roundAirport = (n) => Number(n.toFixed(AIRPORT_COORD_PRECISION));
// Geo-weighted tier (§Technical Decisions): US gets all scheduled commercial
// (large + medium — captures John Wayne SNA etc.); the rest of the world gets
// large hubs only. Higher rank wins a duplicate-IATA conflict.
const AIRPORT_TYPE_RANK = { large_airport: 2, medium_airport: 1 };
// Schema-drift guard: a snapshot prune/column-shift that empties the set must
// hard-fail, not silently ship a near-empty airports.json.
const MIN_AIRPORTS = 800;

/** Minimal RFC-4180-ish CSV row parser (quoted fields may embed commas/quotes).
 *  Sufficient for the OurAirports snapshot; no embedded newlines in fields. */
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

/** Build the airports layer from the committed OurAirports snapshot. Reads
 *  `gaz.byName` ONLY to compute the city↔IATA collision report (ADR-2: city
 *  wins, airport is the lowest tier); NEVER mutates the gazetteer. Emits a
 *  separate `airports.json` = `{ airports, airportIata }` with its own gz ceiling.
 *
 *  Tuple `[lat, lon, iso_country, 0, name]`: pop is always 0 (OurAirports has no
 *  enplanement column — verified), name is the full airport name (completion
 *  display only — airports resolve by IATA code, never by name). */
function buildAirports(gaz) {
  console.log('• airports (OurAirports snapshot, IATA-coded)');
  const text = readFileSync(AIRPORT_SNAPSHOT, 'utf8');
  sourceHashes['file:scripts/airports-snapshot.csv'] = {
    sha256: createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
    bytes: Buffer.byteLength(text, 'utf8'),
  };
  const lines = text.split('\n').filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  // Dedup by folded IATA code (OurAirports has duplicate/retired rows): keep the
  // higher-`type` row, tie-break by lower IATA string for determinism.
  const byCode = new Map();
  let blankOrBadIata = 0;
  let dups = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const iata = c[col.iata_code];
    const sched = c[col.scheduled_service];
    const type = c[col.type];
    const iso = c[col.iso_country];
    const name = c[col.name];
    const lat = Number(c[col.latitude_deg]);
    const lon = Number(c[col.longitude_deg]);
    if (sched !== 'yes') continue;
    if (!iata || !/^[A-Za-z]{3}$/.test(iata)) {
      blankOrBadIata++;
      continue;
    }
    const include =
      iso === 'US'
        ? type === 'large_airport' || type === 'medium_airport'
        : type === 'large_airport';
    if (!include) continue;
    if (
      !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      !iso
    )
      continue;
    const key = fold(iata);
    const rec = { iata, type, name, lat, lon, iso };
    const ex = byCode.get(key);
    if (ex) {
      dups++;
      const better =
        AIRPORT_TYPE_RANK[type] > AIRPORT_TYPE_RANK[ex.type] ||
        (AIRPORT_TYPE_RANK[type] === AIRPORT_TYPE_RANK[ex.type] &&
          iata < ex.iata);
      if (better) byCode.set(key, rec);
      console.warn(
        `  ⚠ duplicate IATA ${iata.toUpperCase()}: kept ${(better ? rec : ex).name}`
      );
    } else byCode.set(key, rec);
  }
  // Total order by folded code → deterministic array indices.
  const recs = [...byCode.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([, r]) => r);
  if (recs.length < MIN_AIRPORTS) {
    throw new Error(
      `airports near-empty: kept ${recs.length} < ${MIN_AIRPORTS} (snapshot drift?)`
    );
  }
  const airports = recs.map((r) => [
    roundAirport(r.lat),
    roundAirport(r.lon),
    r.iso,
    0,
    r.name,
  ]);
  const airportIata = {};
  recs.forEach((r, i) => {
    airportIata[fold(r.iata)] = i;
  });
  // Collision report (ADR-2 / AC4): folded IATA codes that ALSO name a gazetteer
  // city via `byName`. The committed airport-collisions.json turns "city wins"
  // from an assumption into a guarded invariant. (alt-alias overlaps are NOT
  // tracked — the precedence rule is defined on byName; a known limit.)
  const collisions = Object.keys(airportIata)
    .filter((k) => gaz.byName[k])
    .sort(cmp);
  return {
    airports: { airports, airportIata },
    collisions,
    stats: { count: recs.length, dups, blankOrBadIata },
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const provenance = { generatedBy: 'scripts/build-map-data.mjs', sources: {}, assets: {} };

  console.log('• world boundaries (coarse=110m, detail=50m)');
  const coarseBuf = Buffer.from(
    JSON.stringify(await fetchValidated(SOURCES.worldCoarse.url, 'topojson'))
  );
  const detailBuf = Buffer.from(
    JSON.stringify(await fetchValidated(SOURCES.worldDetail.url, 'topojson'))
  );
  provenance.sources.worldCoarse = { ...SOURCES.worldCoarse };
  provenance.sources.worldDetail = { ...SOURCES.worldDetail };

  // Two sources → different feature counts by design (110m≈177, 50m≈241); each
  // tier re-keyed independently (fail-loud). No cross-tier key-set equality.
  const coarse = rekeyWorld(await simplify(coarseBuf, WORLD_COARSE_RETAIN, QUANT_COARSE));
  const detail = rekeyWorld(await simplify(detailBuf, WORLD_DETAIL_RETAIN, QUANT_DETAIL));
  // Detail is the superset; assert coarse keys ⊆ detail keys (sanity).
  const dk = new Set(detail.keys);
  const orphan = coarse.keys.filter((k) => !dk.has(k));
  if (orphan.length) throw new Error(`coarse has keys absent from detail: ${orphan.join(', ')}`);
  console.log(`  coarse ${coarse.keys.length} / detail ${detail.keys.length} countries ` +
    `(merged into parent: ${detail.merged.join(', ') || 'none'}; ` +
    `dropped no-ISO: ${detail.dropped.join(', ') || 'none'})`);

  console.log('• US states');
  const usBuf = Buffer.from(
    JSON.stringify(await fetchValidated(SOURCES.usAtlas.url, 'topojson'))
  );
  provenance.sources.usAtlas = { ...SOURCES.usAtlas };
  const us = rekeyUS(await simplify(usBuf, US_RETAIN, QUANT_US));
  console.log(`  states+DC+territories: ${us.keys.length}`);

  const lakes = await buildLakes(SOURCES.lakes.url);
  provenance.sources.lakes = { ...SOURCES.lakes };

  const rivers = await buildRivers(SOURCES.rivers.url);
  provenance.sources.rivers = { ...SOURCES.rivers };

  const naLand = await buildNaLand(SOURCES.naLand.url);
  provenance.sources.naLand = { ...SOURCES.naLand };

  const naLakes = await buildNaLakes(SOURCES.naLakes.url);
  provenance.sources.naLakes = { ...SOURCES.naLakes };

  const mountainRanges = await buildMountainRanges(SOURCES.mountainRanges.url);
  provenance.sources.mountainRanges = { ...SOURCES.mountainRanges };

  const waterBodies = await buildWaterBodies(
    SOURCES.marineCoarse.url,
    SOURCES.marineDetail.url
  );
  provenance.sources.marineCoarse = { ...SOURCES.marineCoarse };
  provenance.sources.marineDetail = { ...SOURCES.marineDetail };

  console.log('• gazetteer (cities5000)');
  const citiesZip = await fetchValidated(SOURCES.geonames.citiesUrl, 'zip');
  const tsv = unzipEntry(citiesZip, 'cities5000.txt');
  const { gaz, stats } = buildGazetteer(tsv);
  // schema-drift guard: a near-empty gazetteer (e.g. column count changed →
  // every row dropped) must hard-fail, not silently ship (F8).
  if (stats.kept < MIN_KEPT_CITIES) {
    throw new Error(`gazetteer near-empty: kept ${stats.kept} < ${MIN_KEPT_CITIES} (source schema drift?)`);
  }
  provenance.sources.geonames = {
    citiesUrl: SOURCES.geonames.citiesUrl,
    license: SOURCES.geonames.license,
    modificationDateRange: `${stats.minDate}..${stats.maxDate} (filtered subset)`,
  };
  console.log(
    `  kept ${stats.kept} cities (dropped ${stats.droppedRows} bad rows); ` +
      `capitals matched: ${stats.capitalsHit.length}/50; aliases: ${stats.aliases}`
  );
  const missingCaps = Object.keys(US_CAPITALS)
    .map((s) => `US-${s}`)
    .filter((k) => !stats.capitalsHit.includes(k));
  if (missingCaps.length) console.warn(`  ⚠ capitals not matched: ${missingCaps.join(', ')}`);
  if (stats.missingAliases.length) console.warn(`  ⚠ aliases not resolved: ${stats.missingAliases.join(', ')}`);

  // Airports — reads gaz.byName for the collision report only; never mutates it.
  const airportsBuilt = buildAirports(gaz);
  console.log(
    `  kept ${airportsBuilt.stats.count} airports ` +
      `(dropped ${airportsBuilt.stats.blankOrBadIata} blank/bad IATA, ` +
      `${airportsBuilt.stats.dups} dup-code conflicts); ` +
      `city collisions: ${airportsBuilt.collisions.join(', ') || 'none'}`
  );
  provenance.sources.ourairports = {
    snapshot: 'scripts/airports-snapshot.csv',
    source: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
    license: 'Public Domain — https://ourairports.com/data/',
    note: 'Lean committed slice (scheduled_service=yes + 3-letter iata_code). Regenerate is a deliberate, reviewed bump (ADR-4).',
  };

  // region-names.json — completion-only asset: country + US-state display names
  // (the renderer derives names from the topology; this feeds the editor's
  // region autocomplete). Deterministic order: layer, then name (codepoint).
  const geomsOf = (topo) => topo.objects[Object.keys(topo.objects)[0]].geometries;
  const regionNames = {
    regions: [
      ...geomsOf(coarse.topo).map((g) => ({
        name: g.properties.name,
        iso: g.id,
        layer: 'country',
      })),
      ...geomsOf(us.topo).map((g) => ({
        name: g.properties.name,
        iso: g.id,
        layer: 'us-state',
      })),
    ].sort((a, b) => cmp(a.layer, b.layer) || cmp(a.name, b.name)),
  };

  // --- emit + size-gate (R5 dist handled by tsup; here we write src/map/data) -
  const emitted = {
    'world-coarse.json': coarse.topo,
    'world-detail.json': detail.topo,
    'us-states.json': us.topo,
    'lakes.json': lakes,
    'rivers.json': rivers,
    'na-land.json': naLand,
    'na-lakes.json': naLakes,
    'mountain-ranges.json': mountainRanges,
    'water-bodies.json': waterBodies,
    'gazetteer.json': gaz,
    'region-names.json': regionNames,
    'airports.json': airportsBuilt.airports,
  };
  console.log('• emit + size-gate');
  for (const [name, obj] of Object.entries(emitted)) {
    const buf = writeJson(name, obj);
    const gz = gzipSync(buf).length;
    const ceil = GZ_CEILINGS[name];
    const flag = gz > ceil ? '  ✗ OVER' : '  ok';
    console.log(`  ${name}: ${(buf.length / 1024).toFixed(1)}KB raw / ${(gz / 1024).toFixed(1)}KB gz (ceil ${(ceil / 1024).toFixed(0)}KB)${flag}`);
    provenance.assets[name] = {
      sha256: createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      gzBytes: gz,
    };
    if (gz > ceil) {
      throw new Error(`${name} ${gz}B gz exceeds ceiling ${ceil}B — raise a pop floor or simplify more`);
    }
  }
  provenance.counts = {
    countries: coarse.keys.length,
    usStates: us.keys.length,
    mountainRanges: mountainRanges.objects.ranges.geometries.length,
    waterBodies: waterBodies.entries.length,
    gazetteerCities: stats.kept,
    gazetteerAliases: Object.keys(gaz.alt).length,
    airports: airportsBuilt.stats.count,
    airportCollisions: airportsBuilt.collisions.length,
  };
  // mapshaper version (determinism hinges on it) + raw source-byte hashes so a
  // future regen diff can pin upstream drift vs a real regression (F14).
  provenance.tooling = { mapshaper: require('mapshaper/package.json').version };
  provenance.sourceHashes = sourceHashes;

  // Committed collision fixture (AC4): the build's authoritative enumeration of
  // folded IATA codes shadowed by a gazetteer city. The map-data test asserts the
  // emitted set equals this file, so "city wins" stays a verified invariant.
  writeJson('airport-collisions.json', { collisions: airportsBuilt.collisions });

  writeJson('PROVENANCE.json', provenance);
  writeReadme();
  console.log('✓ done. Outputs in src/map/data/. Commit them.');
}

function writeReadme() {
  const p = resolve(OUT, 'README.md');
  const text = `# map chart-type data assets

Generated by \`scripts/build-map-data.mjs\` (run \`pnpm build:map-data\`). These
committed JSON files are the runtime artifacts for the \`map\` chart type. Do not
hand-edit — regenerate from source.

## Files
- \`world-coarse.json\` / \`world-detail.json\` — world country boundaries (TopoJSON),
  keyed by ISO 3166-1 alpha-2. Coarse = world-scale; detail = regional/zoom.
- \`us-states.json\` — US states + DC + territories (TopoJSON), keyed by ISO 3166-2.
- \`lakes.json\` — major lakes (Natural Earth 110m, TopoJSON), drawn as water over land.
- \`rivers.json\` — major river centerlines (Natural Earth 110m, TopoJSON), drawn as thin water lines.
- \`na-land.json\` — NA-clipped 10m country land (TopoJSON, ISO-keyed): crisp neighbour context under the albers-usa US view.
- \`na-lakes.json\` — NA-clipped 10m major lakes (TopoJSON): the lakes counterpart to \`na-land.json\` for the US view.
- \`mountain-ranges.json\` — notable mountain ranges (Natural Earth 50m geography regions, FEATURECLA "Range/mtn", TopoJSON), drawn as a subtle gradient relief cue when the \`relief\` directive is on. Optional; single tier (no elevation).
- \`water-bodies.json\` — water-body orientation labels (\`{ entries: [lat, lon, name, tier, kind] }\`) from Natural Earth 110m+50m geography marine polys (oceans/seas/gulfs/bays/straits/channels/sounds; rivers + reefs excluded). Anchors are mapshaper inner points; \`tier\` is the NE scalerank. Drawn only when the \`context-labels\` directive is on. Optional.
- \`gazetteer.json\` — \`{ cities, byName, alt }\` city index (see \`types.ts\`).
  \`byName\`/\`alt\` reference \`cities\` by array index (normalized).
- \`airports.json\` — \`{ airports, airportIata }\` IATA-coded airport index (see \`types.ts\`).
  Built OFFLINE from the committed \`scripts/airports-snapshot.csv\` (OurAirports, public domain).
  \`airports\` reuses the gazetteer tuple (\`pop\` always 0; name = full airport name, completion-only);
  \`airportIata\` maps a folded 3-letter IATA code → index. Resolves \`poi JFK\` / \`route JFK -> LAX\`.
- \`airport-collisions.json\` — \`{ collisions }\`: folded IATA codes shadowed by a gazetteer
  city (city wins, ADR-2). The data test asserts the build's set equals this committed fixture.
- \`PROVENANCE.json\` — source versions + per-asset sha256/sizes + GeoNames date range.
- \`types.ts\` — the typed data contract consumed by the parser/resolver/renderer.

## Sources & attribution
- **Country boundaries:** Natural Earth via \`world-atlas@2.0.2\` (public domain).
- **US states:** US Census via \`us-atlas@3.0.1\` (public domain).
- **Mountain ranges:** Natural Earth 50m \`geography_regions_polys\` via \`nvkelso/natural-earth-vector\` (public domain).
- **Water bodies:** Natural Earth 110m+50m \`geography_marine_polys\` via \`nvkelso/natural-earth-vector\` (public domain). One editorial override applied (\`Gulf of Mexico\` → \`Gulf of America\`).
- **Cities:** Data © **GeoNames**, licensed under **CC BY 4.0**
  (https://creativecommons.org/licenses/by/4.0/) — https://www.geonames.org/.

## Determinism & GeoNames drift
Geometry assets are byte-reproducible from the pinned atlas versions (same machine
+ \`mapshaper@0.7.22\`). The GeoNames dump is **rebuilt daily and has no pinnable
snapshot**, so the committed \`gazetteer.json\` is the source of truth; a regenerate
may pick up upstream city changes. \`PROVENANCE.json\` is the audit trail. The
modification-date range it reports is over the *filtered* (kept) city subset.

## Regenerate
\`\`\`
pnpm build:map-data
\`\`\`
`;
  writeFileSync(p, text, 'utf8');
}

// Pure helpers are exported for unit testing (F1). Only run the build (which
// fetches the network) when invoked directly, not when imported by a test.
export {
  fold,
  cmp,
  sortKeys,
  round,
  rekeyWorld,
  dissolveSharedArcRing,
  rekeyUS,
  buildGazetteer,
  buildAirports,
  parseCsvLine,
  roundAirport,
  buildMountainRanges,
  buildWaterBodies,
  normalizeWaterName,
  writeJson,
  GZ_CEILINGS,
  ISO_NUMERIC_TO_ALPHA2,
  FIPS_TO_ISO2,
  CURATED_ALIASES,
};

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error('build-map-data FAILED:', e.message);
    process.exit(1);
  });
}
