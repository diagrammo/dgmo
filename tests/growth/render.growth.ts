// The render growth sweep (diagrammo/diagrammo#2025). Nightly on anchor only:
// `pnpm test:growth`, from scripts/nightly-gate.sh in the workspace repo.
//
// For each chart type, time the full render() pipeline at SMALL and LARGE
// elements and assert the growth exponent k (cost ∝ nᵏ). Never a wall-clock
// budget: load inflates both sizes alike and cancels out of k.
//
// Why it exists: two whiteboard changes on 2026-11-11 made arrow layout cost
// ~n³ (k ≈ 2.8 measured), and the board became unusable in the app (#2024).
// Every unit test passed; nothing measured how cost grows.
import { describe, expect, it } from 'vitest';
import { render } from '../../src/render';
import { CHART_TYPE_REGISTRY } from '../../src/chart-type-registry';
import { loadMapData } from '../../src/map/load-data';
import { setPinnedNow } from '../../src/utils/now';
import { measureGrowthAsync } from '../perf-helpers';
import { DEFAULT_LIMIT, GENERATORS, NOT_SCALABLE } from './generators';

const SMALL = 20;
const LARGE = 60;

setPinnedNow(Date.parse('2026-01-15T09:00:00Z'));

const renderOnce = (source: string) =>
  render(source, { theme: 'light', palette: 'nord', mapData: loadMapData });

describe('render growth sweep', () => {
  it('covers every chart type, or says why a type has no size', () => {
    const missing = CHART_TYPE_REGISTRY.map((d) => d.id).filter(
      (id) => !(id in GENERATORS) && !(id in NOT_SCALABLE)
    );
    expect(
      missing,
      'chart types with no generator in tests/growth/generators.ts'
    ).toEqual([]);
  });

  for (const [type, g] of Object.entries(GENERATORS)) {
    const limit = g.limit ?? DEFAULT_LIMIT;
    it(`${type}: render cost grows slower than n^${limit}`, async () => {
      for (const n of [SMALL, LARGE]) {
        const { diagnostics } = await renderOnce(g.gen(n));
        const errors = diagnostics.filter((d) => d.severity === 'error');
        expect(
          errors.map((d) => `line ${d.line}: ${d.message}`),
          `${type} at n=${n} must render cleanly`
        ).toEqual([]);
      }
      const k = await measureGrowthAsync({
        small: SMALL,
        large: LARGE,
        prepare: (n) => g.gen(n),
        run: renderOnce,
        limit,
        rounds: 3,
        minMs: 20,
      });
      console.warn(`growth ${type} k=${k.toFixed(2)} limit=${limit}`);
      const row = g.known ? ` — tracked in ${g.known}` : '';
      expect(k, `${type} render cost ∝ n^${k.toFixed(2)}${row}`).toBeLessThan(
        limit
      );
    });
  }
});
