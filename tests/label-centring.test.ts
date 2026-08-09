/**
 * Guards the convention that a vertically-centred <text> is centred BY THE
 * RENDERER — `y` on the band's centre plus `dominant-baseline="central"` —
 * rather than by arithmetic of ours.
 *
 * Why this file exists: on 2026-08-09, fifteen sites across nine renderers were
 * switched off a hand-rolled `bandCentre + fontSize / 2 - 1|2` offset, and the
 * whole suite noticed by moving exactly ONE snapshot. Header and badge label
 * positions were almost entirely unsnapshotted, so the change was invisible to
 * the tests in both directions — nothing objected, and nothing would have
 * objected if it had been wrong.
 *
 * Two guards, because they fail on different things:
 *
 *   1. the rendered positions, so a label that moves has to be acknowledged
 *   2. the source shape, so the arithmetic cannot come back somewhere new
 *
 * A hand-rolled offset is wrong in a way that is easy to miss and easy to
 * reintroduce: it approximates half the font's cap height with a literal, so
 * it is a fraction of a pixel out at every size, and two labels of DIFFERENT
 * sizes on the same row land on different baselines. Kanban had exactly that —
 * a column name at font-size 13 (`- 2`) beside its count badge at 10 (`- 1`),
 * sitting on 80.5 and 80.0.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { nordPalette } from '../src/palettes/nord';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of [
    ['document', win.document],
    ['window', win],
    ['navigator', win.navigator],
    ['HTMLElement', win.HTMLElement],
    ['SVGElement', win.SVGElement],
  ] as const) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const palette = nordPalette.light;
const repo = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf-8');

/**
 * Every centred label in the SVG, as `y | font-size | text`, in document order.
 *
 * Deliberately the y the renderer was GIVEN rather than a measured position:
 * jsdom has no layout, and the given y is the thing that regressed — under the
 * old arithmetic it carried the offset baked in.
 */
function centredLabels(svg: string): string[] {
  const out: string[] = [];
  const re = /<text\b([^>]*\bdominant-baseline="central"[^>]*)>([^<]*)</g;
  for (const m of svg.matchAll(re)) {
    const attrs = m[1] ?? '';
    const at = (name: string) =>
      new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? '—';
    out.push(`y=${at('y')} size=${at('font-size')} ${JSON.stringify(m[2])}`);
  }
  return out;
}

// One diagram per renderer whose header/badge labels moved in that pass, plus
// the ones that already centred correctly — an unrelated regression in those is
// worth catching here too. journey-map is inline because the repo ships no
// fixture for it; the rest use the fixtures the gallery already maintains.
const JOURNEY_MAP = `journey-map Signing up
[Discover]
  Reads the docs score: 4, emotion: Curious
[Try]
  Installs the app score: 5, emotion: Pleased`;

const CASES: [name: string, source: () => string][] = [
  ['kanban', () => repo('gallery/fixtures/kanban.dgmo')],
  ['journey-map', () => JOURNEY_MAP],
  ['org', () => repo('gallery/fixtures/org-basic.dgmo')],
  ['sitemap', () => repo('gallery/fixtures/sitemap-basic.dgmo')],
  ['family', () => repo('gallery/fixtures/family.dgmo')],
  ['infra', () => repo('gallery/fixtures/infra.dgmo')],
  ['event-line', () => repo('gallery/fixtures/event-line.dgmo')],
  ['pert', () => repo('test-fixtures/pert/monte-carlo.dgmo')],
];

describe('centred labels sit on the band centre', () => {
  for (const [name, source] of CASES) {
    it(`${name} — every centred label, with the y it was given`, async () => {
      const svg = await renderForExport(source(), 'light', palette);
      // A fixture that stops parsing renders an error card, whose labels would
      // snapshot happily and assert nothing about the renderer under test.
      expect(svg).not.toContain("Couldn't render");
      const labels = centredLabels(svg);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels).toMatchSnapshot();
    });
  }
});

// ── The source-shape guard ──────────────────────────────────
//
// `<anything>FontSize / 2 - 2` and friends. Every match is either a text
// baseline computed by hand — the bug — or one of the sites below, which are
// not baselines at all and are listed with the reason they are allowed to look
// like one. A new match fails; so does a stale entry, so the list cannot rot
// into a blanket exemption.
const ALLOWED = new Map<string, string>([
  [
    'src/c4/renderer.ts::yPos + NAME_FONT_SIZE / 2 - 2',
    'anchors drawPersonIcon geometry, not a text baseline; the -2 is a ' +
      'hand-tune aligning the glyph with the name beside it (2 call sites)',
  ],
  [
    'src/sketch/renderer.ts::EDGE_LABEL_FONT_SIZE / 2 + 4',
    'half-height expanding an edge label into the autofit extents',
  ],
  [
    'src/sketch/renderer.ts::EDGE_LABEL_FONT_SIZE / 2 + 3',
    'half-height for an edge label collision rect in the declutter pass',
  ],
]);

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFilesUnder(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('no renderer centres text by hand', () => {
  it('every fontSize/2 ± n is a known non-baseline', () => {
    const root = resolve(__dirname, '..');
    const src = resolve(root, 'src');
    const shape =
      /([A-Za-z_$][\w$]*(?:[Ff]ont[Ss]ize|FONT_SIZE)[\w$]*)\s*\/\s*2\s*[-+]\s*\d+(?:\.\d+)?/g;

    const found = new Set<string>();
    for (const file of tsFilesUnder(src)) {
      const rel = relative(root, file);
      readFileSync(file, 'utf-8')
        .split('\n')
        // Prose in a comment may quote the old formula on purpose — the note
        // above centerText in legend-d3.ts does exactly that.
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .forEach((line) => {
          for (const m of line.matchAll(shape)) {
            // Name the site by the term it is added to, where that term is a
            // symbol — `yPos + NAME_FONT_SIZE / 2 - 2` says far more than the
            // constant alone. A bare number in front (`… / 2 + FONT / 2 - 2`)
            // is the tail of a band-centre expression and tells you nothing,
            // so it is left out.
            const idx = line.indexOf(m[0]);
            const lead =
              line.slice(0, idx).match(/([A-Za-z_$][\w$.]* \+ )$/)?.[1] ?? '';
            found.add(`${rel}::${lead}${m[0]}`.replace(/\s+/g, ' '));
          }
        });
    }

    // Sorted so the failure message reads as a diff of two lists.
    expect([...found].sort()).toEqual([...ALLOWED.keys()].sort());
  });
});
