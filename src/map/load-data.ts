// Lazy loader for the map data assets (the one async seam — DI keeps resolveMap
// pure). Node/CLI implementation reads the committed JSON from disk.
//
// PATH RECONCILIATION (R4): the assets live at `src/map/data/*.json` (dev) and
// are copied to `dist/map-data/*.json` by the step-1 tsup `onSuccess` hook
// (built). This module resolves relative to `import.meta.url` and tries the
// known candidate dirs in order, so it works in BOTH contexts.
//
// BROWSER/WEB GAP (step-5 contract): this fs-based loader is Node-only. The web
// build must inject `MapData` (or supply a fetch/bundle loader) — `resolveMap`
// takes `MapData` by DI precisely so the browser path can differ. Do NOT assume
// a green Node smoke test proves the browser load.
//
// Node builtins (`fs/promises`, `url`, `path`) are imported LAZILY inside
// `loadMapData` — never at module top level — so this file can be pulled into a
// browser bundle (Obsidian's esbuild `platform: browser`, the app's Vite/Rollup
// web build) without the bundler trying to resolve `node:*`. Mirrors the
// `await import('jsdom')` seam in render.ts. The web build injects `MapData` via
// DI and never calls `loadMapData`, so the dynamic import only runs in Node.
import type { MapData } from './resolved-types';
import type { BoundaryTopology, Gazetteer } from './data/types';

type NodeBuiltins = {
  readFile: typeof import('node:fs/promises').readFile;
  fileURLToPath: typeof import('node:url').fileURLToPath;
  dirname: typeof import('node:path').dirname;
  resolve: typeof import('node:path').resolve;
};

async function loadNodeBuiltins(): Promise<NodeBuiltins> {
  const [{ readFile }, { fileURLToPath }, { dirname, resolve }] =
    await Promise.all([
      import('node:fs/promises'),
      import('node:url'),
      import('node:path'),
    ]);
  return { readFile, fileURLToPath, dirname, resolve };
}

const FILES = {
  worldCoarse: 'world-coarse.json',
  worldDetail: 'world-detail.json',
  usStates: 'us-states.json',
  lakes: 'lakes.json',
  rivers: 'rivers.json',
  naLand: 'na-land.json',
  naLakes: 'na-lakes.json',
  gazetteer: 'gazetteer.json',
} as const;

// Candidate dirs relative to this module, covering dev (src) + built (dist).
const CANDIDATE_DIRS = [
  './data',
  './map-data',
  '../map-data',
  '../src/map/data',
];

let cache: Promise<MapData> | undefined;

async function readJson<T>(
  nb: NodeBuiltins,
  dir: string,
  name: string
): Promise<T> {
  return JSON.parse(await nb.readFile(nb.resolve(dir, name), 'utf8')) as T;
}

async function firstExistingDir(
  nb: NodeBuiltins,
  baseDir: string
): Promise<string> {
  for (const rel of CANDIDATE_DIRS) {
    const dir = nb.resolve(baseDir, rel);
    try {
      await nb.readFile(nb.resolve(dir, FILES.gazetteer), 'utf8');
      return dir;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(
    `map data assets not found near ${baseDir} (looked in ${CANDIDATE_DIRS.join(', ')}). ` +
      `Run \`pnpm build:map-data\` and \`pnpm build\`.`
  );
}

function validate(data: MapData): MapData {
  const topoOk = (t: BoundaryTopology | undefined): boolean =>
    !!t && t.type === 'Topology' && !!t.objects;
  if (
    !topoOk(data.worldCoarse) ||
    !topoOk(data.worldDetail) ||
    !topoOk(data.usStates) ||
    !data.gazetteer ||
    !Array.isArray(data.gazetteer.cities) ||
    !data.gazetteer.byName
  ) {
    throw new Error('map data assets are malformed (failed shape validation)');
  }
  return data;
}

/** This module's directory, resolved for BOTH build formats: `import.meta.url`
 *  in ESM (dist/index.js, vitest/src) and `__dirname` in the CJS CLI bundle
 *  (dist/cli.cjs, where `import.meta.url` is `undefined` → `fileURLToPath`
 *  throws). The `typeof __dirname` guard is safe in ESM (evaluates to
 *  'undefined' without a ReferenceError). */
function moduleBaseDir(nb: NodeBuiltins): string {
  try {
    const url = import.meta.url;
    if (url) return nb.dirname(nb.fileURLToPath(url));
  } catch {
    /* CJS: import.meta unavailable — fall through */
  }
  if (typeof __dirname !== 'undefined') return __dirname;
  return process.cwd();
}

/** Load + memoize the four map assets (Node). Throws if none of the candidate
 *  locations contain them, or if a loaded asset fails shape validation. A
 *  rejected load is NOT cached (#7): the memo is cleared on failure so a later
 *  call can retry rather than inheriting a poisoned promise. */
export function loadMapData(): Promise<MapData> {
  cache ??= (async (): Promise<MapData> => {
    const nb = await loadNodeBuiltins();
    const dir = await firstExistingDir(nb, moduleBaseDir(nb));
    const [
      worldCoarse,
      worldDetail,
      usStates,
      lakes,
      rivers,
      naLand,
      naLakes,
      gazetteer,
    ] = await Promise.all([
      readJson<BoundaryTopology>(nb, dir, FILES.worldCoarse),
      readJson<BoundaryTopology>(nb, dir, FILES.worldDetail),
      readJson<BoundaryTopology>(nb, dir, FILES.usStates),
      // Lakes/rivers/NA assets are optional — older bundles may predate them.
      readJson<BoundaryTopology>(nb, dir, FILES.lakes).catch(() => undefined),
      readJson<BoundaryTopology>(nb, dir, FILES.rivers).catch(() => undefined),
      readJson<BoundaryTopology>(nb, dir, FILES.naLand).catch(() => undefined),
      readJson<BoundaryTopology>(nb, dir, FILES.naLakes).catch(() => undefined),
      readJson<Gazetteer>(nb, dir, FILES.gazetteer),
    ]);
    return validate({
      worldCoarse,
      worldDetail,
      usStates,
      gazetteer,
      ...(lakes && { lakes }),
      ...(rivers && { rivers }),
      ...(naLand && { naLand }),
      ...(naLakes && { naLakes }),
    });
  })().catch((e: unknown) => {
    cache = undefined; // don't poison future calls with a rejected promise
    throw e;
  });
  return cache;
}
