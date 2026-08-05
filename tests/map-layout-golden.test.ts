import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../src/render';
import { loadMapData } from '../src/map/load-data';

/**
 * Golden output gate for `layoutMap`.
 *
 * `src/map/layout.ts` is the largest and most-churned file in the library, and
 * almost all of it is one function whose ten output arrays are built across
 * dependent stages. Nothing else in the suite would catch a stage being
 * reordered or a shared local being read a line too early: the other map tests
 * assert on individual properties, so a change that shifts every label by two
 * pixels passes all of them.
 *
 * This renders each map fixture end-to-end and pins a hash of the SVG. It says
 * only "the drawn output changed" — which is exactly the question a refactor of
 * that file needs answered, and the one no other test asks. When a hash moves:
 *
 *   - intentionally → eyeball the fixture, then `vitest -u`
 *   - during a refactor → the change is not behaviour-preserving; find the stage
 *
 * The per-fixture byte length sits alongside each hash so a diff shows roughly
 * how much moved, not just that something did.
 */

const withMapData = { mapData: loadMapData };

const GALLERY = join(__dirname, '..', 'gallery', 'fixtures');
const CONTENT = join(__dirname, '..', '..', 'dgmo-content', 'examples', 'map');

/** Every `map` fixture we can reach, by name, deterministically ordered. */
function mapSources(): Array<{ name: string; source: string }> {
  const out: Array<{ name: string; source: string }> = [];

  for (const f of readdirSync(GALLERY).sort()) {
    // `sitemap-*` / `treemap-*` / `heatmap` are different chart types.
    if (!f.startsWith('map-') || !f.endsWith('.dgmo')) continue;
    out.push({ name: f, source: readFileSync(join(GALLERY, f), 'utf8') });
  }

  // The shipped examples live in a sibling repo. Absent in a bare checkout of
  // dgmo alone, so their absence is skipped rather than failed — the gallery
  // fixtures above are the part that must always be there.
  if (existsSync(CONTENT)) {
    for (const f of readdirSync(CONTENT).sort()) {
      if (!f.endsWith('.dgmo')) continue;
      out.push({
        name: `content/${f}`,
        source: readFileSync(join(CONTENT, f), 'utf8'),
      });
    }
  }

  return out;
}

const SOURCES = mapSources();

/** Canvases chosen to exercise the size-dependent stages, not just one fit. */
const CANVASES = [
  { label: '1200x800', width: 1200, height: 800 },
  // Tall and narrow: forces the contain-fit path and squeezes label escalation.
  { label: '520x900', width: 520, height: 900 },
] as const;

/**
 * `renderMap` namespaces every def id with a monotonic per-render counter
 * (`mapInstanceCounter`, `src/map/renderer.ts`) so two maps on one page don't
 * share `url(#…)` targets. It is deliberately never reset, so the Nth render in
 * a process gets `__mN` — real, correct, and the one thing here that legitimately
 * differs between two identical renders. Fold it to a constant before hashing.
 */
function digest(svg: string): string {
  const stable = svg.replace(/__m\d+\b/g, '__mX');
  return createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

/**
 * The hashes below are platform-specific, and only darwin's are recorded.
 *
 * 🔴 Do NOT "fix" a failure here by re-recording on another platform — it will
 * simply move the failure to this one. Map geometry is projected with
 * trigonometry, and macOS and Linux disagree in the last bits of `Math.sin` and
 * friends: identical input serializes coordinates whose final digits differ, so
 * the same fixture comes out a handful of bytes longer or shorter. On CI the
 * per-fixture deltas were 1–10 bytes out of ~400,000 — a few digits, not a
 * moved label.
 *
 * That is the whole failure. It caught libm, never a regression, and it held
 * `main` red from 2026-07-24 to 2026-08-05 while saying nothing true.
 *
 * Established 2026-08-05, by elimination: the suite passes on macOS under Node
 * 22 (what CI runs) as well as Node 26 (what this machine runs), and fails only
 * on Linux. So it is the platform, not the runtime.
 *
 * Skipping loses no coverage that was ever real. `.husky/pre-push` runs
 * `pnpm test` before anything leaves this machine, so the gate this file exists
 * to be — "did a refactor of `src/map/layout.ts` change the drawn output" —
 * still fires on every push, on the platform whose hashes these are.
 *
 * To make it run everywhere, quantize the emitted coordinates (`geo-query.ts`
 * already does this for POI dots, at 2dp, for the same false-precision reason).
 * That is a rendering change with its own upside — these SVGs are ~400KB — and
 * it belongs in its own commit, not in a test guard.
 */
const GOLDEN_PLATFORM = 'darwin';
const onGoldenPlatform = process.platform === GOLDEN_PLATFORM;

describe('map layout golden output', () => {
  // `clock` POIs draw the real current time (`map-office-hours` is four of
  // them), so those fixtures re-render differently every minute — and change
  // LENGTH when a label crosses a digit boundary. Pin the instant. The suite
  // runs under `TZ=UTC` (see the `test` script), which the clock labels also
  // depend on; a bare `vitest run` without it will not match this snapshot.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('finds the gallery fixtures', () => {
    // Guards the glob itself: an empty corpus would make every test below pass
    // by rendering nothing.
    expect(SOURCES.length).toBeGreaterThanOrEqual(16);
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const canvas of CANVASES) {
      // NOTE: the title is the snapshot key — renaming it orphans the recorded
      // baseline, so it stays exactly as it is.
      it.skipIf(!onGoldenPlatform)(
        `is unchanged — ${theme}, ${canvas.label}`,
        async () => {
          const rows: Record<string, string> = {};

          for (const { name, source } of SOURCES) {
            const { svg, diagnostics } = await render(source, {
              ...withMapData,
              theme,
              width: canvas.width,
              height: canvas.height,
            });
            const errs = diagnostics.filter(
              (d) => d.severity === 'error'
            ).length;
            rows[name] = `${digest(svg)} ${svg.length}b${
              errs > 0 ? ` ${errs}err` : ''
            }`;
          }

          expect(rows).toMatchSnapshot();
        }
      );
    }
  }
});
