import { describe, expect, it } from 'vitest';

import { parseJourneyMap } from '../src/journey-map/parser';
import { collapsedJourneyPhasesFromSource } from '../src/journey-map/collapse';
import { render } from '../src/render';
import {
  applyCollapsedMarkerAtLine,
  applyGroupHeaderCollapsedMarkerAtLine,
} from '../src/utils/collapse-marker';

// Source `collapsed` marker on a journey-map `[Phase]` header (#1741).

const src = (header: string): string =>
  `journey-map Trip\n\n${header}\n  Search score: 3\n  Compare score: 2\n[Book]\n  Pay score: 4`;
const SRC = src('[Discover]');
const PHASE_LINE = 3;

const discover = (text: string) =>
  parseJourneyMap(text).phases.find((p) => p.lineNumber === PHASE_LINE);

async function svgOf(
  text: string,
  viewState?: { cg?: string[] }
): Promise<string> {
  const { svg } = await render(text, {
    format: 'svg',
    ...(viewState && { viewState }),
  });
  return svg;
}
const bars = (svg: string): number =>
  (svg.match(/dgmo-collapse-bar/g) ?? []).length;

function toggles(svg: string): Element[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return [...doc.querySelectorAll('[data-group-toggle]')];
}

describe('journey-map phase collapsed marker — parsing', () => {
  it.each([
    ['[Discover] collapsed', true],
    ['[Discover] collapsed: true', true],
    ['[Discover] collapsed: false', false],
    ['[Discover]', false],
  ])('%s → collapsed %s', (header, folded) => {
    const p = discover(src(header));
    expect(p?.name).toBe('Discover');
    expect(p?.collapsed ?? false).toBe(folded);
  });

  it('capitalised `Collapsed` does not fold', () => {
    const p = discover(src('[Discover] Collapsed'));
    expect(p?.name).toBe('Discover');
    expect(p?.collapsed ?? false).toBe(false);
  });

  it('a phase named `collapsed` stays a name', () => {
    const p = discover(src('[collapsed]'));
    expect(p?.name).toBe('collapsed');
    expect(p?.collapsed ?? false).toBe(false);
  });

  it('adds no diagnostics for either form', () => {
    for (const h of ['[Discover] collapsed', '[Discover] collapsed: true'])
      expect(parseJourneyMap(src(h)).diagnostics).toEqual([]);
  });

  it('source helper unions markers with runtime names', () => {
    const parsed = parseJourneyMap(src('[Discover] collapsed'));
    expect([...collapsedJourneyPhasesFromSource(parsed)]).toEqual(['Discover']);
    expect(
      [...collapsedJourneyPhasesFromSource(parsed, ['Book'])].sort()
    ).toEqual(['Book', 'Discover']);
  });
});

describe('journey-map phase collapsed marker — static render', () => {
  it('folds by marker: one bar; none without it', async () => {
    expect(bars(await svgOf(src('[Discover] collapsed')))).toBe(1);
    expect(bars(await svgOf(src('[Discover] collapsed: true')))).toBe(1);
    expect(bars(await svgOf(SRC))).toBe(0);
  });

  it('folds from viewState.cg phase names too', async () => {
    expect(bars(await svgOf(SRC, { cg: ['Book'] }))).toBe(1);
    expect(
      bars(await svgOf(src('[Discover] collapsed'), { cg: ['Book'] }))
    ).toBe(2);
  });

  it('toggle markup on both states, pointing at the header line', async () => {
    for (const [text, expanded] of [
      [SRC, 'true'],
      [src('[Discover] collapsed'), 'false'],
    ] as const) {
      const t = toggles(await svgOf(text)).find(
        (e) => e.getAttribute('data-group-toggle') === 'Discover'
      )!;
      expect(t).toBeTruthy();
      expect(t.getAttribute('data-line-number')).toBe(String(PHASE_LINE));
      expect(t.getAttribute('aria-expanded')).toBe(expanded);
      expect(t.getAttribute('role')).toBe('button');
      expect(t.getAttribute('aria-label')).toBe('Discover');
      expect(t.hasAttribute('tabindex')).toBe(false);
    }
  });

  it('a phase with no steps carries no toggle', async () => {
    const svg = await svgOf('journey-map Trip\n\n[Empty]\n[Book]\n  Pay');
    expect(
      toggles(svg).map((e) => e.getAttribute('data-group-toggle'))
    ).toEqual(['Book']);
  });
});

describe('journey-map phase collapsed marker — helper round-trip', () => {
  it('group-header helper adds and removes the marker byte-identically', () => {
    const folded = applyGroupHeaderCollapsedMarkerAtLine(SRC, PHASE_LINE, true);
    expect(discover(folded)?.collapsed).toBe(true);
    const back = applyGroupHeaderCollapsedMarkerAtLine(
      folded,
      PHASE_LINE,
      false
    );
    expect(back).toBe(SRC);
    expect(discover(back)?.collapsed ?? false).toBe(false);
  });

  it('node helper with the header as label round-trips too', () => {
    const folded = applyCollapsedMarkerAtLine(
      SRC,
      PHASE_LINE,
      '[Discover]',
      true
    );
    expect(discover(folded)?.collapsed).toBe(true);
    expect(
      applyCollapsedMarkerAtLine(folded, PHASE_LINE, '[Discover]', false)
    ).toBe(SRC);
  });

  it('a header already carrying the bare flag: collapse is a no-op, expand strips it', () => {
    const bare = src('[Discover] collapsed');
    expect(applyGroupHeaderCollapsedMarkerAtLine(bare, PHASE_LINE, true)).toBe(
      bare
    );
    const back = applyGroupHeaderCollapsedMarkerAtLine(bare, PHASE_LINE, false);
    expect(back).toBe(SRC);
    expect(discover(back)?.collapsed ?? false).toBe(false);
  });
});
