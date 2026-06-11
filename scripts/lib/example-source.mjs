// ============================================================
// example-source.mjs — resolve a chart-type id to its authoritative curated
// example from dgmo-content/examples (ADR-7: the example FILE is the single
// source; the generator inlines it, never a hand-authored copy).
//
// The files live in subdirs (business/ data/ project/ software/) and are NOT
// 1:1 with ids: `daci`/`rasci` reuse `raci`; `bubble`/`timeline-grouped` are
// files but not ids. Resolve with a recursive glob + an explicit alias map.
//
// Runs in the workspace at generation/sync time (gen-ai-core.mjs), where
// ../../../dgmo-content is a sibling repo. The resolved text is baked into the
// generated surfaces, so dgmo-content need not be present at install time.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(here, '..', '..', '..', 'dgmo-content', 'examples');

// ids with no file of their own — reuse another id's example.
const ALIASES = { daci: 'raci', rasci: 'raci' };

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.dgmo')) out.push(p);
  }
  return out;
}

/** Map<basename-without-ext, absolute-path> across all example subdirs. */
export function loadExampleIndex() {
  const index = new Map();
  for (const p of walk(EXAMPLES_DIR)) {
    const base = p.slice(p.lastIndexOf('/') + 1, -'.dgmo'.length);
    index.set(base, p);
  }
  return index;
}

/**
 * Resolve a chart-type id to its example source text (trimmed), or null if no
 * file resolves (after aliasing).
 */
export function resolveExample(id, index = loadExampleIndex()) {
  const target = ALIASES[id] ?? id;
  const path = index.get(target);
  if (!path) return null;
  return readFileSync(path, 'utf8').trim();
}
