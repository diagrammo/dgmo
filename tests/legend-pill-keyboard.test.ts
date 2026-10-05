// A legend's tag-group pills are buttons a keyboard can reach (#1060). They
// used to take only a click, so a keyboard user could never switch the active
// group — nor reach the swimlane ("Group by") icon, drawn on the active pill
// only.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { select } from 'd3-selection';
import { getPalette } from '../src/palettes';
import { renderLegendD3 } from '../src/utils/legend-d3';
import type { LegendConfig } from '../src/utils/legend-types';
import { parseVisualization, renderTimeline } from '../src/d3';
import { render } from '../src/render';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
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

const legendPalette = {
  bg: '#ffffff',
  surface: '#f0f0f0',
  text: '#333333',
  textMuted: '#888888',
};

const config = (
  mode: LegendConfig['mode'],
  extra: Partial<LegendConfig> = {}
): LegendConfig => ({
  groups: [
    { name: 'Priority', entries: [{ value: 'High', color: '#e53e3e' }] },
    { name: 'Status', entries: [{ value: 'Done', color: '#718096' }] },
  ],
  position: { placement: 'top-center', titleRelation: 'below-title' },
  mode,
  ...extra,
});

function legendHost(): { div: HTMLDivElement; g: SVGGElement } {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const svg = select(div).append('svg').attr('width', 800).attr('height', 100);
  return { div, g: svg.append('g').node()! };
}

function press(el: Element, key: string): void {
  el.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    })
  );
}

function pill(root: ParentNode, group: string): SVGElement | null {
  return root.querySelector<SVGElement>(
    `[role="button"][aria-label="${group}"]`
  );
}

describe('legend pills are keyboard buttons (#1060)', () => {
  it('every pill is focusable; only the active one is pressed', () => {
    const { g } = legendHost();
    renderLegendD3(
      select(g),
      config('preview', { showInactivePills: true }),
      { activeGroup: 'Status' },
      legendPalette,
      false,
      { onGroupToggle: () => {} }
    );
    for (const [group, pressed] of [
      ['Priority', 'false'],
      ['Status', 'true'],
    ]) {
      const el = pill(g, group);
      expect(el).not.toBeNull();
      expect(el!.getAttribute('tabindex')).toBe('0');
      expect(el!.getAttribute('aria-pressed')).toBe(pressed);
    }
  });

  it('Enter and Space toggle the group; other keys do not', () => {
    const { g } = legendHost();
    const onGroupToggle = vi.fn();
    renderLegendD3(
      select(g),
      config('preview'),
      { activeGroup: null },
      legendPalette,
      false,
      { onGroupToggle }
    );
    const el = pill(g, 'Priority')!;
    press(el, 'Enter');
    press(el, ' ');
    press(el, 'a');
    expect(onGroupToggle.mock.calls).toEqual([['Priority'], ['Priority']]);
  });

  // Most charts toggle groups in the app, by a click listener looking for
  // `[data-legend-group]`, and pass dgmo no callback at all.
  it('reaches an app click listener when no callback is passed', () => {
    const { div, g } = legendHost();
    renderLegendD3(
      select(g),
      config('preview'),
      { activeGroup: null },
      legendPalette,
      false
    );
    const seen: (string | null)[] = [];
    div.addEventListener('click', (e) => {
      seen.push(
        (e.target as Element)
          .closest('[data-legend-group]')
          ?.getAttribute('data-legend-group') ?? null
      );
    });
    press(pill(g, 'Status')!, 'Enter');
    expect(seen).toEqual(['status']);
  });

  it('an export stays inert', () => {
    const { g } = legendHost();
    renderLegendD3(
      select(g),
      config('export'),
      { activeGroup: 'Status' },
      legendPalette,
      false,
      { onGroupToggle: () => {} }
    );
    expect(g.querySelector('[tabindex], [role="button"]')).toBeNull();
  });
});

