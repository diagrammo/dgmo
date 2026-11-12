// Chart frame (#1827) specifics for the flows family: flowchart, state, infra,
// sequence, journey-map, tech-radar, gantt. The every-type test covers the
// frame at the end of a fixture; this pins what it cannot.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseState } from '../src/graph/state-parser';
import { collapseStateGroups } from '../src/graph/state-collapse';
import { parseInfra } from '../src/infra/parser';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { parseJourneyMap } from '../src/journey-map/parser';
import { parseTechRadar } from '../src/tech-radar/parser';
import { parseGantt } from '../src/gantt/parser';
import { calculateSchedule } from '../src/gantt/calculator';

describe('chart frame, flows family (#1827)', () => {
  it('flowchart: a frame line mid-file is read, a capitalised Source stays a node', () => {
    const p = parseFlowchart(
      'flowchart T\n[Source]\nsubtitle Deck line\n[Sink]\n[Source] -> [Sink]\nbyline Me\n'
    );
    expect(p.frame?.subtitle).toBe('Deck line');
    expect(p.frame?.byline).toBe('Me');
    expect(p.nodes.map((n) => n.label)).toContain('Source');
    expect(p.diagnostics).toEqual([]);
  });

  it('state: frame survives group collapse', () => {
    const p = parseState(
      'state T\n[Grp]\n  A -> B\nA -> C\nfootnote Provisional\n'
    );
    expect(p.frame?.footnotes?.[0]?.text).toBe('Provisional');
    const { parsed } = collapseStateGroups(p, new Set(['Grp']));
    expect(parsed.frame).toEqual(p.frame);
  });

  it('infra, sequence, journey-map, tech-radar, gantt parse a frame line after content', () => {
    expect(
      parseInfra('infra T\nEdge\n  rps 100\nsubtitle S\nApp\n').frame?.subtitle
    ).toBe('S');
    expect(
      parseSequenceDgmo('sequence T\nA -> B: hi\nsource Src\n').frame?.source
    ).toBe('Src');
    expect(
      parseJourneyMap('journey-map T\nsubtitle S\nPhase A\n  Step 3\n').frame
        ?.subtitle
    ).toBe('S');
    expect(
      parseTechRadar(
        'tech-radar T\nrings\n  Adopt\nsubtitle S\nQ quadrant: top-left\n'
      ).frame?.subtitle
    ).toBe('S');
    const g = parseGantt('gantt T\nA 3d\nbyline By\nB 2d\n');
    expect(g.frame?.byline).toBe('By');
    expect(calculateSchedule(g).frame?.byline).toBe('By');
  });

  it('infra: the exported root height follows the grown viewBox', async () => {
    const src =
      'infra T\nEdge\n  rps 100\n  -> App\nApp\n  rps 50\nsubtitle S\nfootnote F\nbyline B\n';
    const svg = await renderForExport(src, 'light');
    const root = new JSDOM(svg, { contentType: 'image/svg+xml' }).window
      .document.documentElement;
    const vbH = Number(root.getAttribute('viewBox')!.split(/\s+/)[3]);
    expect(Number(root.getAttribute('height'))).toBe(vbH);
    expect(root.querySelector('.chart-subtitle')).not.toBeNull();
  });
});
