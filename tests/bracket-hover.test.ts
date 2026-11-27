// Bracket hover: a match lights every path into it and its path to the final
// (diagrammo/diagrammo#2425). The baked CSS dims every `[data-lineage]` whose
// list lacks the hovered box's `data-match`; jsdom has no `:hover`, so these
// tests evaluate that same predicate over the rendered marks.
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseBracket } from '../src/bracket/parser';
import { layoutBracket, bracketLineage } from '../src/bracket/layout';
import { renderBracket } from '../src/bracket/renderer';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import type { LaidMatch } from '../src/bracket/layout';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const field = (n: number): string =>
  [
    `bracket Field ${n}`,
    ...Array.from({ length: n }, (_, i) => `seed ${i + 1} Team ${i + 1}`),
  ].join('\n');

const byId = (ms: readonly LaidMatch[]) => new Map(ms.map((m) => [m.id, m]));
const feedersOf = (ms: readonly LaidMatch[], ids: number[]): number[] => {
  const map = byId(ms);
  return ids.flatMap((id) => [...map.get(id)!.feeders]);
};
const pathToFinal = (ms: readonly LaidMatch[], id: number): number[] => {
  const out: number[] = [];
  for (
    let p = ms.find((m) => m.feeders.includes(id));
    p;
    p = ms.find((m) => m.feeders.includes(p!.id))
  )
    out.push(p.id);
  return out;
};

function renderSvg(src: string): SVGSVGElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 1200 });
  Object.defineProperty(c, 'clientHeight', { value: 800 });
  document.body.appendChild(c);
  renderBracket(c, parseBracket(src), getPalette('nord').light, false);
  return c.querySelector('svg')!;
}

/** Marks a hover on match `id` leaves lit (the CSS `~=` predicate). */
const lit = (svg: Element, sel: string, id: number): Element[] =>
  Array.from(svg.querySelectorAll(`${sel}[data-lineage]`)).filter((el) =>
    el.getAttribute('data-lineage')!.split(' ').includes(String(id))
  );

describe('bracket hover lineage (#2425)', () => {
  it('8 teams: the final lights its two feeders and their feeders — all 7', () => {
    const ms = layoutBracket(parseBracket(field(8))).matches;
    expect(ms).toHaveLength(7);
    const final = ms.find((m) => !pathToFinal(ms, m.id).length)!;
    const sf = [...final.feeders];
    const qf = feedersOf(ms, sf);
    expect(sf).toHaveLength(2);
    expect(qf).toHaveLength(4);
    const set = bracketLineage(ms).get(final.id)!;
    expect([...set].sort()).toEqual([final.id, ...sf, ...qf].sort());
  });

  it('8 teams: a semifinal lights its two feeders and the final, nothing else', () => {
    const ms = layoutBracket(parseBracket(field(8))).matches;
    const final = ms.find((m) => !pathToFinal(ms, m.id).length)!;
    const sf = final.feeders[0]!;
    const want = [sf, ...feedersOf(ms, [sf]), final.id];
    expect([...bracketLineage(ms).get(sf)!].sort()).toEqual(want.sort());
  });

  it('128 teams: a round-3 match lights 2 round-2 + 4 round-1 feeders and its path to the final', () => {
    const ms = layoutBracket(parseBracket(field(128))).matches;
    expect(ms).toHaveLength(127);
    const r3 = ms.find((m) => {
      const r2 = [...m.feeders];
      const r1 = feedersOf(ms, r2);
      return (
        r2.length === 2 && r1.length === 4 && feedersOf(ms, r1).length === 0
      );
    })!;
    const r2 = [...r3.feeders];
    const r1 = feedersOf(ms, r2);
    const down = pathToFinal(ms, r3.id);
    // 64 per half → rounds 3..6 of the half, then the centre final.
    expect(down).toHaveLength(4);
    expect(byId(ms).get(down.at(-1)!)!.isChampionship).toBe(true);
    const want = [r3.id, ...r2, ...r1, ...down].sort();
    expect([...bracketLineage(ms).get(r3.id)!].sort()).toEqual(want);

    // Rendered: both boxes of each lit match, and exactly the wires on the path.
    const svg = renderSvg(field(128));
    const boxes = lit(svg, '.dgmo-bracket-box', r3.id);
    expect(
      boxes.map((b) => Number(b.getAttribute('data-match'))).sort()
    ).toEqual(want.flatMap((id) => [id, id]).sort());
    // 6 wires inside the subtree + 4 from it to the final.
    expect(lit(svg, '.dgmo-bracket-wire', r3.id)).toHaveLength(10);
  });

  it('hovering the final lights the whole bracket, across both halves', () => {
    const svg = renderSvg(field(128));
    const ms = layoutBracket(parseBracket(field(128))).matches;
    const final = ms.find((m) => m.isChampionship)!;
    const all = svg.querySelectorAll('[data-lineage]');
    expect(lit(svg, '', final.id)).toHaveLength(all.length);
    expect(svg.querySelectorAll('.dgmo-bracket-wire')).toHaveLength(126);
  });

  it('render() bakes one dim rule per match, under :hover only', async () => {
    const { svg } = await render(field(128), { theme: 'light' });
    const rules = svg.match(
      /svg:has\(\.dgmo-bracket-box\[data-match="\d+"\]:hover\) \[data-lineage\]:not\(\[data-lineage~="\d+"\]\)\{opacity:0\.4\}/g
    );
    expect(rules).toHaveLength(127);
    expect(svg).not.toMatch(/exceeds cap/);
    // Nothing dims at rest: no inline opacity on a lineage mark.
    expect(svg).not.toMatch(/data-lineage="[^"]*"[^>]*opacity/);
  });
});
