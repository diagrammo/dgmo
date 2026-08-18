// Collapsed-column tag chips — issue #266 (the collapsed kanban column).
//
// A collapsed column used to draw a bold total and a rotated name and nothing
// else, so the active tag's colours vanished exactly when the reader had least
// information. These guard the three things the design turns on: what is drawn,
// the order it is drawn in, and the ALIGNMENT — every collapsed column starts
// its stack at one shared y, set by the longest collapsed column name, so two
// columns can be compared by eye.

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseKanban } from '../src/kanban/parser';
import { renderKanban } from '../src/kanban/renderer';
import { getPalette } from '../src/palettes';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  const globals: [string, unknown][] = [
    ['document', win.document],
    ['window', win],
    ['navigator', win.navigator],
    ['HTMLElement', win.HTMLElement],
    ['SVGElement', win.SVGElement],
  ];
  for (const [key, value] of globals) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

/** Renders and returns the SVG markup, with `active-tag` supplied as d3.ts does. */
function draw(src: string, activeTagGroup: string | null = 'Who'): string {
  const el = document.createElement('div');
  renderKanban(el, parseKanban(src), getPalette('slate')!.light, false, {
    ...(activeTagGroup !== null && { activeTagGroup }),
  });
  return el.innerHTML;
}

const chipValues = (svg: string): string[] =>
  [...svg.matchAll(/data-tag-value="([^"]*)"/g)].map((m) => m[1]!);
const chipYs = (svg: string): number[] =>
  [
    ...svg.matchAll(
      /class="kanban-collapsed-chip"[^]*?<rect [^>]*?y="([\d.]+)"/g
    ),
  ].map((m) => Number(m[1]));
const chipLabels = (svg: string): string[] =>
  [
    ...svg.matchAll(
      /class="kanban-collapsed-chip"[^]*?<text[^>]*>([^<]*)<\/text>/g
    ),
  ].map((m) => m[1]!);

// Mirrors the console's issue board: the stages are columns, and who-can-act
// rides on the card, so one collapsed column is genuinely mixed.
const BOARD = `kanban
tag Who
  Agent green
  Human blue
  Maintainer yellow
active-tag Who

[Needs triage] collapsed: true
  Alpha Who: Maintainer
  Beta Who: Maintainer
  Gamma Who: Maintainer

[Needs info] collapsed: true
  Delta Who: Maintainer

[Ready] collapsed: true
  E1 Who: Human
  E2 Who: Human
  E3 Who: Human
  E4 Who: Human
  E5 Who: Agent

[In progress]
  Live one Who: Agent
`;

describe('collapsed column tag chips', () => {
  it('draws one chip per value present, carrying that value count', () => {
    const svg = draw(BOARD);
    expect(chipValues(svg)).toEqual([
      'Maintainer', // Needs triage
      'Maintainer', // Needs info
      'Human', // Ready, biggest first
      'Agent',
    ]);
    expect(chipLabels(svg)).toEqual(['3', '1', '4', '1']);
  });

  it('orders a mixed column by count, biggest first', () => {
    const svg = draw(BOARD);
    const ready = chipValues(svg).slice(2);
    expect(ready).toEqual(['Human', 'Agent']); // 4 then 1
  });

  it('breaks a tie on legend order, not on insertion order', () => {
    // Human appears FIRST on the cards, Agent first in the legend. Equal counts,
    // so the legend has to decide — otherwise two columns with the same mix
    // could stack their chips differently and stop being comparable.
    const tied = `kanban
tag Who
  Agent green
  Human blue
active-tag Who

[Ready] collapsed: true
  A1 Who: Human
  A2 Who: Agent

[Doing]
  B1 Who: Agent
`;
    expect(chipValues(draw(tied))).toEqual(['Agent', 'Human']);
  });

  it('starts every collapsed column at ONE shared y', () => {
    const ys = chipYs(draw(BOARD));
    // Three collapsed columns; Ready carries a second chip below its first.
    const firsts = [ys[0]!, ys[1]!, ys[2]!];
    expect(new Set(firsts).size).toBe(1);
    expect(ys[3]!).toBeGreaterThan(ys[2]!);
  });

  it('puts the chips BELOW the rotated name, clearing the longest one', () => {
    const svg = draw(BOARD);
    const firstChipY = chipYs(svg)[0]!;
    // The rotated names all start at the same y; the longest reaches furthest
    // down, and the chips must clear it. "Needs triage" is the longest here.
    const nameY = Number(
      /<text [^>]*writing-mode="tb"[^>]*y="([\d.]+)"/.exec(svg)?.[1] ??
        /y="([\d.]+)"[^>]*writing-mode="tb"/.exec(svg)?.[1]
    );
    expect(firstChipY).toBeGreaterThan(nameY);
  });

  it('grows the shared column height so the stack is never clipped away', () => {
    // A board whose expanded column holds one card is SHORTER than a rotated
    // name plus a chip. Before the layout accounted for it the chips fell
    // outside the well and were silently dropped.
    const svg = draw(BOARD);
    const wellHeight = Number(
      /<rect [^>]*width="40"[^>]*height="([\d.]+)"/.exec(svg)?.[1]
    );
    const ys = chipYs(svg);
    expect(ys.length).toBe(4);
    expect(Math.max(...ys)).toBeLessThan(wellHeight);
  });

  it('draws nothing new when no tag group is active', () => {
    const svg = draw(BOARD, null);
    expect(chipValues(svg)).toEqual([]);
    expect(svg).toContain('Needs triage'); // still the name and the total
  });

  it('ends the stack in a +N mark rather than a truncated one', () => {
    const many = `kanban
tag Who
  A green
  B blue
  C yellow
  D red
  E purple
  F teal
active-tag Who

[Ready] collapsed: true
  C1 Who: A
  C2 Who: B
  C3 Who: C
  C4 Who: D
  C5 Who: E
  C6 Who: F

[Doing]
  D1 Who: A
`;
    const labels = chipLabels(draw(many));
    expect(labels.length).toBeLessThan(6);
    expect(labels.at(-1)).toMatch(/^\+\d+$/);
  });
});
