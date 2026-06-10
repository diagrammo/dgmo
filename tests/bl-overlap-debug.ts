// Boxes-and-lines OVERLAP debug — renders a diagram's edges as flattened
// polylines with detected overlap runs highlighted in RED (lines "stepping on"
// each other), so the honest overlap metric can be eyeballed and calibrated.
// Run: OPT_FILE=path.dgmo DIST=8 pnpm bench:bl-overlap   (writes /tmp/overlap-*.png)
//
// Overlap = a sustained run where one edge lies along another (within DIST), in
// the OPEN (a run hugging a shared node's box is port-convergence, excluded).
// Distinct from an X-crossing (a momentary touch), which countSplineCrossings
// already measures.
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { line as d3line, curveBasis } from 'd3-shape';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import {
  layoutBoxesAndLines,
  computeNodeSize,
  NODE_WIDTH,
  NODE_HEIGHT,
  type BLLayoutResult,
} from '../src/boxes-and-lines/layout';
import { layeredCandidates } from '../src/boxes-and-lines/layout-layered';
import {
  countSplineCrossings,
  detectEdgeOverlaps,
} from '../src/boxes-and-lines/layout-search';

const FILE =
  process.env.OPT_FILE ??
  '/Users/demian/code/diagrammo/my-diagrams/sandbox/layout-gauntlet/12-pirate-fleet.dgmo';
const DIST = Number(process.env.DIST ?? 8);

const gen = d3line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(curveBasis);

function debugSvg(layout: BLLayoutResult, dist: number): string {
  const W = Math.ceil(layout.width),
    H = Math.ceil(layout.height);
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  for (const n of layout.nodes)
    parts.push(
      `<rect x="${n.x - n.width / 2}" y="${n.y - n.height / 2}" width="${n.width}" height="${n.height}" rx="6" fill="#eef1f5" stroke="#c7ccd4"/><text x="${n.x}" y="${n.y}" font-size="11" fill="#444" text-anchor="middle" dominant-baseline="middle">${n.label}</text>`
    );
  for (const e of layout.edges)
    if (e.points.length >= 2)
      parts.push(
        `<path d="${gen(e.points as { x: number; y: number }[])}" fill="none" stroke="#9aa3af" stroke-width="1.5"/>`
      );
  for (const r of detectEdgeOverlaps(layout, { dist })) {
    const d = r.pts
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    parts.push(
      `<path d="${d}" fill="none" stroke="#e5484d" stroke-width="5" stroke-opacity="0.65" stroke-linecap="round"/>`
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

test('overlap debug', async () => {
  const parsed = parseBoxesAndLines(readFileSync(FILE, 'utf8'));
  const sizes = new Map<string, { width: number; height: number }>();
  for (const n of parsed.nodes)
    sizes.set(
      n.label,
      n.description?.length
        ? computeNodeSize(n, parsed.showValues === true)
        : { width: NODE_WIDTH, height: NODE_HEIGHT }
    );
  const opts: { name: string; layout: BLLayoutResult | undefined }[] = [
    {
      name: 'A-elk',
      layout: await layoutBoxesAndLines(parsed, undefined, {
        layoutMode: 'elk',
      }),
    },
    {
      name: 'B-search',
      layout: await layoutBoxesAndLines(parsed, undefined, {
        layoutMode: 'search',
      }),
    },
    {
      name: 'C-layered',
      layout: layeredCandidates(parsed, sizes)[0],
    },
  ];
  for (const o of opts) {
    if (!o.layout) continue;
    const out = `/tmp/overlap-${o.name}.png`;
    writeFileSync(
      out,
      new Resvg(debugSvg(o.layout, DIST), { background: '#ffffff' })
        .render()
        .asPng()
    );
    console.error(
      `${o.name.padEnd(12)} X-crossings ${countSplineCrossings(o.layout)}  overlaps@${DIST}px ${detectEdgeOverlaps(o.layout, { dist: DIST }).length}  → ${out}`
    );
  }
}, 120_000);
