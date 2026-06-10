// Boxes-and-lines LAYOUT-OPTIONS workbench — renders several genuinely DIFFERENT
// layout strategies of one diagram to captioned PNGs, for eyeball comparison.
// Run: OPT_FILE=path/to.dgmo pnpm bench:bl-options   (writes /tmp/opt-*.png)
//
// This is the human-in-the-loop instrument: the machine guarantees correctness
// and diversity, you judge readability. Edit the `options` list to explore new
// directions each round. Defaults to the pirate-fleet gauntlet diagram.
import { test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import {
  layoutBoxesAndLines,
  computeNodeSize,
  NODE_WIDTH,
  NODE_HEIGHT,
  type BLLayoutResult,
} from '../src/boxes-and-lines/layout';
import { layeredCandidates } from '../src/boxes-and-lines/layout-layered';
import { countSplineCrossings } from '../src/boxes-and-lines/layout-search';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { getPalette } from '../src/palettes';

const P = getPalette('slate').light;
const FILE =
  process.env.OPT_FILE ??
  '/Users/demian/code/diagrammo/my-diagrams/sandbox/layout-gauntlet/12-pirate-fleet.dgmo';

function sizesFor(parsed: ReturnType<typeof parseBoxesAndLines>) {
  const m = new Map<string, { width: number; height: number }>();
  for (const n of parsed.nodes)
    m.set(
      n.label,
      n.description?.length
        ? computeNodeSize(n, parsed.showValues === true)
        : { width: NODE_WIDTH, height: NODE_HEIGHT }
    );
  return m;
}

function png(
  parsed: ReturnType<typeof parseBoxesAndLines>,
  layout: BLLayoutResult,
  out: string
): { W: number; H: number } {
  const el = document.createElement('div');
  const W = Math.ceil(layout.width);
  const H = Math.ceil(layout.height);
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: { width: W, height: H },
    exportMode: true,
  });
  const svg = el.querySelector('svg')!;
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!svg.getAttribute('viewBox'))
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  writeFileSync(
    out,
    new Resvg(svg.outerHTML, { background: '#ffffff' }).render().asPng()
  );
  return { W, H };
}

test('render layout options', async () => {
  const parsed = parseBoxesAndLines(readFileSync(FILE, 'utf8'));
  const sizes = sizesFor(parsed);
  const lc = (o?: Parameters<typeof layeredCandidates>[2]) =>
    layeredCandidates(parsed, sizes, o)[0];

  const options: { name: string; layout: BLLayoutResult | undefined }[] = [
    {
      name: 'A — ELK orthogonal (baseline)',
      layout: await layoutBoxesAndLines(parsed, undefined, {
        layoutMode: 'elk',
      }),
    },
    {
      name: 'B — search engine as shipped (dagre pool + layered candidates)',
      layout: await layoutBoxesAndLines(parsed, undefined, {
        layoutMode: 'search',
      }),
    },
    {
      name: 'C — layered, nearest-side back-edges, default spacing',
      layout: lc({ backEdgeSide: 'nearest' }),
    },
    {
      name: 'D — layered, all back-edges on LEFT (single feedback bus)',
      layout: lc({ backEdgeSide: 'left' }),
    },
    {
      name: 'E — layered, airy spacing (nodesep 76 / ranksep 104)',
      layout: lc({ nodesep: 76, ranksep: 104, backEdgeSide: 'nearest' }),
    },
  ];

  let i = 0;
  for (const o of options) {
    const letter = String.fromCharCode(65 + i);
    i++;
    if (!o.layout) {
      console.error(`${o.name}\n    (no candidate — engine returned [])`);
      continue;
    }
    const out = `/tmp/opt-${letter}.png`;
    const { W, H } = png(parsed, o.layout, out);
    const cr = countSplineCrossings(o.layout);
    console.error(`${o.name}\n    crossings ${cr}  size ${W}×${H}  → ${out}`);
  }
}, 120_000);
