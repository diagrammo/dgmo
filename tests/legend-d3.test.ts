/**
 * Tests for the centralized D3 legend renderer (legend-d3.ts).
 *
 * Ensures:
 * 1. Renders pills with correct data attributes
 * 2. Active group shows capsule + entries
 * 3. Controls render with outline style
 * 4. setState updates DOM
 * 5. Click handlers invoke callbacks
 * 6. Export mode strips controls with exportBehavior 'strip'
 */
import { describe, it, expect, vi } from 'vitest';
import { select } from 'd3-selection';
import { renderLegendD3 } from '../src/utils/legend-d3';
import type { LegendConfig, LegendCallbacks } from '../src/utils/legend-types';
import type { LegendGroupData } from '../src/utils/legend-svg';
import { FONT_CENTRAL_DY } from '../src/fonts';

const palette = {
  bg: '#ffffff',
  surface: '#f0f0f0',
  text: '#333333',
  textMuted: '#888888',
};

function makeContainer(): SVGGElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const svg = select(div).append('svg').attr('width', 800).attr('height', 100);
  return svg.append('g').node()!;
}

const groups: LegendGroupData[] = [
  {
    name: 'Priority',
    entries: [
      { value: 'High', color: '#e53e3e' },
      { value: 'Low', color: '#38a169' },
    ],
  },
  {
    name: 'Status',
    entries: [
      { value: 'Active', color: '#3182ce' },
      { value: 'Done', color: '#718096' },
    ],
  },
];

const defaultConfig: LegendConfig = {
  groups,
  position: { placement: 'top-center', titleRelation: 'below-title' },
  mode: 'preview',
};

