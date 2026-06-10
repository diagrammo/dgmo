// Boxes-and-lines GALLERY — a self-contained HTML page comparing layout engines
// across a curated corpus, for keeping open in a browser during the layout loop.
// Run: pnpm bl-gallery   → writes /tmp/bl-gallery/index.html (open it, keep the
// tab; re-run after engine/corpus changes and refresh).
//
// Each chart shows ELK vs the shipped search engine, with X/O/P badges (crossings
// / overlaps / pierces) and a global "highlight issues" toggle that overlays
// overlap runs (red) and pierced nodes (orange) on the real render.
import { test } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import {
  layoutBoxesAndLines,
  type BLLayoutResult,
} from '../src/boxes-and-lines/layout';
import {
  countSplineCrossings,
  countEdgeOverlaps,
  countEdgeNodePierces,
  detectEdgeOverlaps,
  detectEdgeNodePierces,
} from '../src/boxes-and-lines/layout-search';
import { getPalette } from '../src/palettes';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';

const GAUNT =
  '/Users/demian/code/diagrammo/my-diagrams/sandbox/layout-gauntlet';
const GALL = '/Users/demian/code/diagrammo/my-diagrams/sandbox/gallery';

// Curated, diverse set — edit this list to change what's on the sheet.
const CORPUS: { name: string; path: string }[] = [
  { name: 'Treasure Hunt', path: `${GALL}/treasure-hunt.dgmo` },
  { name: 'Port Logistics', path: `${GALL}/port-logistics.dgmo` },
  { name: 'Naval Mesh', path: `${GALL}/naval-mesh.dgmo` },
  { name: 'Pirate Fleet', path: `${GAUNT}/12-pirate-fleet.dgmo` },
  { name: 'Microservices Saga', path: `${GAUNT}/01-microservices-saga.dgmo` },
  { name: 'CI/CD Pipeline', path: `${GAUNT}/04-cicd-pipeline.dgmo` },
  { name: 'Multi-Cloud', path: `${GAUNT}/10-multi-cloud.dgmo` },
  { name: 'Online Marketplace', path: `${GAUNT}/30-online-marketplace.dgmo` },
];

const P = getPalette('slate').light;

function metrics(l: BLLayoutResult) {
  return {
    x: countSplineCrossings(l),
    o: countEdgeOverlaps(l),
    p: countEdgeNodePierces(l),
  };
}

// Real render → SVG string, with a toggleable issues overlay (<g class=issues>).
function svgFor(
  parsed: ReturnType<typeof parseBoxesAndLines>,
  layout: BLLayoutResult
): string {
  const W = Math.ceil(layout.width),
    H = Math.ceil(layout.height);
  const el = document.createElement('div');
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

  const overlay: string[] = ['<g class="bl-issues">'];
  for (const pc of detectEdgeNodePierces(layout)) {
    const n = layout.nodes.find((nd) => nd.label === pc.node);
    if (n)
      overlay.push(
        `<rect x="${n.x - n.width / 2}" y="${n.y - n.height / 2}" width="${n.width}" height="${n.height}" rx="6" fill="none" stroke="#f76808" stroke-width="3"/>`
      );
  }
  for (const r of detectEdgeOverlaps(layout)) {
    const d = r.pts
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    overlay.push(
      `<path d="${d}" fill="none" stroke="#e5484d" stroke-width="5" stroke-opacity="0.6" stroke-linecap="round"/>`
    );
  }
  overlay.push('</g>');
  return svg.outerHTML.replace('</svg>', overlay.join('') + '</svg>');
}

const badge = (m: { x: number; o: number; p: number }) =>
  `<span class="badges"><b class="${m.x ? 'hot' : ''}">${m.x}×</b><b class="${m.o ? 'hot' : ''}">${m.o}∥</b><b class="${m.p ? 'hot' : ''}">${m.p}⊘</b></span>`;

