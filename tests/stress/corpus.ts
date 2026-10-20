// The stress corpus — loading, header parsing and rendering (#1417).
// Fixtures live in `stress/<chart-type>/<dimension>--<slug>.dgmo`; the README
// there is the contract for what a fixture's header carries.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { render } from '../../src/render';
import { loadMapData } from '../../src/map/load-data';
import { setPinnedNow } from '../../src/utils/now';
import { lintSvg, type LintFinding } from './lint';

export const STRESS_DIR = resolve(__dirname, '../../stress');

/** The same pinned instant the gallery snapshots render at. */
export const STRESS_NOW = '2026-01-15T09:00:00Z';

export interface StressFixture {
  /** `stress/`-relative path, e.g. `gantt/long-labels--release-plan.dgmo`. */
  id: string;
  path: string;
  chartType: string;
  dimension: string;
  /** What the fixture pushes on, from its `// stress:` line. */
  intent: string;
  /** Open tracker rows naming a defect this fixture shows, from `// known:` lines. */
  known: string[];
  source: string;
}

export interface StressResult {
  fixture: StressFixture;
  svg: string;
  errors: string[];
  findings: LintFinding[];
}

const HEADER_RE = /^\/\/\s*(stress|known):\s*(.+)$/;

export function parseHeader(source: string): {
  intent: string;
  known: string[];
} {
  let intent = '';
  const known: string[] = [];
  for (const line of source.split('\n')) {
    const m = HEADER_RE.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'stress') intent = m[2].trim();
    else known.push(m[2].trim());
  }
  return { intent, known };
}

export function loadCorpus(dir = STRESS_DIR): StressFixture[] {
  const out: StressFixture[] = [];
  for (const type of readdirSync(dir).sort()) {
    const typeDir = join(dir, type);
    if (!statSync(typeDir).isDirectory()) continue;
    for (const file of readdirSync(typeDir).sort()) {
      if (!file.endsWith('.dgmo')) continue;
      const path = join(typeDir, file);
      const source = readFileSync(path, 'utf-8');
      const { intent, known } = parseHeader(source);
      out.push({
        id: relative(dir, path),
        path,
        chartType: type,
        dimension: file.split('--')[0],
        intent,
        known,
        source,
      });
    }
  }
  return out;
}

export async function renderFixture(
  fixture: StressFixture
): Promise<StressResult> {
  setPinnedNow(Date.parse(STRESS_NOW));
  const { svg, diagnostics } = await render(fixture.source, {
    theme: 'light',
    palette: 'nord',
    mapData: loadMapData,
  });
  const errors = diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => `line ${d.line}: ${d.message}`);
  return { fixture, svg, errors, findings: lintSvg(svg) };
}
