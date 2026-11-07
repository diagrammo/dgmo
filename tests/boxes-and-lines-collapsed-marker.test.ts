// boxes-and-lines `[Group]` source `collapsed` marker (#1741): parser forms,
// static render fold, toggle markup, and the source-edit helper round trip.
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import {
  collapsedBLGroupsFromSource,
  unionCollapsedBLGroups,
} from '../src/boxes-and-lines/collapse';
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
  `boxes-and-lines Sys\n\n${header}\n  A\n  B\nA -> B\nC -> A`;
const HEADER_LINE = 3;

function group(header: string) {
  const parsed = parseBoxesAndLines(doc(header));
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

describe('boxes-and-lines group collapsed marker — parser', () => {
  it.each([
    ['[Core] collapsed', true],
    ['[Core] color: blue collapsed', true],
    ['[Core] color: blue, collapsed', true],
    ['[Core] collapsed: true', true],
    ['[Core] color: blue, collapsed: true', true],
    ['[Core] collapsed: false', false],
    ['[Core]', false],
    ['[Core] color: blue', false],
  ])('%s → collapsed %s', (header, folded) => {
    const g = group(header);
    expect(g.label).toBe('Core');
    expect(g.collapsed === true).toBe(folded);
    expect(g.metadata['collapsed']).toBeUndefined();
  });

  it('keeps the other metadata beside the marker', () => {
    expect(group('[Core] color: blue, collapsed').metadata['color']).toBe(
      'blue'
    );
    expect(group('[Core] color: blue collapsed').metadata['color']).toBe(
      'blue'
    );
  });

  it('capitalised `Collapsed` is not the flag; a name containing it is kept', () => {
    expect(group('[Core] Collapsed').collapsed).toBeUndefined();
    const g = group('[Core collapsed]');
    expect(g.label).toBe('Core collapsed');
    expect(g.collapsed).toBeUndefined();
  });

  it('the marker does not cascade to members as metadata', () => {
    const parsed = parseBoxesAndLines(doc('[Core] collapsed: true'));
    for (const n of parsed.nodes)
      expect(n.metadata['collapsed']).toBeUndefined();
  });

  it('source helpers', () => {
    const parsed = parseBoxesAndLines(doc('[Core] collapsed'));
    expect([...collapsedBLGroupsFromSource(parsed)]).toEqual(['Core']);
    expect([...unionCollapsedBLGroups(parsed, ['Other'])].sort()).toEqual([
      'Core',
      'Other',
    ]);
  });
});

describe('boxes-and-lines group collapsed marker — static render', () => {
  it('folds by marker with exactly one bar; none without', async () => {
    const folded = await staticSvg(doc('[Core] collapsed'));
    expect(folded.querySelectorAll('.dgmo-collapse-bar').length).toBe(1);
    expect(folded.querySelector('.bl-group-collapsed')).not.toBeNull();
    const open = await staticSvg(doc('[Core]'));
    expect(open.querySelectorAll('.dgmo-collapse-bar').length).toBe(0);
    expect(open.querySelector('.bl-group-collapsed')).toBeNull();
  });

  it('unions runtime viewState.cg with the source marker', async () => {
    const svg = await staticSvg(doc('[Core]'), ['Core']);
    expect(svg.querySelectorAll('.dgmo-collapse-bar').length).toBe(1);
  });

  it('toggle markup on both states', async () => {
    for (const [header, expanded] of [
      ['[Core]', 'true'],
      ['[Core] collapsed', 'false'],
    ] as const) {
      const svg = await staticSvg(doc(header));
      const t = svg.querySelector('[data-group-toggle="Core"]')!;
      expect(t, header).not.toBeNull();
      expect(t.getAttribute('data-line-number')).toBe(String(HEADER_LINE));
      expect(t.getAttribute('role')).toBe('button');
      expect(t.getAttribute('aria-expanded')).toBe(expanded);
      expect(t.getAttribute('aria-label')).toBe('Core');
      expect(t.hasAttribute('tabindex')).toBe(false);
      // Hit area = the whole frame / pill: the toggle wraps its rect.
      expect(t.querySelector('rect')).not.toBeNull();
    }
  });
});

describe('boxes-and-lines group collapsed marker — source round trip', () => {
  it.each(['[Core]', '[Core] color: blue', '[Core] collapsed'])(
    '%s',
    async (header) => {
      const original = doc(header);
      const svg = await staticSvg(original);
      const line = Number(
        svg
          .querySelector('[data-group-toggle="Core"]')!
          .getAttribute('data-line-number')
      );
      const folded = applyGroupHeaderCollapsedMarkerAtLine(
        original,
        line,
        true
      );
      expect(
        parseBoxesAndLines(folded).groups.find((g) => g.label === 'Core')!
          .collapsed
      ).toBe(true);
      const unfolded = applyGroupHeaderCollapsedMarkerAtLine(
        folded,
        line,
        false
      );
      const g = parseBoxesAndLines(unfolded).groups.find(
        (x) => x.label === 'Core'
      )!;
      expect(g.collapsed).toBeUndefined();
      if (header !== '[Core] collapsed') expect(unfolded).toBe(original);
      else expect(unfolded).toBe(doc('[Core]'));
    }
  );
});
