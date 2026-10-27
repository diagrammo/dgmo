// Stress corpus RENDER stage (#1417) — not part of `pnpm test`.
// Run: STRESS_OUT=<dir> pnpm stress:render
//
// Renders every fixture under stress/ exactly as the CLI would (nord/light,
// the gallery's pinned instant, Inter plus system fallback in resvg), writes
// <out>/<type>--<file>.svg and .png, and <out>/report.json:
//   [{ id, chartType, dimension, intent, known, errors, findings, png }]
// The PNGs are what the vision pass looks at and what the contact sheet shows,
// so a reviewer and the agent judge the same pixels. STRESS_FILTER=<a>,<b>
// limits the run to ids containing any of the substrings (a rota turn renders
// only what it added or re-checks).
import { test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { loadCorpus, renderFixture } from './stress/corpus';
import { requireStressFonts } from './stress/fonts';

const ROOT = resolve(__dirname, '..');

/** PNG zoom. 1.5 keeps 10px text legible on the sheet without doubling its weight in git. */
const ZOOM = 1.5;

test('render the stress corpus', async () => {
  const fontFiles = requireStressFonts(join(ROOT, 'fonts'));
  const out = process.env.STRESS_OUT;
  if (!out) throw new Error('STRESS_OUT=<dir> is required');
  mkdirSync(out, { recursive: true });
  const filters = (process.env.STRESS_FILTER ?? '').split(',').filter(Boolean);
  const report = [];
  for (const fixture of loadCorpus()) {
    if (filters.length && !filters.some((f) => fixture.id.includes(f)))
      continue;
    const r = await renderFixture(fixture);
    const base = fixture.id.replace(/\.dgmo$/, '').replace('/', '--');
    let png: string | null = null;
    if (r.svg) {
      writeFileSync(join(out, `${base}.svg`), r.svg);
      const bg = /background:\s*([^;"]+)/.exec(r.svg)?.[1];
      const resvg = new Resvg(r.svg, {
        fitTo: { mode: 'zoom', value: ZOOM },
        ...(bg ? { background: bg } : {}),
        // System fonts on, always — see dgmo CLAUDE.md → Rendering constraints.
        font: {
          loadSystemFonts: true,
          fontFiles,
          defaultFontFamily: 'Inter',
          sansSerifFamily: 'Inter',
        },
      });
      png = `${base}.png`;
      writeFileSync(join(out, png), resvg.render().asPng());
    }
    report.push({
      id: fixture.id,
      chartType: fixture.chartType,
      dimension: fixture.dimension,
      intent: fixture.intent,
      known: fixture.known,
      errors: r.errors,
      findings: r.findings,
      png,
    });
  }
  writeFileSync(
    join(out, 'report.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
});