describe('renderLegendD3', () => {
  it('renders pills with data-legend-group attributes', () => {
    const g = makeContainer();
    const container = select(g);
    renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: null },
      palette,
      false
    );

    const pillGroups = g.querySelectorAll('[data-legend-group]');
    expect(pillGroups.length).toBe(2);
    expect(pillGroups[0].getAttribute('data-legend-group')).toBe('priority');
    expect(pillGroups[1].getAttribute('data-legend-group')).toBe('status');
  });

  it('renders active capsule with entry dots', () => {
    const g = makeContainer();
    const container = select(g);
    renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: 'Priority' },
      palette,
      false
    );

    const entries = g.querySelectorAll('[data-legend-entry]');
    expect(entries.length).toBe(2);
    expect(entries[0].getAttribute('data-legend-entry')).toBe('high');
    expect(entries[1].getAttribute('data-legend-entry')).toBe('low');

    // Each entry should have a colored circle
    const circles = entries[0].querySelectorAll('circle');
    expect(circles.length).toBe(1);
    expect(circles[0].getAttribute('fill')).toBe('#e53e3e');
  });

  it('sets data-legend-active on container when active group set', () => {
    const g = makeContainer();
    const container = select(g);
    renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: 'Status' },
      palette,
      false
    );

    const legendRoot = g.querySelector('.dgmo-legend');
    expect(legendRoot).not.toBeNull();
    expect(legendRoot!.getAttribute('data-legend-active')).toBe('status');
  });

  it('does not set data-legend-active when no group active', () => {
    const g = makeContainer();
    const container = select(g);
    renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: null },
      palette,
      false
    );

    const legendRoot = g.querySelector('.dgmo-legend');
    expect(legendRoot).not.toBeNull();
    expect(legendRoot!.getAttribute('data-legend-active')).toBeNull();
  });

  it('hides inactive group pills when a group is active', () => {
    const g = makeContainer();
    const container = select(g);
    renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: 'Priority' },
      palette,
      false
    );

    const statusPill = g.querySelector('[data-legend-group="status"]');
    expect(statusPill).toBeNull();
    const priorityCapsule = g.querySelector('[data-legend-group="priority"]');
    expect(priorityCapsule).not.toBeNull();
  });

  it('setState re-renders with new active group', () => {
    const g = makeContainer();
    const container = select(g);
    const handle = renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: null },
      palette,
      false
    );

    // Initially no entries
    expect(g.querySelectorAll('[data-legend-entry]').length).toBe(0);

    // Activate a group
    handle.setState({ activeGroup: 'Status' });
    const entries = g.querySelectorAll('[data-legend-entry]');
    expect(entries.length).toBe(2);
    expect(entries[0].getAttribute('data-legend-entry')).toBe('active');
  });

  it('getHeight returns correct height', () => {
    const g = makeContainer();
    const container = select(g);
    const handle = renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: 'Priority' },
      palette,
      false
    );
    expect(handle.getHeight()).toBe(28);
  });

  it('getHeight returns 0 for empty groups', () => {
    const g = makeContainer();
    const container = select(g);
    const config: LegendConfig = {
      groups: [],
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: 'preview',
    };
    const handle = renderLegendD3(
      container,
      config,
      { activeGroup: null },
      palette,
      false
    );
    expect(handle.getHeight()).toBe(0);
  });

  it('destroy removes legend DOM', () => {
    const g = makeContainer();
    const container = select(g);
    const handle = renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: null },
      palette,
      false
    );

    expect(g.querySelector('.dgmo-legend')).not.toBeNull();
    handle.destroy();
    expect(g.querySelector('.dgmo-legend')).toBeNull();
  });

  it('renders controls with data-legend-control attribute', () => {
    const g = makeContainer();
    const container = select(g);
    const config: LegendConfig = {
      ...defaultConfig,
      controls: [
        {
          id: 'eye',
          icon: '<circle r="5"/>',
          label: 'Meta',
          exportBehavior: 'strip',
        },
      ],
    };
    renderLegendD3(container, config, { activeGroup: null }, palette, false);

    const ctrl = g.querySelector('[data-legend-control="eye"]');
    expect(ctrl).not.toBeNull();
    expect(ctrl!.getAttribute('data-export-ignore')).toBe('true');
  });

  it('active capsule survives export (no data-export-ignore)', () => {
    const g = makeContainer();
    const container = select(g);
    renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: 'Priority' },
      palette,
      false
    );

    const priorityCapsule = g.querySelector('[data-legend-group="priority"]');
    expect(priorityCapsule).not.toBeNull();
    expect(priorityCapsule!.getAttribute('data-export-ignore')).toBeNull();
    // Inactive pills hidden when group is active
    const statusPill = g.querySelector('[data-legend-group="status"]');
    expect(statusPill).toBeNull();
  });

  it('all pills survive export when no group is active', () => {
    const g = makeContainer();
    const container = select(g);
    renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: null },
      palette,
      false
    );

    const pills = g.querySelectorAll('[data-legend-group]');
    expect(pills.length).toBe(2);
    for (const pill of pills) {
      expect(pill.getAttribute('data-export-ignore')).toBeNull();
    }
  });

  it('capsulePillAddonWidth reserves space for addons', () => {
    const g = makeContainer();
    const container = select(g);
    const config: LegendConfig = {
      ...defaultConfig,
      capsulePillAddonWidth: 20,
    };
    const handle = renderLegendD3(
      container,
      config,
      { activeGroup: 'Priority' },
      palette,
      false
    );
    const layout = handle.getLayout();
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.activeCapsule!.addonX).toBeDefined();
    expect(layout.activeCapsule!.addonX!).toBeGreaterThan(0);
  });

  // Asserts every <text> under `g` is centered the cross-engine way: an
  // explicit em-relative `dy` and NO `dominant-baseline` (which WebKit drops).
  // The offset is asserted against Inter's own metric rather than a literal,
  // so the number can be re-derived from the font instead of guessed at.
  // Returns the rendered text nodes so callers can also assert an expected
  // count — a positive control against a label silently failing to render.
  function expectAllTextCentered(g: SVGGElement): SVGTextElement[] {
    const texts = Array.from(g.querySelectorAll('text'));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t.getAttribute('dy')).toBe(`${FONT_CENTRAL_DY}em`);
      expect(t.hasAttribute('dominant-baseline')).toBe(false);
    }
    return texts;
  }

  it('centers collapsed-pill text via dy, not dominant-baseline', () => {
    const g = makeContainer();
    renderLegendD3(
      select(g),
      defaultConfig,
      { activeGroup: null },
      palette,
      false
    );

    // One pill label per group — count guards against a label vanishing.
    const texts = expectAllTextCentered(g);
    expect(texts.length).toBe(2);
  });

  it('centers active-capsule text (group name + entries) via dy', () => {
    const g = makeContainer();
    renderLegendD3(
      select(g),
      defaultConfig,
      { activeGroup: 'Priority' },
      palette,
      false
    );

    // Group name + one label per entry (2) = 3 texts.
    const texts = expectAllTextCentered(g);
    expect(texts.length).toBe(3);
  });

  it('centers gradient (choropleth) min/max labels via dy', () => {
    const g = makeContainer();
    const config: LegendConfig = {
      ...defaultConfig,
      groups: [
        {
          name: 'Score',
          entries: [],
          gradient: { min: 0, max: 100, low: '#ffffff', high: '#3182ce' },
        },
      ],
    };
    renderLegendD3(select(g), config, { activeGroup: 'Score' }, palette, false);

    // Group-name pill + min label + max label.
    const texts = expectAllTextCentered(g);
    const labels = texts.map((t) => t.textContent);
    expect(labels).toContain('0');
    expect(labels).toContain('100');
  });

  it('centers control label + child labels via dy', () => {
    const g = makeContainer();
    const config: LegendConfig = {
      ...defaultConfig,
      controls: [
        {
          id: 'speed',
          icon: '<circle r="5"/>',
          label: 'Speed',
          exportBehavior: 'keep',
          children: [
            { id: 's1', label: '1x', isActive: true },
            { id: 's2', label: '2x' },
          ],
        },
      ],
    };
    renderLegendD3(select(g), config, { activeGroup: null }, palette, false);

    const labels = expectAllTextCentered(g).map((t) => t.textContent);
    expect(labels).toContain('Speed');
    expect(labels).toContain('1x');
    expect(labels).toContain('2x');
  });

  it('centers expanded controlsGroup toggle labels via dy', () => {
    const g = makeContainer();
    const config: LegendConfig = {
      ...defaultConfig,
      controlsGroup: {
        toggles: [
          {
            id: 't1',
            type: 'toggle',
            label: 'Relief',
            active: true,
            onToggle: () => {},
          },
          {
            id: 't2',
            type: 'toggle',
            label: 'Coast',
            active: false,
            onToggle: () => {},
          },
        ],
      },
    };
    renderLegendD3(
      select(g),
      config,
      { activeGroup: null, controlsExpanded: true },
      palette,
      false
    );

    const labels = expectAllTextCentered(g).map((t) => t.textContent);
    expect(labels).toContain('Relief');
    expect(labels).toContain('Coast');
  });

  it('invokes onGroupToggle callback on pill click', () => {
    const g = makeContainer();
    const container = select(g);
    const onGroupToggle = vi.fn();
    const callbacks: LegendCallbacks = { onGroupToggle };
    renderLegendD3(
      container,
      defaultConfig,
      { activeGroup: null },
      palette,
      false,
      callbacks
    );

    const pill = g.querySelector('[data-legend-group="priority"]') as Element;
    expect(pill).not.toBeNull();
    pill.dispatchEvent(new Event('click'));
    expect(onGroupToggle).toHaveBeenCalledWith('Priority');
  });
});
