// Playground — drives the PRODUCTION boxes-and-lines engines:
//   left  = ELK   (layoutBoxesAndLines, current default)
//   right = search (layoutBoxesAndLinesSearch, the experimental engine)
// Improvements to dgmo/src/boxes-and-lines/layout-search.ts show up here AND
// ship to the app — no drifted copy.
import { getPalette } from '../src/palettes/index';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { renderBoxesAndLinesForExport } from '../src/boxes-and-lines/renderer';
import {
  layoutBoxesAndLines,
  type BLLayoutResult,
} from '../src/boxes-and-lines/layout';
import {
  layoutBoxesAndLinesSearch,
  countSplineCrossings,
} from '../src/boxes-and-lines/layout-search';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { PRESETS } from './presets';

const palette = getPalette('slate').light;
type Parsed = ReturnType<typeof parseBoxesAndLines>;
type Pt = { x: number; y: number };

// gauntlet .dgmo files (workspace sandbox) as additional presets
const gauntletRaw = import.meta.glob(
  '../../my-diagrams/sandbox/layout-gauntlet/*.dgmo',
  { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;
const gauntlet: Record<string, string> = {};
for (const [path, txt] of Object.entries(gauntletRaw).sort()) {
  const name =
    'gauntlet/' + (path.split('/').pop() ?? path).replace(/\.dgmo$/, '');
  gauntlet[name] = txt;
}
const ALL_PRESETS: Record<string, string> = { ...gauntlet, ...PRESETS };

const $ = (id: string) => document.getElementById(id)!;
const src = $('src') as HTMLTextAreaElement;
const presetSel = $('preset') as HTMLSelectElement;
const seedsR = $('seeds') as HTMLInputElement;
const seedsVal = $('seedsval');
const lambdaR = $('lambda') as HTMLInputElement;
const lambdaVal = $('lambdaval');

let prevPos: Map<string, Pt> | null = null;
const collapsed = new Set<string>();

for (const name of Object.keys(ALL_PRESETS)) {
  const o = document.createElement('option');
  o.textContent = name;
  presetSel.appendChild(o);
}
src.value = Object.values(ALL_PRESETS)[0]!;

function renderInto(
  container: HTMLElement,
  parsed: Parsed,
  layout: BLLayoutResult
) {
  container.innerHTML = '';
  const div = document.createElement('div');
  container.appendChild(div);
  renderBoxesAndLinesForExport(
    div as HTMLDivElement,
    parsed,
    layout,
    palette,
    false,
    {
      exportDims: { width: layout.width, height: layout.height },
      exportMode: true,
    }
  );
}

function renderGroupToggles(parsed: Parsed) {
  const host = $('groups');
  host.innerHTML = '';
  if (!parsed.groups.length) {
    host.textContent = '(no groups to collapse)';
    return;
  }
  host.append('collapse: ');
  for (const grp of parsed.groups) {
    const lbl = document.createElement('label');
    lbl.style.marginRight = '8px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = collapsed.has(grp.label);
    cb.addEventListener('change', () => {
      cb.checked ? collapsed.add(grp.label) : collapsed.delete(grp.label);
      void update();
    });
    lbl.append(cb, ' ' + grp.label);
    host.appendChild(lbl);
  }
}

let token = 0;
async function update() {
  const my = ++token;
  const seeds = +seedsR.value;
  seedsVal.textContent = String(seeds);
  const lambda = +lambdaR.value;
  lambdaVal.textContent = String(lambda);
  let parsedFull: Parsed;
  try {
    parsedFull = parseBoxesAndLines(src.value, palette);
  } catch (e) {
    $('capA').textContent = 'parse error: ' + (e as Error).message;
    return;
  }
  renderGroupToggles(parsedFull);

  // resolve collapsed model + collapseInfo (shared by both engines)
  let parsedL = parsedFull;
  let collapseInfo:
    | {
        collapsedChildCounts: Map<string, number>;
        originalGroups: readonly Parsed['groups'][number][];
      }
    | undefined;
  const active = [...collapsed].filter((l) =>
    parsedFull.groups.some((g) => g.label === l)
  );
  if (active.length) {
    const cr = collapseBoxesAndLines(parsedFull, new Set(active));
    parsedL = cr.parsed;
    collapseInfo = {
      collapsedChildCounts: cr.collapsedChildCounts,
      originalGroups: cr.originalGroups,
    };
  }

  const elk = await layoutBoxesAndLines(parsedL, collapseInfo);
  if (my !== token) return;
  const search = layoutBoxesAndLinesSearch(parsedL, collapseInfo, {
    seeds,
    lambda,
    ...(prevPos && { previousPositions: prevPos }),
  });
  prevPos = new Map(search.nodes.map((n) => [n.label, { x: n.x, y: n.y }]));

  renderInto($('panelA'), parsedL, elk);
  renderInto($('panelB'), parsedL, search);
  const cA = countSplineCrossings(elk),
    cB = countSplineCrossings(search);
  const cls = (n: number) => (n === 0 ? 'good' : 'bad');
  $('capA').innerHTML =
    `ELK (current) <span class="m ${cls(cA)}">${cA} crossings</span>`;
  $('capB').innerHTML =
    `search (experimental) <span class="m ${cls(cB)}">${cB} crossings</span>`;
}

let timer: ReturnType<typeof setTimeout>;
const debounced = () => {
  clearTimeout(timer);
  timer = setTimeout(update, 220);
};
src.addEventListener('input', debounced);
[seedsR, lambdaR].forEach((el) => el.addEventListener('input', debounced));
presetSel.addEventListener('change', () => {
  src.value = ALL_PRESETS[presetSel.value]!;
  collapsed.clear();
  prevPos = null;
  void update();
});
void update();
