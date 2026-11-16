/**
 * `width` with `height` — which chart types take it as an exact canvas, and
 * what the rest say when they cannot (#1965).
 *
 * Decided 2026-11-13: content-sized chart types stay tight to their content and
 * are never padded to reach the box. The language reference (§1.15) lists the
 * chart types that come back at exactly the requested size, and every other one
 * warns `W_CANVAS_HEIGHT_IGNORED`.
 *
 * The sweep renders every gallery fixture, so the documented list cannot drift
 * from what the renderers do: a type that starts or stops honouring the box
 * fails here until §1.15 says so.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '../src/render';
import { loadMapData } from '../src/map/load-data';

const FIXTURES = join(__dirname, '../gallery/fixtures');
const REFERENCE = join(__dirname, '../docs/language-reference.md');
const W = 1000;
const H = 600;

/** The backticked chart types between §1.15's exact-size-types markers. */
function documentedExactTypes(): Set<string> {
  const ref = readFileSync(REFERENCE, 'utf8');
  const block =
    /<!-- exact-size-types:start -->([\s\S]*?)<!-- exact-size-types:end -->/.exec(
      ref
    );
  if (!block) throw new Error('§1.15 exact-size-types markers missing');
  return new Set([...block[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
}

/** `arc` with `layout chord` renders as the internal `chord` type. */
const docName = (chartType: string | undefined): string =>
  chartType === 'chord' ? 'arc layout chord' : String(chartType);

function rootSize(svg: string): { w?: string; h?: string; vb?: string } {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  return {
    w: /\swidth="([^"]*)"/.exec(root)?.[1],
    h: /\sheight="([^"]*)"/.exec(root)?.[1],
    vb: /\sviewBox="([^"]*)"/.exec(root)?.[1],
  };
}

const heightWarnings = (ds: { code?: string }[]) =>
  ds.filter((d) => d.code === 'W_CANVAS_HEIGHT_IGNORED');

describe('width with height: exact for the §1.15 types, a warning for the rest', () => {
  const exact = documentedExactTypes();

  it('§1.15 names chart types', () => {
    expect(exact.size).toBeGreaterThan(10);
  });

  const files = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.dgmo'))
    .sort();

  it.each(files)('%s', async (file) => {
    const content = readFileSync(join(FIXTURES, file), 'utf8');
    const { svg, diagnostics, chartType } = await render(content, {
      width: W,
      height: H,
      mapData: loadMapData,
    });
    const size = rootSize(svg);
    const name = docName(chartType);
    if (exact.has(name)) {
      expect(size).toEqual({ w: `${W}`, h: `${H}`, vb: `0 0 ${W} ${H}` });
      expect(heightWarnings(diagnostics)).toHaveLength(0);
      return;
    }
    // Content-sized: tight to its content, never padded out to the box.
    expect(size.vb, `${name} came back at the exact box`).not.toBe(
      `0 0 ${W} ${H}`
    );
    const got = Number(size.vb?.split(/\s+/)[3]);
    if (Math.abs(got - H) > 1) {
      expect(heightWarnings(diagnostics)).toHaveLength(1);
      expect(heightWarnings(diagnostics)[0]!.message).toContain(
        `${Math.round(got)}px tall`
      );
    }
  });

  it('every documented type is covered by a fixture or named here', () => {
    // cycle, pyramid and ring have no gallery fixture; measured from the
    // reference's own examples on 2026-11-15 at 1000x600.
    const UNCOVERED = new Set(['cycle', 'pyramid', 'ring']);
    const covered = new Set<string>();
    for (const f of files) {
      const first = readFileSync(join(FIXTURES, f), 'utf8').split('\n')[0]!;
      covered.add(first.split(/\s+/)[0]!);
    }
    covered.add('arc layout chord');
    const missing = [...exact].filter(
      (t) => !covered.has(t) && !UNCOVERED.has(t)
    );
    expect(missing).toEqual([]);
  });
});

describe('W_CANVAS_HEIGHT_IGNORED', () => {
  const FLOW = 'flowchart Deploy\n\n(Start) -> [Build] -> (Done)\n';

  it('a height with no width asks for no box, so it says nothing', async () => {
    const { diagnostics } = await render(FLOW, { height: H });
    expect(heightWarnings(diagnostics)).toHaveLength(0);
  });

  it('a content-sized chart given a box warns once, naming its height', async () => {
    const { diagnostics } = await render(FLOW, { width: W, height: H });
    expect(heightWarnings(diagnostics)).toHaveLength(1);
    expect(heightWarnings(diagnostics)[0]!.severity).toBe('warning');
    expect(heightWarnings(diagnostics)[0]!.message).toMatch(
      /^This flowchart is \d+px tall — .* height of 600px was not applied\.$/
    );
  });
});