test('build gallery', async () => {
  const sections: string[] = [];
  const cards: string[] = [];
  let exT = 0,
    eoT = 0,
    epT = 0,
    sxT = 0,
    soT = 0,
    spT = 0;

  for (let i = 0; i < CORPUS.length; i++) {
    const c = CORPUS[i]!;
    const id = `c${i}`;
    const parsed = parseBoxesAndLines(readFileSync(c.path, 'utf8'));
    const elk = await layoutBoxesAndLines(parsed, undefined, {
      layoutMode: 'elk',
    });
    const search = await layoutBoxesAndLines(parsed, undefined, {
      layoutMode: 'search',
    });
    const em = metrics(elk),
      sm = metrics(search);
    exT += em.x;
    eoT += em.o;
    epT += em.p;
    sxT += sm.x;
    soT += sm.o;
    spT += sm.p;
    const elkSvg = svgFor(parsed, elk);
    const searchSvg = svgFor(parsed, search);
    cards.push(
      `<a class="card" href="#${id}"><div class="thumb">${searchSvg}</div><div class="cap"><span>${c.name}</span>${badge(sm)}</div></a>`
    );
    sections.push(`<section id="${id}" class="chart">
      <h2>${c.name} <span class="sub">${parsed.nodes.length} nodes · ${parsed.edges.length} edges</span></h2>
      <div class="panels">
        <figure><figcaption>ELK ${badge(em)}</figcaption><div class="art">${elkSvg}</div></figure>
        <figure><figcaption>search ${badge(sm)}</figcaption><div class="art">${searchSvg}</div></figure>
      </div></section>`);
  }

  const sumBadge = (label: string, x: number, o: number, p: number) =>
    `<span class="tot"><em>${label}</em> ${x}× ${o}∥ ${p}⊘ <strong>= ${x + o + p}</strong></span>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>B&L Layout Gallery</title>
<style>
:root{--bg:#fff;--fg:#161b22;--mut:#6b7681;--line:#e3e7ec;--card:#fafbfc}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 -apple-system,Inter,system-ui,sans-serif;color:var(--fg);background:#f4f6f8}
header{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:14px 22px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
header h1{font-size:17px;margin:0}
.tot{font-size:12px;color:var(--mut);margin-right:14px}.tot em{font-style:normal;font-weight:600;color:var(--fg)}
.toggle{margin-left:auto;font-size:13px;display:flex;align-items:center;gap:7px;cursor:pointer}
.hint{font-size:12px;color:var(--mut)}
.overview{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;padding:22px}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;transition:box-shadow .15s,transform .15s}
.card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08);transform:translateY(-2px)}
.thumb{height:150px;display:flex;align-items:center;justify-content:center;padding:10px;background:#fff}
.thumb svg{max-width:100%;max-height:100%;height:auto;width:auto}
.cap{display:flex;justify-content:space-between;align-items:center;padding:8px 11px;border-top:1px solid var(--line);font-size:12px;font-weight:600}
main{padding:0 22px 60px}
.chart{margin-top:34px;border-top:1px solid var(--line);padding-top:18px}
.chart h2{font-size:16px;margin:0 0 14px}.sub{font-weight:400;color:var(--mut);font-size:12px}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:22px}
figure{margin:0}figcaption{font-size:12px;color:var(--mut);font-weight:600;margin-bottom:7px;display:flex;align-items:center;gap:8px}
.art{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;justify-content:center}
.art svg{max-width:100%;height:auto}
.badges{display:inline-flex;gap:5px}.badges b{font-weight:600;font-size:11px;color:var(--mut);background:#eef1f4;border-radius:5px;padding:1px 5px}
.badges b.hot{color:#b42318;background:#fee4e2}
.bl-issues{display:none}
body.issues .bl-issues{display:inline}
@media(max-width:760px){.panels{grid-template-columns:1fr}}
</style></head><body>
<header>
  <h1>B&amp;L Layout Gallery</h1>
  ${sumBadge('ELK', exT, eoT, epT)} ${sumBadge('search', sxT, soT, spT)}
  <span class="hint">× crossings · ∥ overlaps · ⊘ pierces</span>
  <label class="toggle"><input type="checkbox" id="iss"> highlight issues</label>
</header>
<div class="overview">${cards.join('')}</div>
<main>${sections.join('')}</main>
<script>document.getElementById('iss').addEventListener('change',e=>document.body.classList.toggle('issues',e.target.checked));</script>
</body></html>`;

  mkdirSync('/tmp/bl-gallery', { recursive: true });
  writeFileSync('/tmp/bl-gallery/index.html', html);

  console.error(
    `gallery → /tmp/bl-gallery/index.html  (${CORPUS.length} charts)\n  ELK ${exT + eoT + epT} vs search ${sxT + soT + spT} total badness`
  );
}, 120_000);
