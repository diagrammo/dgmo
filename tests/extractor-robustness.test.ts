import { describe, expect, it } from 'vitest';
import { extractDiagramSymbols } from '../src/completion';

const CHART_TYPES_WITH_EXTRACTORS = [
  'er',
  'flowchart',
  'infra',
  'class',
  'sequence',
  'state',
  'sitemap',
  'c4',
  'gantt',
  'pert',
  'boxes-and-lines',
  'tech-radar',
  'cycle',
  'journey-map',
  'raci',
  'rasci',
  'daci',
  'org',
  'kanban',
  'mindmap',
  'pyramid',
  'ring',
  'arc',
  'sankey',
  'timeline',
  'venn',
  'quadrant',
  'slope',
  'bar',
  'line',
  'pie',
  'doughnut',
  'area',
  'multi-line',
  'polar-area',
  'radar',
  'bar-stacked',
  'scatter',
  'heatmap',
  'funnel',
  'chord',
];

describe('extractor robustness', () => {
  for (const chartType of CHART_TYPES_WITH_EXTRACTORS) {
    describe(chartType, () => {
      it('survives empty string after chart type', () => {
        const result = extractDiagramSymbols(`${chartType}\n`);
        expect(result).not.toBeNull();
        expect(result!.entities).toBeInstanceOf(Array);
      });

      it('survives chart-type keyword only', () => {
        const result = extractDiagramSymbols(chartType);
        expect(result).not.toBeNull();
        expect(result!.entities).toBeInstanceOf(Array);
      });

      it('survives keyword + random garbage', () => {
        const garbage =
          '!@#$%^&*()_+{}|:<>?\n\t\t\x00\xff weird 🏴‍☠️ stuff\n-> <-';
        const result = extractDiagramSymbols(`${chartType}\n${garbage}\n`);
        expect(result).not.toBeNull();
        expect(result!.entities).toBeInstanceOf(Array);
      });

      it('survives valid fixture with last 20% truncated', () => {
        const fixture = buildFixture(chartType);
        const truncated = fixture.slice(0, Math.floor(fixture.length * 0.8));
        const result = extractDiagramSymbols(truncated);
        expect(result).not.toBeNull();
        expect(result!.entities).toBeInstanceOf(Array);
      });
    });
  }
});

function buildFixture(chartType: string): string {
  const fixtures: Record<string, string> = {
    er: 'er\nUsers\n  id int pk\n  name varchar\nOrders\n  id int pk\n  user_id int fk\n',
    flowchart: 'flowchart\nStart(Begin)\nProcess[Do thing]\nStart -> Process\n',
    infra: 'infra\nAPI\n  latency-ms 50\nDB\nAPI\n  -> DB\n',
    class:
      'class\nShip\n  + name: string\n  + sail(): void\nCrew\nShip *-- Crew\n',
    sequence: 'sequence\nAlice -> Bob\nBob -> Charlie\n',
    state: 'state\nIdle -> Running\nRunning -> Done\n',
    sitemap: 'sitemap\nHome\n  About\n  Contact\n',
    c4: 'c4\nUser is a person\nApp is a system\nUser -> App\n',
    gantt: 'gantt\nstart 2024-01-01\n30d Design\n20d Build\n',
    pert: 'pert\nDesign 5,8,12\nBuild 10,15,20\nDesign -> Build\n',
    'boxes-and-lines': 'boxes-and-lines\nAPI\nDB\nAPI -> DB\n',
    'tech-radar':
      'tech-radar\nrings\n  Adopt\n  Trial\nTools\n  Vite\n  esbuild\n',
    cycle: 'cycle\nPlan\nDo\nCheck\nAct\n',
    'journey-map': 'journey-map\npersona Shopper\n[Research]\n  Browse items\n',
    raci: 'raci\nroles Dev, PM, QA\n[Sprint]\n  Write code\n    Dev: R\n    PM: A\n',
    rasci: 'rasci\nroles Dev, PM\n[Phase]\n  Task\n    Dev: R\n',
    daci: 'daci\nroles Lead, Team\n[Phase]\n  Decision\n    Lead: D\n',
    org: 'org\n[Engineering]\nAlice\n  role: CTO\nBob\n',
    kanban: 'kanban\n[Todo]\n  Task A\n  Task B\n[Done]\n  Task C\n',
    mindmap: 'mindmap\nRoot\n  Branch A\n    Leaf 1\n  Branch B\n',
    pyramid: 'pyramid\nTop\nMiddle\nBase\n',
    ring: 'ring\nCore\nInner\nOuter\n',
    arc: 'arc\nAlice -> Bob\nBob -> Charlie\n',
    sankey: 'sankey\nSource -> Target 100\nTarget -> Sink 50\n',
    timeline: 'timeline\n1720 Golden Age begins\n1722 End of era\n',
    venn: 'venn\nSet A\nSet B\n  Overlap\n',
    quadrant: 'quadrant\nReact 0.8,0.9\nVue 0.7,0.8\n',
    slope: 'slope\nAlpha 10 20\nBeta 15 25\n',
    bar: 'bar\nseries Revenue\nQ1 100\nQ2 200\n',
    line: 'line\nseries Growth\nJan 10\nFeb 20\n',
    pie: 'pie\nSlice A 40\nSlice B 60\n',
    doughnut: 'doughnut\nInner 30\nOuter 70\n',
    area: 'area\nseries Traffic\nMon 100\nTue 150\n',
    'multi-line': 'multi-line\nseries A, B\nX 10 20\nY 30 40\n',
    'polar-area': 'polar-area\nNorth 40\nSouth 60\n',
    radar: 'radar\nSpeed 8\nPower 6\n',
    'bar-stacked': 'bar-stacked\nseries A, B\nX 10 20\nY 30 40\n',
    scatter: 'scatter\nPoint A 1,2\nPoint B 3,4\n',
    heatmap: 'heatmap\ncolumns Mon, Tue\nRow1 5 8\n',
    funnel: 'funnel\nTop 1000\nMiddle 500\nBottom 100\n',
    chord: 'chord\nA -> B 10\nB -> C 20\n',
  };
  return fixtures[chartType] ?? `${chartType}\nEntity1\nEntity2\n`;
}
