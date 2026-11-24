// Sibling frames share an edge (#2062, rubric rule 7): a top-level frame that
// lines up with no other is moved across the flow until a side meets one.
import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { checkLayout } from './stress/bl-rubric';

// Two frames, a box chain between them; dagre lined neither frame up with
// the other (rule 7 counted 2 before the pass).
const SRC = `boxes-and-lines Harbour Traffic Desk

tag Status as s
  NA gray
  to-do red
  doing yellow
  done green

active-tag Status

[Dockside01]
  CraneControlDesk s:to-do
    -> Cargoes s:to-do
  HarbourCranes
  Cargoes
  -> PIR
  -> QUAYS

PIR
  -> HB

QUAYS
  -> HB

HB
  -> OutboundRelay

OutboundRelay
  -> ShippingLanesXY

[Seaport]
  Quayside
  OutboundRelay`;

describe('alignSiblingFrames', () => {
  it('lines every top-level frame up with another, and breaks no other rule', async () => {
    const p = parseBoxesAndLines(SRC);
    const L = await layoutBoxesAndLines(p);
    const f = checkLayout(L, p.groups, p.direction);
    expect(f.get(7)).toEqual([]);
    for (const r of [1, 2, 3, 5, 6] as const) expect(f.get(r)).toEqual([]);
  }, 120_000);

  it('moves a frame rigidly: every box keeps its place inside its frame', async () => {
    const p = parseBoxesAndLines(SRC);
    const L = await layoutBoxesAndLines(p);
    for (const g of p.groups) {
      const fr = L.groups.find((x) => x.label === g.label)!;
      for (const c of g.children) {
        const n = L.nodes.find((x) => x.label === c)!;
        expect(Math.abs(n.x - fr.x) + n.width / 2).toBeLessThanOrEqual(
          fr.width / 2 + 0.5
        );
        expect(Math.abs(n.y - fr.y) + n.height / 2).toBeLessThanOrEqual(
          fr.height / 2 + 0.5
        );
      }
    }
  }, 120_000);
});
