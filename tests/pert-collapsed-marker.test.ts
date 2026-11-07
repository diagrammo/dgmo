// pert `[Group]` source `collapsed` marker (#1741): parser forms, static
// render fold, toggle markup, and the source-edit helper round trip.
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import { parsePert } from '../src/pert/parser';
import {
  collapsedPertGroupIdsFromSource,
  unionCollapsedPertGroups,
} from '../src/pert/export';
import { applyGroupHeaderCollapsedMarkerAtLine } from '../src/utils/collapse-marker';

let win: JSDOM['window'];
beforeAll(() => {
  win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;
  for (const key of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? win : win[key],
      configurable: true,
    });
  }
});

const doc = (header: string): string =>
  'pert Voyage\ntime-unit w\n' +
  'tag Crew as c\n  Captain red\n  Bosun orange\n\n' +
  `${header}\n  recruit crew 1 2 4\n    -> load powder\n  load powder 0.5 1 2\n` +
  '\nsail 3 5 8';
const HEADER_LINE = 7;
const ID = '[outfit]';

function group(header: string) {
  const parsed = parsePert(doc(header));
  expect(parsed.error).toBeNull();
  return parsed.groups.find((g) => g.lineNumber === HEADER_LINE)!;
}

async function staticSvg(src: string, cg?: string[]): Promise<Document> {
  const { svg } = await render(src, {
    theme: 'light',
    palette: 'nord',
    ...(cg && { viewState: { cg } }),
  });
  expect(svg).not.toBe('');
  return new win.DOMParser().parseFromString(svg, 'image/svg+xml');
}

describe('pert group collapsed marker — parser', () => {
  it.each([
    ['[outfit] collapsed', true],
    ['[outfit] c: Bosun collapsed', true],
    ['[outfit] c: Bosun, collapsed', true],
    ['[outfit] collapsed: true', true],
    ['[outfit] c: Bosun, collapsed: true', true],
    ['[outfit] collapsed: false', false],
    ['[outfit]', false],
    ['[outfit] c: Bosun', false],
  ])('%s → collapsed %s', (header, folded) => {
    const g = group(header);
    expect(g.id).toBe(ID);
    expect(g.collapsed).toBe(folded);
    expect(g.tags?.['collapsed']).toBeUndefined();
  });

  it('keeps the tag beside the marker', () => {
    expect(group('[outfit] c: Bosun, collapsed').tags).toEqual({
      crew: 'Bosun',
    });
  });

  it('capitalised `Collapsed` is not the flag; a name containing it is kept', () => {
    expect(group('[outfit] Collapsed').collapsed).toBe(false);
    const g = group('[outfit collapsed]');
    expect(g.name).toBe('outfit collapsed');
    expect(g.collapsed).toBe(false);
  });

  it('source helpers', () => {
    const parsed = parsePert(doc('[outfit] collapsed'));
    expect([...collapsedPertGroupIdsFromSource(parsed)]).toEqual([ID]);
    expect([...unionCollapsedPertGroups(parsed, ['[x]'])].sort()).toEqual([
      ID,
      '[x]',
    ]);
  });
});

describe('pert group collapsed marker — static render', () => {
  it('folds by marker with exactly one bar; none without', async () => {
    const folded = await staticSvg(doc('[outfit] collapsed'));
    expect(folded.querySelectorAll('.dgmo-collapse-bar').length).toBe(1);
    expect(folded.querySelector('.pert-group-collapsed')).not.toBeNull();
    const open = await staticSvg(doc('[outfit]'));
    expect(open.querySelectorAll('.dgmo-collapse-bar').length).toBe(0);
    expect(open.querySelector('.pert-group-collapsed')).toBeNull();
  });

  it('unions runtime viewState.cg with the source marker', async () => {
    const svg = await staticSvg(doc('[outfit]'), [ID]);
    expect(svg.querySelectorAll('.dgmo-collapse-bar').length).toBe(1);
  });

  it('toggle markup on both states', async () => {
    for (const [header, expanded] of [
      ['[outfit]', 'true'],
      ['[outfit] collapsed', 'false'],
    ] as const) {
      const svg = await staticSvg(doc(header));
      const t = svg.querySelector(`[data-group-toggle="${ID}"]`)!;
      expect(t, header).not.toBeNull();
      expect(t.getAttribute('data-line-number')).toBe(String(HEADER_LINE));
      expect(t.getAttribute('role')).toBe('button');
      expect(t.getAttribute('aria-expanded')).toBe(expanded);
      expect(t.getAttribute('aria-label')).toBe('outfit');
      expect(t.hasAttribute('tabindex')).toBe(false);
    }
  });
});

describe('pert group collapsed marker — source round trip', () => {
  it.each(['[outfit]', '[outfit] c: Bosun', '[outfit] collapsed'])(
    '%s',
    async (header) => {
      const original = doc(header);
      const svg = await staticSvg(original);
      const line = Number(
        svg
          .querySelector(`[data-group-toggle="${ID}"]`)!
          .getAttribute('data-line-number')
      );
      const folded = applyGroupHeaderCollapsedMarkerAtLine(
        original,
        line,
        true
      );
      expect(parsePert(folded).groups.find((g) => g.id === ID)!.collapsed).toBe(
        true
      );
      const unfolded = applyGroupHeaderCollapsedMarkerAtLine(
        folded,
        line,
        false
      );
      expect(
        parsePert(unfolded).groups.find((g) => g.id === ID)!.collapsed
      ).toBe(false);
      expect(unfolded).toBe(
        header === '[outfit] collapsed' ? doc('[outfit]') : original
      );
    }
  );
});
