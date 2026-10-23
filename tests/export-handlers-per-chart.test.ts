// export-handlers-per-chart.test.ts — #1362 (every chart's export handler sat
// in d3.ts, so a chart change touched that shared file as well as its folder).
//
// Pins the layout the fix made: each handler in DIAGRAM_EXPORT_HANDLERS is
// exported by a `src/<chart>/export.ts`, d3.ts defines none of its own, and a
// handler can be called alone — which no test could do while they were
// private to d3.ts.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DIAGRAM_EXPORT_HANDLERS, renderForExport } from '../src/d3';
import { exportPyramid } from '../src/pyramid/export';
import { EXPORT_HEIGHT, EXPORT_WIDTH } from '../src/utils/d3-helpers';

// `__dirname`, not `import.meta.url`: jsdom makes the latter an http:// URL.
const SRC = join(__dirname, '../src');

async function handlersByFolder(): Promise<Map<unknown, string>> {
  const owners = new Map<unknown, string>();
  for (const dir of readdirSync(SRC)) {
    const file = join(SRC, dir, 'export.ts');
    if (!existsSync(file)) continue;
    const mod = (await import(`../src/${dir}/export.ts`)) as Record<
      string,
      unknown
    >;
    for (const value of Object.values(mod)) {
      if (typeof value === 'function') owners.set(value, dir);
    }
  }
  return owners;
}

describe('export handlers live beside their charts (#1362)', () => {
  it('every dispatched handler is exported by a src/<chart>/export.ts', async () => {
    const owners = await handlersByFolder();
    const homeless = Object.entries(DIAGRAM_EXPORT_HANDLERS)
      .filter(([, fn]) => !owners.has(fn))
      .map(([id]) => id);
    expect(homeless).toEqual([]);
  });

  it('d3.ts defines no export handler of its own', () => {
    const d3 = readFileSync(join(SRC, 'd3.ts'), 'utf8');
    expect(d3.match(/^(?:export )?async function export\w+/gm) ?? []).toEqual(
      []
    );
  });

  it('a handler renders when called alone', async () => {
    const content = readFileSync(
      join(__dirname, 'fixtures/conformance/pyramid.dgmo'),
      'utf8'
    );
    const svg = await exportPyramid({
      content,
      theme: 'light',
      palette: undefined,
      viewState: undefined,
      options: undefined,
      exportMode: false,
      isDark: false,
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      requestedWidth: undefined,
      requestedHeight: undefined,
    });
    expect(svg).toContain('<svg');
    expect(svg.length).toBeGreaterThan(0);
    // The same chart through the public entry still draws.
    expect(await renderForExport(content, 'light')).toContain('<svg');
  });
});
