// Chart frame (#1827) on the visualisation family: slope, arc, timeline,
// event-line, wordcloud, venn, quadrant. The every-type test covers the happy
// path; this file pins what it cannot see.

import { describe, it, expect } from 'vitest';
import { parseSlope } from '../src/slope/parser';
import { parseArc } from '../src/arc/parser';
import { parseTimeline } from '../src/timeline/viz-parser';
import { parseEventLine } from '../src/event-line/parser';
import { parseWordcloud } from '../src/wordcloud/parser';
import { parseVenn } from '../src/venn/parser';
import { parseQuadrant } from '../src/quadrant/parser';
import { renderForExport } from '../src/d3';

describe('chart frame, visualisation family (#1827)', () => {
  it('slope: a capitalised Source row stays a row; a footer closes the period block', () => {
    const p = parseSlope(
      'slope T\nperiod\n  2019\n  2020\nfootnote Census\n  - second line\nSource 10 20\nsubtitle Deck\n'
    );
    expect(p.frame?.footnote?.lines).toEqual(['Census', '• second line']);
    expect(p.frame?.subtitle).toBe('Deck');
    expect(p.data.map((d) => d.label)).toEqual(['Source']);
    expect(p.periods).toEqual(['2019', '2020']);
  });

  it('arc: frame lines inside a group block are not nodes; capitalised Source is a node', () => {
    const p = parseArc(
      'arc T\n[G]\n  A -> B 3\nfootnote Note one\nSource -> A 2\n'
    );
    expect(p.frame?.footnote?.lines).toEqual(['Note one']);
    expect(p.links.map((l) => l.source)).toEqual(['A', 'Source']);
  });

  it('timeline: a footer between events is read and the tag group closes', () => {
    const p = parseTimeline(
      'timeline T\ntag Team\n  Red red\nfootnote Me\n2020-01 Start\n'
    );
    expect(p.frame?.footnote?.lines).toEqual(['Me']);
    expect(p.timelineEvents).toHaveLength(1);
  });

  it('event-line: footer after events is the frame, not a description', () => {
    const p = parseEventLine(
      'event-line T\n2019-09 Beta\n  Detail.\nfootnote Press\n2021-01 Launch\n'
    );
    expect(p.frame?.footnote?.lines).toEqual(['Press']);
    expect(p.events).toHaveLength(2);
    expect(p.events[0]!.description).toEqual(['Detail.']);
  });

  it('wordcloud, venn, quadrant: parse the frame anywhere', () => {
    expect(
      parseWordcloud('wordcloud T\nsubtitle S\nalpha 5\n').frame?.subtitle
    ).toBe('S');
    expect(
      parseVenn('venn T\nA\nB\nfootnote X\nA + B Both\n').frame?.footnote
        ?.lines[0]
    ).toBe('X');
    expect(
      parseQuadrant('quadrant T\nPoint: 0.5, 0.5\nfootnote B\n').frame?.footnote
        ?.lines[0]
    ).toBe('B');
  });

  // The arc renderer draws `layout chord` itself (#1856); the frame is its own.
  it('arc `layout chord` keeps the frame', async () => {
    const src = 'arc T\nlayout chord\nA -> B 3\nB -> C 2\nsubtitle Deck\n';
    const svg = await renderForExport(src, 'light');
    expect(svg).toContain('chart-subtitle');
  });
});
