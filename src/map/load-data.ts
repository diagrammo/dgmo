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
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { MapData } from './resolved-types';
import type { BoundaryTopology, Gazetteer } from './data/types';

const FILES = {
  worldCoarse: 'world-coarse.json',
  worldDetail: 'world-detail.json',
  usStates: 'us-states.json',
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

async function readJson<T>(dir: string, name: string): Promise<T> {
  return JSON.parse(await readFile(resolve(dir, name), 'utf8')) as T;
}

async function firstExistingDir(baseDir: string): Promise<string> {
  for (const rel of CANDIDATE_DIRS) {
    const dir = resolve(baseDir, rel);
    try {
      await readFile(resolve(dir, FILES.gazetteer), 'utf8');
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

/** Load + memoize the four map assets (Node). Throws if none of the candidate
 *  locations contain them. */
export function loadMapData(): Promise<MapData> {
  cache ??= (async (): Promise<MapData> => {
    const baseDir = dirname(fileURLToPath(import.meta.url));
    const dir = await firstExistingDir(baseDir);
    const [worldCoarse, worldDetail, usStates, gazetteer] = await Promise.all([
      readJson<BoundaryTopology>(dir, FILES.worldCoarse),
      readJson<BoundaryTopology>(dir, FILES.worldDetail),
      readJson<BoundaryTopology>(dir, FILES.usStates),
      readJson<Gazetteer>(dir, FILES.gazetteer),
    ]);
    return { worldCoarse, worldDetail, usStates, gazetteer };
  })();
  return cache;
}
