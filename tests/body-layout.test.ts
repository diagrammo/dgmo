// Body chart layout (diagrammo/diagrammo#2420): the tag legend never runs into
// the figures, and the figures and the central label column share a midline.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import { getFigure } from '../src/body/catalog';
import { measureSvgContent } from '../src/utils/export-fit';

const COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple'];
const VALUES = [
  'Primary mover on heavy compound days',
  'Secondary mover on accessory work',
  'Stabiliser under every loaded carry',
  'Warm-up only before the main lifts',
  'Mobility focus between working sets',
  'Rehab protocol from the physio',
  'Avoid entirely until cleared to train',
  'Deload week at half the usual volume',
];

/** Every muscle on both views, every one with a note, eight tag values. */
function everyMuscle(): string {
  const names = [
    ...new Set([
      ...Object.keys(getFigure('male', 'front').parts),
      ...Object.keys(getFigure('male', 'back').parts),
    ]),
  ];
  const tag = VALUES.map((v, i) => `  ${v} ${COLORS[i % COLORS.length]}`);
  const parts = names.map(
    (n, i) => `${n} e: ${VALUES[i % VALUES.length]}\n  Note for ${n} — 3×10`
  );
  return [
    'body Every Muscle',
    'front',
    'back',
    '',
    'tag Effort level as e',
    ...tag,
    '',
    ...parts,
  ].join('\n');
}

const FEW_NOTES = `body Few Notes
front
back

chest
  Bench press — 4×8
lats
  Pull-ups — 3×8
calves
  Raises — 3×15`;

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Box of the ink left after `keep` prunes the SVG (root units). */
function inkBox(svg: string, keep: (root: Element) => Element[]): Box {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const root = doc.documentElement;
  const keepers = keep(root);
  const prune = (e: Element): void => {
    for (const c of Array.from(e.children)) {
      if (keepers.includes(c)) continue;
      if (keepers.some((k) => c.contains(k))) prune(c);
      else c.remove();
    }
  };
  prune(root);
  const box = measureSvgContent(root.outerHTML).box;
  if (!box) throw new Error('nothing measured');
  return box;
}

/**
 * The figures' drawn extent: each scaled figure group's content box (the real
 * outline + head + hair extent) mapped through its transform, front then back.
 */
function figureBox(svg: string): Box {
  const groups = [
    ...svg.matchAll(
      /<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">/g
    ),
  ];
  expect(groups).toHaveLength(2);
  const out: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  groups.forEach((m, i) => {
    const cb = getFigure('male', i === 0 ? 'front' : 'back').contentBox;
    const [tx, ty, sc] = [Number(m[1]), Number(m[2]), Number(m[3])];
    out.x0 = Math.min(out.x0, tx + cb.x * sc);
    out.x1 = Math.max(out.x1, tx + (cb.x + cb.w) * sc);
    out.y0 = Math.min(out.y0, ty + cb.y * sc);
    out.y1 = Math.max(out.y1, ty + (cb.y + cb.h) * sc);
  });
  return out;
}
/** The central label column: name and note texts outside the figures. */
const labels = (root: Element): Element[] =>
  Array.from(root.querySelectorAll('text.dgmo-body-part'));
const legend = (root: Element): Element[] =>
  Array.from(root.querySelectorAll('.dgmo-legend'));

describe('body chart legend band (#2420)', () => {
  it('a legend wrapped onto several rows ends above the figures', async () => {
    const { svg } = await render(everyMuscle());
    const lg = inkBox(svg, legend);
    const fg = figureBox(svg);
    // Several rows: taller than one scaled legend row (28 × 2.4).
    expect(lg.y1 - lg.y0).toBeGreaterThan(28 * 2.4 * 1.5);
    expect(lg.y1).toBeLessThan(fg.y0);
  });
});

describe('body chart figures and label column share a midline (#2420)', () => {
  for (const [name, src] of [
    ['column taller than the figures', everyMuscle()],
    ['figures taller than the column', FEW_NOTES],
  ] as const) {
    it(name, async () => {
      const { svg } = await render(src);
      const fg = figureBox(svg);
      const lb = inkBox(svg, labels);
      const mid = (b: Box) => (b.y0 + b.y1) / 2;
      // Label text boxes are estimated, so allow a font's worth of slack.
      expect(Math.abs(mid(fg) - mid(lb))).toBeLessThan(24);
    });
  }
});
