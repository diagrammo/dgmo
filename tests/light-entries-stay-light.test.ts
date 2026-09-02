// The "light" subpaths must stay light — measured over the SOURCE graph.
//
// 🔴 What this catches is invisible in review. `@diagrammo/dgmo/chart-meta`
// advertises 2.7 KB and cost 1.1 MB, because `parseDgmoChartType` sat in
// `dgmo-router.ts` — a module that also builds `chartTypeParsers` by mapping
// CHART_TYPE_REGISTRY at top level, i.e. a live reference to all 51 parsers.
// Importing ANY symbol from that module pulled every one of them. Nothing in
// the diff said so; the entry's own header promised the opposite (#638).
//
// So the ceilings below are on the number of source modules each light entry
// can reach through STATIC imports. A module count is scale-free, so this is
// safe where a wall-clock assertion would not be, and it is the same shape as
// diagrammo-app's launch-payload ceiling (#632).
//
// When one fails: do not raise it to make the suite green. Find the import
// that reaches a module holding a registry, a parser table or a renderer, and
// move the symbol you want into a file that does not.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Static `import ... from '...'` only — `import type` and `import()` excluded. */
function staticImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(
    /^(?:import|export)\s+(?!type\s)(?:[\s\S]*?)\s*from\s*'([^']+)'/gm
  )) {
    out.push(m[1]!);
  }
  for (const m of src.matchAll(/^import\s*'([^']+)'/gm)) out.push(m[1]!);
  return out;
}

function closureOf(entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const spec of staticImports(file)) {
      const r = resolveImport(file, spec);
      if (r && !seen.has(r)) {
        seen.add(r);
        queue.push(r);
      }
    }
  }
  return seen;
}

// Ceilings set from measurement on 2026-09-02, above today and far below the
// ~250 modules the full parse/render graph reaches.
// For scale: `advanced.ts` reaches 292 source modules and `index.ts` 173, so a
// light entry crossing into the high tens has stopped being one. Headroom is
// deliberately less than one parser family costs (~10-20 modules).
const LIGHT_ENTRIES: [entry: string, modules: number, measured: number][] = [
  ['chart-meta.ts', 78, 66],
  ['completion-registry.ts', 20, 14],
  ['cloud-reference.ts', 4, 1],
  ['live-link/resolve.ts', 6, 2],
];

describe('light subpath entries', () => {
  for (const [entry, ceiling, measured] of LIGHT_ENTRIES) {
    it(`${entry} reaches at most ${ceiling} source modules (was ${measured})`, () => {
      const reached = closureOf(join(SRC, entry));
      expect(reached.size).toBeLessThanOrEqual(ceiling);
    });
  }

  it('chart-meta does not reach the parser table', () => {
    // The specific edge that cost 1.1 MB. `chart-type-registry` holds a live
    // `parse` reference per chart type; `dgmo-router` maps it at module scope.
    const reached = [...closureOf(join(SRC, 'chart-meta.ts'))].map((f) =>
      f.slice(SRC.length + 1)
    );
    expect(reached).not.toContain('chart-type-registry.ts');
    expect(reached).not.toContain('dgmo-router.ts');
  });
});
