import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

// Canvas Editor spike (Phase B) — the `layout` coordinate block: parse, the
// dagre bypass, partial-ignore, and the fixed feasibility corpus round-trip.

const CORPUS = join(__dirname, '..', 'test-fixtures', 'canvas-spike');
const readCorpus = (name: string) =>
  readFileSync(join(CORPUS, `${name}.dgmo`), 'utf8');

describe('boxes-and-lines `layout` block (canvas spike)', () => {
  describe('parse', () => {
    it('parses a trailing layout block into nodePositions', () => {
      const src = [
        'boxes-and-lines',
        'A -> B',
        '',
        'layout',
        '  A: 100, 40',
        '  B: 260, 40',
      ].join('\n');
      const p = parseBoxesAndLines(src);
      expect(p.error).toBeNull();
      expect(p.nodePositions?.size).toBe(2);
      expect(p.nodePositions?.get('A')).toEqual({ x: 100, y: 40 });
      expect(p.nodePositions?.get('B')).toEqual({ x: 260, y: 40 });
    });

    it('accepts negative and fractional coordinates', () => {
      const src = ['boxes-and-lines', 'A', 'layout', '  A: -12.5, 3.25'].join(
        '\n'
      );
      const p = parseBoxesAndLines(src);
      expect(p.nodePositions?.get('A')).toEqual({ x: -12.5, y: 3.25 });
    });

    it('warns on a malformed layout entry but keeps the rest', () => {
      const src = [
        'boxes-and-lines',
        'A -> B',
        'layout',
        '  A: 10, 20',
        '  B: not-a-coord',
      ].join('\n');
      const p = parseBoxesAndLines(src);
      expect(p.nodePositions?.has('A')).toBe(true);
      expect(p.nodePositions?.has('B')).toBe(false);
      expect(
        p.diagnostics.some((d) => /Invalid layout entry/.test(d.message))
      ).toBe(true);
    });

    it('leaves nodePositions undefined when there is no layout block', () => {
      const p = parseBoxesAndLines('boxes-and-lines\nA -> B');
      expect(p.nodePositions).toBeUndefined();
    });

    it('does NOT swallow a node legitimately named `layout` (F1)', () => {
      // `layout` here is a real node with a child edge — not a coordinate block.
      const src = [
        'boxes-and-lines',
        'layout',
        '  -feeds-> Renderer',
        'Renderer -> Screen',
      ].join('\n');
      const p = parseBoxesAndLines(src);
      expect(p.nodePositions).toBeUndefined();
      expect(p.nodes.map((n) => n.label)).toContain('layout');
      expect(p.edges.some((e) => e.source === 'layout')).toBe(true);
    });

    it('still opens the block when followed by real coordinate entries', () => {
      const src = ['boxes-and-lines', 'A', 'layout', '  A: 5, 5'].join('\n');
      const p = parseBoxesAndLines(src);
      expect(p.nodePositions?.get('A')).toEqual({ x: 5, y: 5 });
    });

    it('does not treat indented `layout`-looking content as a node', () => {
      const src = [
        'boxes-and-lines',
        'A -> B',
        'layout',
        '  A: 0, 0',
        '  B: 100, 0',
      ].join('\n');
      const p = parseBoxesAndLines(src);
      expect(p.nodes.map((n) => n.label).sort()).toEqual(['A', 'B']);
    });
  });

  describe('dagre bypass + round-trip', () => {
    it('pins every node exactly at its stored coordinate', async () => {
      const src = [
        'boxes-and-lines',
        'A -> B',
        'B -> C',
        'layout',
        '  A: 100, 100',
        '  B: 300, 100',
        '  C: 500, 100',
      ].join('\n');
      const lay = await layoutBoxesAndLines(parseBoxesAndLines(src));
      const at = (l: string) => lay.nodes.find((n) => n.label === l)!;
      expect([at('A').x, at('A').y]).toEqual([100, 100]);
      expect([at('B').x, at('B').y]).toEqual([300, 100]);
      expect([at('C').x, at('C').y]).toEqual([500, 100]);
    });

    it('round-trips auto coords through a written block with zero drift', async () => {
      const src = 'boxes-and-lines\nA -> B\nB -> C\nA -> C';
      const auto = await layoutBoxesAndLines(parseBoxesAndLines(src));
      const block =
        'layout\n' +
        auto.nodes
          .map((n) => `  ${n.label}: ${Math.round(n.x)}, ${Math.round(n.y)}`)
          .join('\n');
      const pinned = await layoutBoxesAndLines(
        parseBoxesAndLines(`${src}\n${block}`)
      );
      let drift = 0;
      for (const n of pinned.nodes) {
        const a = auto.nodes.find((x) => x.label === n.label)!;
        drift = Math.max(
          drift,
          Math.abs(n.x - Math.round(a.x)),
          Math.abs(n.y - Math.round(a.y))
        );
      }
      expect(drift).toBe(0);
    });

    it('emits straight 2-point border-clipped connectors when pinned', async () => {
      const src = [
        'boxes-and-lines',
        'A -> B',
        'layout',
        '  A: 100, 100',
        '  B: 400, 100',
      ].join('\n');
      const lay = await layoutBoxesAndLines(parseBoxesAndLines(src));
      expect(lay.edges).toHaveLength(1);
      const e = lay.edges[0]!;
      expect(e.straight).toBe(true);
      expect(e.points).toHaveLength(2);
      // Endpoints clipped to each box border: between the two centres on the x axis.
      expect(e.points[0]!.x).toBeGreaterThan(100);
      expect(e.points[1]!.x).toBeLessThan(400);
    });

    it('ignores a PARTIAL block (auto-layout + one diagnostic)', async () => {
      const src = [
        'boxes-and-lines',
        'A -> B',
        'B -> C',
        'layout',
        '  A: 7, 7',
      ].join('\n');
      const p = parseBoxesAndLines(src);
      expect(
        p.diagnostics.filter((d) => /partial/.test(d.message))
      ).toHaveLength(1);
      const lay = await layoutBoxesAndLines(p);
      // Not pinned: A did not land at (7,7).
      expect(lay.nodes.find((n) => n.label === 'A')!.x).not.toBe(7);
      // And the connectors are NOT the straight pinned kind.
      expect(lay.edges.every((e) => e.straight)).toBe(false);
    });

    it('does NOT bypass when groups are present (deferred)', async () => {
      const src = [
        'boxes-and-lines',
        'A -> B',
        '[G]',
        '  A',
        '  B',
        'layout',
        '  A: 10, 10',
        '  B: 200, 10',
      ].join('\n');
      const lay = await layoutBoxesAndLines(parseBoxesAndLines(src));
      // Group present → auto-layout path; A not pinned to (10,10).
      expect(lay.nodes.find((n) => n.label === 'A')!.x).not.toBe(10);
    });
  });

  describe('fixed feasibility corpus', () => {
    for (const name of [
      '01-clean-small',
      '02-tags-desc-comments',
      '03-parallel-edges-notes',
    ]) {
      it(`${name} parses and lays out clean, then round-trips when pinned`, async () => {
        const src = readCorpus(name);
        const parsed = parseBoxesAndLines(src);
        expect(parsed.error).toBeNull();
        expect(
          parsed.diagnostics.filter((d) => d.severity === 'error')
        ).toHaveLength(0);

        const auto = await layoutBoxesAndLines(parsed);
        // Build + re-parse a pinned variant; every node must round-trip exactly.
        // (Files with groups stay auto — assert the no-group corpus pins.)
        if (parsed.groups.length === 0) {
          const block =
            'layout\n' +
            auto.nodes
              .map(
                (n) => `  ${n.label}: ${Math.round(n.x)}, ${Math.round(n.y)}`
              )
              .join('\n');
          const pinned = await layoutBoxesAndLines(
            parseBoxesAndLines(`${src}\n${block}`)
          );
          for (const n of pinned.nodes) {
            const a = auto.nodes.find((x) => x.label === n.label)!;
            expect(n.x).toBe(Math.round(a.x));
            expect(n.y).toBe(Math.round(a.y));
          }
        }
      });
    }
  });
});
