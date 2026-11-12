// Chart frame (#1827) on the canvas family: boxes-and-lines, whiteboard,
// swimlane, version-control, wireframe, block. The every-type test covers the
// footer-last case; this pins mid-file placement and the case-sensitive match.

import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { parseBlock } from '../src/block/parser';
import { parseSwimlane } from '../src/swimlane/parser';
import { parseVersionControl } from '../src/version-control/parser';
import { parseWireframe } from '../src/wireframe/parser';
import { parseWhiteboard } from '../src/whiteboard/parser';

describe('chart frame, canvas family (#1827)', () => {
  it('boxes-and-lines: mid-file, and `Source` stays a box', () => {
    const p = parseBoxesAndLines(
      'boxes-and-lines T\nSource -> Sink\nsubtitle Deck\nSink -> Out\nbyline Me'
    );
    expect(p.frame?.subtitle).toBe('Deck');
    expect(p.frame?.byline).toBe('Me');
    expect(p.nodes.map((n) => n.label)).toContain('Source');
    expect(p.edges).toHaveLength(2);
    expect(p.diagnostics).toEqual([]);
  });

  it('block: mid-file, and a bracketed `[Source]` stays a block', () => {
    const p = parseBlock(
      'block T\n[Source] [Sink]\nfootnote Note one\n[Out]\n'
    );
    expect(p.frame?.footnotes?.[0]?.text).toBe('Note one');
    expect(p.top.rows).toHaveLength(2);
    expect(p.diagnostics).toEqual([]);
  });

  it('swimlane: read once, ignored by the later passes', () => {
    const p = parseSwimlane(
      'swimlane T\nlane A gray\n  Start -> Finish\nsubtitle Deck\nlane B blue\n  Finish\nsource Survey\n'
    );
    expect(p.frame?.subtitle).toBe('Deck');
    expect(p.frame?.source).toBe('Survey');
    expect(p.nodes.map((n) => n.label)).toEqual(['Start', 'Finish']);
    expect(p.diagnostics).toEqual([]);
  });

  it('version-control: mid-file', () => {
    const p = parseVersionControl(
      'version-control T\n\nmain\n  First\nsubtitle Deck\nmain\n  Second\n'
    );
    expect(p.frame?.subtitle).toBe('Deck');
    expect(p.nodes).toHaveLength(2);
  });

  it('wireframe: mid-file, and `Source` text stays an element', () => {
    const p = parseWireframe('wireframe T\nSource\nsubtitle Deck\n[Go]\n');
    expect(p.frame?.subtitle).toBe('Deck');
    expect(p.roots).toHaveLength(2);
  });

  it('whiteboard: mid-file', () => {
    const p = parseWhiteboard(
      'whiteboard T\nrectangle A at: 0 0, size: 10 10\nsubtitle Deck\nrectangle B at: 20 0, size: 10 10\n'
    );
    expect(p.frame?.subtitle).toBe('Deck');
    expect(p.elements).toHaveLength(2);
  });
});
