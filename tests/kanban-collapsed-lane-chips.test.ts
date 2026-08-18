// Collapsed-lane tag chips — issue #278 (the collapsed kanban swimlane).
//
// The collapsed COLUMN got these on 2026-08-17 (#266); a collapsed lane still
// drew its name, its total and a per-column count, and nothing about the KIND
// of work behind it. A lane is a 26px horizontal band, so the column's vertical
// stack becomes a horizontal RIBBON in the lane header — which is why the two
// things these guard are the ordering (shared with the column) and the
// GEOMETRY: one shared start x for every lane, and a header that GROWS to hold
// the ribbon instead of clipping it off its own right edge.

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

/**
 * Renders a swimlane board with the named lanes collapsed. `lane-by` is read by
 * `render()` rather than by the renderer, so the group is supplied the way the
 * app supplies it — as an option.
 */
function draw(
  src: string,
  collapsed: string[],
  activeTagGroup: string | null = 'Who',
  laneGroup = 'Team'
): string {
  const el = document.createElement('div');
  renderKanban(el, parseKanban(src), getPalette('slate')!.light, false, {
    currentSwimlaneGroup: laneGroup,
    collapsedLanes: new Set(collapsed),
    ...(activeTagGroup !== null && { activeTagGroup }),
  });
  return el.innerHTML;
}

const chipValues = (svg: string): string[] =>
  [...svg.matchAll(/data-tag-value="([^"]*)"/g)].map((m) => m[1]!);
const chipLabels = (svg: string): string[] =>
  [
    ...svg.matchAll(
      /class="kanban-collapsed-chip"[^]*?<text[^>]*>([^<]*)<\/text>/g
    ),
  ].map((m) => m[1]!);
const chipXs = (svg: string): number[] =>
  [
    ...svg.matchAll(
      /class="kanban-collapsed-chip"[^]*?<rect [^>]*?x="([\d.]+)"/g
    ),
  ].map((m) => Number(m[1]));
/** The x of the first chip in each lane's ribbon — the shared axis. */
const ribbonStarts = (svg: string): number[] =>
  svg
    .split('class="kanban-lane"')
    .slice(1)
    .map((lane) => chipXs(lane)[0])
    .filter((x): x is number => x !== undefined);

// Two lanes with deliberately different name lengths, so a ribbon starting
// under its own name would visibly stagger.
const BOARD = `kanban
tag Who
  Agent green
  Human blue
  Maintainer yellow
tag Team
  Platform red
  Docs cyan
active-tag Who

[Ready]
  One Who: Human, Team: Platform
  Two Who: Human, Team: Platform
  Three Who: Agent, Team: Platform
  Four Who: Maintainer, Team: Docs

[In progress]
  Five Who: Human, Team: Platform
  Six Who: Agent, Team: Docs`;

describe('collapsed lane tag chips', () => {
  it('draws one chip per value in the lane, ordered by count then legend', () => {
    const svg = draw(BOARD, ['Platform']);
    // Platform holds 3 Human and 1 Agent across both columns.
    expect(chipValues(svg)).toEqual(['Human', 'Agent']);
    expect(chipLabels(svg)).toEqual(['3', '1']);
  });

  it('counts only the lane it belongs to', () => {
    const svg = draw(BOARD, ['Docs']);
    // Docs holds 1 Maintainer and 1 Agent — an even split, so the legend
    // ordering decides: Agent is declared before Maintainer.
    expect(chipValues(svg)).toEqual(['Agent', 'Maintainer']);
    expect(chipLabels(svg)).toEqual(['1', '1']);
  });

  it('starts every lane ribbon at one shared x', () => {
    const svg = draw(BOARD, ['Platform', 'Docs']);
    const starts = ribbonStarts(svg);
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBe(starts[1]);
  });

  it('grows the lane header so the ribbon clears the first column', () => {
    const svg = draw(BOARD, ['Platform', 'Docs']);
    // Every chip ends left of the first column's cards — the column x is where
    // the board proper begins, and a header that did not grow would push the
    // ribbon over it or off its own right edge.
    const firstColumnX = Math.min(
      ...[
        ...svg.matchAll(
          /class="kanban-column[^"]*"[^]*?<rect [^>]*?x="([\d.]+)"/g
        ),
      ].map((m) => Number(m[1]))
    );
    const chipRights = [
      ...svg.matchAll(
        /class="kanban-collapsed-chip"[^]*?<rect [^>]*?x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g
      ),
    ].map((m) => Number(m[1]) + Number(m[2]));
    expect(chipRights.length).toBeGreaterThan(0);
    for (const right of chipRights)
      expect(right).toBeLessThanOrEqual(firstColumnX);
  });

  it('ends the ribbon in a +N mark rather than reading as complete', () => {
    const wide = `kanban
tag Who
  A green
  B blue
  C yellow
  D red
  E cyan
tag Team
  Platform red
active-tag Who

[Ready]
  One Who: A, Team: Platform
  Two Who: B, Team: Platform
  Three Who: C, Team: Platform
  Four Who: D, Team: Platform
  Five Who: E, Team: Platform`;
    const svg = draw(wide, ['Platform']);
    // Four slots: three values plus the overflow mark for the other two.
    expect(chipLabels(svg)).toEqual(['1', '1', '1', '+2']);
    expect(chipValues(svg)[3]).toBe('2 more');
  });

  it('draws nothing extra when no tag group is active', () => {
    const svg = draw(BOARD, ['Platform'], null);
    expect(chipValues(svg)).toEqual([]);
    expect(svg).toContain('Platform (4)');
  });

  it('draws no chips when the active group IS the lane group', () => {
    // Every card in the lane carries that lane's value, so the chips would say
    // only what the lane's own name and count already say.
    const svg = draw(BOARD, ['Platform'], 'Team');
    expect(chipValues(svg)).toEqual([]);
  });

  it('draws no chips for an expanded lane', () => {
    const svg = draw(BOARD, []);
    expect(chipValues(svg)).toEqual([]);
  });
});
