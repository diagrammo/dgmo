import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseVisualization } from '../src/visualizations/parse';
import type { ParsedTimeline } from '../src/visualizations/types';
import {
  renderTimeline,
  collapsedTimelineGroupsFromSource,
} from '../src/timeline/renderer';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import { applyGroupHeaderCollapsedMarkerAtLine } from '../src/utils/collapse-marker';

const palette = getPalette('nord').light;
const svgOf = async (s: string) => (await render(s)).svg;

/** `[Alpha]` is line 3 of the source. */
const src = (header: string) =>
  `timeline\n\n${header}\n  2020 Kickoff\n  2021 Launch\n[Beta]\n  2020 Draft\n`;

const parse = (s: string) => parseVisualization(s, palette) as ParsedTimeline;
const alpha = (s: string) =>
  parse(s).timelineGroups.find((g) => g.name.startsWith('Alpha'))!;

/** Every `<g …>` opening tag carrying a group toggle. */
function toggles(svg: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of svg.matchAll(
    /<g\b([^>]*\bdata-group-toggle="[^"]*"[^>]*)>/g
  )) {
    const attrs: Record<string, string> = {};
    for (const a of m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    out.push(attrs);
  }
  return out;
}
const bars = (svg: string) => (svg.match(/dgmo-collapse-bar"/g) ?? []).length;

describe('timeline lane `collapsed` marker — parser', () => {
  it('bare flag', () => {
    const g = alpha(src('[Alpha] collapsed'));
    expect(g.name).toBe('Alpha');
    expect(g.collapsed).toBe(true);
    expect(g.metadata).toEqual({});
  });

  it('bare flag after a colour keeps the colour', () => {
    const plain = alpha(src('[Alpha] blue'));
    const g = alpha(src('[Alpha] blue collapsed'));
    expect(g.collapsed).toBe(true);
    expect(g.color).toBe(plain.color);
    expect(g.color).not.toBeNull();
  });

  it('bare flag after metadata', () => {
    const g = alpha(src('[Alpha] description: Core team, collapsed'));
    expect(g.collapsed).toBe(true);
    expect(g.metadata).toEqual({ description: 'Core team' });
  });

  it('`collapsed: true` metadata form, removed from metadata and events', () => {
    const p = parse(src('[Alpha] collapsed: true'));
    const g = p.timelineGroups.find((x) => x.name === 'Alpha')!;
    expect(g.collapsed).toBe(true);
    expect(g.metadata).toEqual({});
    for (const ev of p.timelineEvents.filter((e) => e.group === 'Alpha'))
      expect(ev.metadata['collapsed']).toBeUndefined();
  });

  it('`collapsed: false` does not fold and is not metadata', () => {
    const g = alpha(src('[Alpha] collapsed: false'));
    expect(g.collapsed).toBeUndefined();
    expect(g.metadata).toEqual({});
  });

  it('marker absent', () => {
    expect(alpha(src('[Alpha]')).collapsed).toBeUndefined();
  });

  it('capitalised `Collapsed` is not the marker', () => {
    const g = alpha(src('[Alpha] Collapsed'));
    expect(g.collapsed).toBeUndefined();
  });

  it('collapsedTimelineGroupsFromSource lists marked lanes', () => {
    expect([
      ...collapsedTimelineGroupsFromSource(parse(src('[Alpha] collapsed'))),
    ]).toEqual(['Alpha']);
    expect(collapsedTimelineGroupsFromSource(parse(src('[Alpha]'))).size).toBe(
      0
    );
  });
});

describe('timeline lane `collapsed` marker — static render', () => {
  it('folds by marker with one bar; none without', async () => {
    const folded = await svgOf(src('[Alpha] collapsed'));
    expect(bars(folded)).toBe(1);
    expect(folded).not.toContain('Kickoff');
    const open = await svgOf(src('[Alpha]'));
    expect(bars(open)).toBe(0);
    expect(open).toContain('Kickoff');
  });

  it('toggle markup on both states', async () => {
    for (const [header, expanded] of [
      ['[Alpha] collapsed', 'false'],
      ['[Alpha]', 'true'],
    ] as const) {
      const t = toggles(await svgOf(src(header)));
      const a = t.find((x) => x['data-group-toggle'] === 'Alpha')!;
      expect(a).toBeDefined();
      expect(a['data-line-number']).toBe('3');
      expect(a['aria-expanded']).toBe(expanded);
      expect(a['role']).toBe('button');
      expect(a['aria-label']).toBe('Alpha');
      expect(a['tabindex']).toBeUndefined();
      const b = t.find((x) => x['data-group-toggle'] === 'Beta')!;
      expect(b['data-line-number']).toBe('6');
      expect(b['aria-expanded']).toBe('true');
    }
  });

  it('tag lanes (no `[Lane]` header line) get no toggle markup', async () => {
    const t = toggles(
      await svgOf(
        'timeline\nsort tag:Team\n\ntag Team as t\n  Eng blue\n  Ops green\n\n2020 A t: Eng\n2021 B t: Ops\n'
      )
    );
    expect(t).toEqual([]);
  });

  it('an empty lane gets no toggle markup', async () => {
    const t = toggles(
      await svgOf('timeline\n\n[Alpha]\n  2020 Kickoff\n[Empty]\n')
    );
    expect(t.map((x) => x['data-group-toggle'])).toEqual(['Alpha']);
  });
});

describe('timeline lane `collapsed` marker — interactive render', () => {
  const win = new JSDOM('<!doctype html><body></body>').window;
  const mount = () => {
    const c = win.document.createElement('div') as unknown as HTMLDivElement;
    win.document.body.appendChild(c as unknown as Node);
    return c;
  };
  const draw = (c: HTMLDivElement, s: string) =>
    renderTimeline(c, parse(s), palette, false, undefined, {
      width: 1200,
      height: 600,
    });
  const barCount = (c: HTMLDivElement) =>
    c.querySelectorAll('.dgmo-collapse-bar').length;

  it('a marker seeds the fold, a click still expands, source edits apply', () => {
    const c = mount();
    draw(c, src('[Alpha] collapsed'));
    expect(barCount(c)).toBe(1);
    c.querySelector('[data-group-toggle="Alpha"]')!.dispatchEvent(
      new win.Event('click')
    );
    expect(barCount(c)).toBe(0);
    // Unchanged source re-render keeps the clicked (expanded) state.
    draw(c, src('[Alpha] collapsed'));
    expect(barCount(c)).toBe(0);
    // Removing then re-adding the marker folds it again.
    draw(c, src('[Alpha]'));
    expect(barCount(c)).toBe(0);
    draw(c, src('[Alpha] collapsed'));
    expect(barCount(c)).toBe(1);
    // Removing the marker unfolds it.
    draw(c, src('[Alpha]'));
    expect(barCount(c)).toBe(0);
  });
});

describe('timeline lane `collapsed` marker — source round-trip', () => {
  for (const header of [
    '[Alpha]',
    '[Alpha] blue',
    '[Alpha] description: Core team',
  ]) {
    it(`adds and removes the marker on \`${header}\``, async () => {
      const original = src(header);
      const line = Number(
        toggles(await svgOf(original)).find(
          (x) => x['data-group-toggle'] === 'Alpha'
        )!['data-line-number']
      );
      const folded = applyGroupHeaderCollapsedMarkerAtLine(
        original,
        line,
        true
      );
      expect(alpha(folded).collapsed).toBe(true);
      expect(alpha(folded).name).toBe('Alpha');
      const back = applyGroupHeaderCollapsedMarkerAtLine(folded, line, false);
      expect(alpha(back).collapsed).toBeUndefined();
      expect(back).toBe(original);
    });
  }

  it('removes a bare flag', () => {
    const s = src('[Alpha] blue collapsed');
    const back = applyGroupHeaderCollapsedMarkerAtLine(s, 3, false);
    expect(alpha(back).collapsed).toBeUndefined();
  });
});