// Most charts are redrawn by the APP: its click listener sets state and a
// React render replaces the svg after the key handler has returned. Focus must
// still land back on the pill, now pressed.
describe('a pill keeps focus across an app redraw (#1060)', () => {
  function appHost() {
    const div = document.createElement('div');
    document.body.appendChild(div);
    let active: string | null = null;
    const draw = () => {
      div.innerHTML = '';
      const g = select(div)
        .append('svg')
        .attr('width', 800)
        .attr('height', 100)
        .append('g');
      renderLegendD3(
        g,
        config('preview'),
        { activeGroup: active },
        legendPalette,
        false
      );
    };
    div.addEventListener('click', (e) => {
      const name = (e.target as Element)
        .closest('[data-legend-group]')
        ?.getAttribute('data-legend-group');
      if (!name) return;
      active = active === name ? null : name;
      queueMicrotask(draw);
    });
    draw();
    return { div, draw };
  }

  it('restores focus after a later redraw', async () => {
    const { div } = appHost();
    const status = pill(div, 'Status')!;
    status.focus();
    press(status, 'Enter');
    await Promise.resolve();
    const after = document.activeElement!;
    expect(status.isConnected).toBe(false);
    expect(after.getAttribute('aria-label')).toBe('Status');
    expect(after.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not take focus from where the user moved it', async () => {
    const { div } = appHost();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    const status = pill(div, 'Status')!;
    status.focus();
    press(status, 'Enter');
    elsewhere.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(elsewhere);
  });
});

const TIMELINE = `timeline

tag Status
  Done green
  Active blue

tag Owner
  Ana red
  Bo purple

2024-01-01 -> 2024-06-01: Feature A | status: Done, owner: Ana
2024-03-01 -> 2024-12-01: Feature B | status: Active, owner: Bo`;

// The case the issue names: from the keyboard alone, switch the active group
// and reach the swimlane icon that only the active pill carries. While a group
// is active the others are hidden, so the path is Enter on the active pill to
// clear it, then Enter on another — focus must survive both redraws.
describe('a keyboard user reaches another group and its swimlane icon (#1060)', () => {
  it('timeline', () => {
    const palette = getPalette('nord').light;
    const c = document.createElement('div');
    Object.defineProperty(c, 'clientWidth', { value: 800 });
    Object.defineProperty(c, 'clientHeight', { value: 500 });
    document.body.appendChild(c);
    renderTimeline(
      c,
      parseVisualization(TIMELINE, palette),
      palette,
      false,
      undefined,
      undefined,
      'Status',
      undefined,
      () => {}
    );
    expect(
      c.querySelector('.tl-swimlane-icon[aria-label="Group by Owner"]')
    ).toBeNull();

    const status = pill(c, 'Status')!;
    expect(status.getAttribute('aria-pressed')).toBe('true');
    status.focus();
    press(status, 'Enter');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Status');
    expect(document.activeElement?.getAttribute('aria-pressed')).toBe('false');

    const owner = pill(c, 'Owner')!;
    expect(owner.getAttribute('aria-pressed')).toBe('false');
    owner.focus();
    press(owner, 'Enter');

    // Focus survives the legend redraw, on the same group, now pressed.
    const after = document.activeElement!;
    expect(owner.isConnected).toBe(false);
    expect(after.getAttribute('aria-label')).toBe('Owner');
    expect(after.getAttribute('aria-pressed')).toBe('true');
    const icon = c.querySelector(
      '.tl-swimlane-icon[aria-label="Group by Owner"]'
    );
    expect(icon?.getAttribute('tabindex')).toBe('0');
  });
});

// Shipped bytes are static — a CLI file, a docs embed, an export — and lose
// the key handler, so a pill there must not announce itself as a button.
describe('static output carries no pill buttons (#1060)', () => {
  it('render()', async () => {
    const { svg } = await render(
      TIMELINE.replace('timeline', 'timeline\nactive-tag Status'),
      {
        theme: 'light',
      }
    );
    expect(svg).toContain('data-legend-group="status"');
    expect(svg).not.toContain('dgmo-legend-pill-toggle');
    expect(svg).not.toMatch(
      /data-legend-group="status"[^>]*>\s*<rect[^>]*(role|tabindex)=/
    );
  });
});
