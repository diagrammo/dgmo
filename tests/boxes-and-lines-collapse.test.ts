import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';

// Characterization tests for boxes-and-lines collapse. Before Story 110.1 this
// was only exercised by a benchmark + incidental parser/layout tests. These pin
// the flat-model behavior (label-keyed selection, __group_ virtual node, edge
// dedup + self-loop drop, DIRECT child count) — the behavior that the 110.1
// analysis found does NOT fit the tree engine and so stays bespoke.

const HEADER = 'boxes-and-lines';

describe('collapseBoxesAndLines', () => {
  it('returns the original parsed object when nothing collapsed', () => {
    const parsed = parseBoxesAndLines(`${HEADER}\n[AWS]\n  API\n  DB`);
    const { parsed: result, collapsedChildCounts } = collapseBoxesAndLines(
      parsed,
      new Set()
    );
    expect(result).toBe(parsed); // same reference
    expect(collapsedChildCounts.size).toBe(0);
  });

  it('removes children of a collapsed group and tallies DIRECT child count', () => {
    const parsed = parseBoxesAndLines(`${HEADER}\n[AWS]\n  API\n  DB`);
    const { parsed: result, collapsedChildCounts } = collapseBoxesAndLines(
      parsed,
      new Set(['AWS'])
    );
    expect(result.nodes.find((n) => n.label === 'API')).toBeUndefined();
    expect(result.nodes.find((n) => n.label === 'DB')).toBeUndefined();
    // Direct child count only (NOT recursive descendant count).
    expect(collapsedChildCounts.get('AWS')).toBe(2);
    // Collapsed group is dropped from groups[] (layout treats it as a node).
    expect(result.groups.find((g) => g.label === 'AWS')).toBeUndefined();
  });

  it('redirects an external edge endpoint to the __group_ virtual node', () => {
    const content = [
      HEADER,
      'Client',
      '  -calls-> API',
      '[AWS]',
      '  API',
      '  DB',
    ].join('\n');
    const parsed = parseBoxesAndLines(content);
    const { parsed: result } = collapseBoxesAndLines(parsed, new Set(['AWS']));
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe('Client');
    expect(result.edges[0].target).toBe('__group_AWS');
  });

  it('drops a self-loop when both endpoints collapse into the same group', () => {
    const content = [HEADER, '[AWS]', '  API', '    -talks-> DB', '  DB'].join(
      '\n'
    );
    const parsed = parseBoxesAndLines(content);
    const { parsed: result } = collapseBoxesAndLines(parsed, new Set(['AWS']));
    // API → DB both reroute to __group_AWS → self-loop → dropped.
    expect(result.edges.filter((e) => e.source === e.target)).toHaveLength(0);
  });

  it('deduplicates edges that collapse to the same source|target|label', () => {
    const content = [
      HEADER,
      'Client',
      '  -hit-> API',
      '  -hit-> DB',
      '[AWS]',
      '  API',
      '  DB',
    ].join('\n');
    const parsed = parseBoxesAndLines(content);
    const { parsed: result } = collapseBoxesAndLines(parsed, new Set(['AWS']));
    // Both Client→API and Client→DB reroute to Client→__group_AWS with label
    // "hit" → deduplicated to one edge.
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].target).toBe('__group_AWS');
  });
});
