/**
 * Tests for the controls group feature in the legend system.
 *
 * Covers:
 * 1. Layout: collapsed pill positioning, expanded capsule sizing, empty toggles, export stripping
 * 2. Layout: controls group + tag groups can be active simultaneously
 * 3. Layout: gear pill stays on row 1 when tag groups wrap
 * 4. D3 rendering: collapsed/expanded states, data attributes, click callbacks
 * 5. D3 rendering: filled/hollow dots for toggle ON/OFF, dimmed labels
 * 6. D3 rendering: setState with controlsExpanded
 */
import { describe, it, expect, vi } from 'vitest';
import { select } from 'd3-selection';
import { computeLegendLayout } from '../src/utils/legend-layout';
import { renderLegendD3 } from '../src/utils/legend-d3';
import {
  LEGEND_HEIGHT,
  LEGEND_GEAR_PILL_W,
} from '../src/utils/legend-constants';
import type {
  LegendConfig,
  LegendState,
  ControlsGroupConfig,
} from '../src/utils/legend-types';
import type { LegendGroupData } from '../src/utils/legend-svg';

// ── Helpers ────────────────────────────────────────────────

const palette = {
  bg: '#ffffff',
  surface: '#f0f0f0',
  text: '#333333',
  textMuted: '#888888',
  primary: '#3182ce',
};

const makeToggle = (id: string, label: string, active = true) => ({
  id,
  type: 'toggle' as const,
  label,
  active,
  onToggle: vi.fn(),
});

const makeControlsGroup = (
  ...toggles: Array<{ id: string; label: string; active: boolean }>
): ControlsGroupConfig => ({
  toggles: toggles.map((t) => makeToggle(t.id, t.label, t.active)),
});

const makeGroups = (count: number): LegendGroupData[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `Group${i + 1}`,
    entries: [
      { value: `Entry${i}A`, color: '#aaa' },
      { value: `Entry${i}B`, color: '#bbb' },
    ],
  }));

const defaultConfig = (overrides?: Partial<LegendConfig>): LegendConfig => ({
  groups: [],
  position: { placement: 'top-center', titleRelation: 'below-title' },
  mode: 'preview',
  ...overrides,
});

const noActiveState: LegendState = { activeGroup: null };

function makeContainer(): SVGGElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const svg = select(div).append('svg').attr('width', 800).attr('height', 100);
  return svg.append('g').node()!;
}

// ── Layout tests ───────────────────────────────────────────

describe('controls group layout', () => {
  it('returns no controls group when controlsGroup is undefined', () => {
    const layout = computeLegendLayout(defaultConfig(), noActiveState, 800);
    expect(layout.controlsGroup).toBeUndefined();
  });

  it('returns no controls group when toggles array is empty', () => {
    const layout = computeLegendLayout(
      defaultConfig({ controlsGroup: { toggles: [] } }),
      noActiveState,
      800
    );
    expect(layout.controlsGroup).toBeUndefined();
  });

  it('returns collapsed gear pill when controlsExpanded is false', () => {
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    const layout = computeLegendLayout(
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: false },
      800
    );
    expect(layout.controlsGroup).toBeDefined();
    expect(layout.controlsGroup!.expanded).toBe(false);
    expect(layout.controlsGroup!.width).toBe(LEGEND_GEAR_PILL_W);
    expect(layout.controlsGroup!.toggles).toHaveLength(0);
  });

  it('returns expanded capsule when controlsExpanded is true', () => {
    const cg = makeControlsGroup(
      { id: 'cp', label: 'Critical Path', active: true },
      { id: 'deps', label: 'Dependencies', active: false }
    );
    const layout = computeLegendLayout(
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: true },
      800
    );
    expect(layout.controlsGroup).toBeDefined();
    expect(layout.controlsGroup!.expanded).toBe(true);
    expect(layout.controlsGroup!.toggles).toHaveLength(2);
    expect(layout.controlsGroup!.toggles[0].id).toBe('cp');
    expect(layout.controlsGroup!.toggles[0].active).toBe(true);
    expect(layout.controlsGroup!.toggles[1].id).toBe('deps');
    expect(layout.controlsGroup!.toggles[1].active).toBe(false);
    expect(layout.controlsGroup!.width).toBeGreaterThan(LEGEND_GEAR_PILL_W);
  });

  it('strips controls group in export mode', () => {
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: true,
    });
    const groups = makeGroups(1);
    const layout = computeLegendLayout(
      defaultConfig({ controlsGroup: cg, groups, mode: 'export' }),
      { activeGroup: 'Group1', controlsExpanded: true },
      800
    );
    expect(layout.controlsGroup).toBeUndefined();
  });

  it('controls group + tag groups can coexist with both active', () => {
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: true,
    });
    const groups = makeGroups(2);
    const layout = computeLegendLayout(
      defaultConfig({ controlsGroup: cg, groups }),
      { activeGroup: 'Group1', controlsExpanded: true },
      800
    );
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.controlsGroup).toBeDefined();
    expect(layout.controlsGroup!.expanded).toBe(true);
  });

  it('gear pill stays on row 1 when many tag groups cause wrapping', () => {
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    const groups = makeGroups(15); // many groups to overflow
    const layout = computeLegendLayout(
      defaultConfig({ controlsGroup: cg, groups }),
      noActiveState,
      400 // narrow container
    );
    expect(layout.controlsGroup).toBeDefined();
    expect(layout.controlsGroup!.y).toBe(0); // row 1
  });

  it('legend has height > 0 with only controls group and no tag groups', () => {
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    const layout = computeLegendLayout(
      defaultConfig({ controlsGroup: cg }),
      noActiveState,
      800
    );
    expect(layout.height).toBe(LEGEND_HEIGHT);
    expect(layout.controlsGroup).toBeDefined();
  });
});

// ── D3 rendering tests ─────────────────────────────────────

describe('controls group D3 rendering', () => {
  it('renders collapsed gear pill with data-legend-controls="collapsed"', () => {
    const g = makeContainer();
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: false },
      palette,
      false
    );
    const el = g.querySelector('[data-legend-controls="collapsed"]');
    expect(el).not.toBeNull();
  });

  it('renders expanded capsule with data-legend-controls="expanded"', () => {
    const g = makeContainer();
    const cg = makeControlsGroup(
      { id: 'cp', label: 'Critical Path', active: true },
      { id: 'deps', label: 'Dependencies', active: false }
    );
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: true },
      palette,
      false
    );
    const el = g.querySelector('[data-legend-controls="expanded"]');
    expect(el).not.toBeNull();
  });

  it('sets data-export-ignore="true" on controls group wrapper', () => {
    const g = makeContainer();
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: false },
      palette,
      false
    );
    const el = g.querySelector('[data-legend-controls]');
    expect(el?.getAttribute('data-export-ignore')).toBe('true');
  });

  it('renders filled dot for active toggle', () => {
    const g = makeContainer();
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: true,
    });
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: true },
      palette,
      false
    );
    const toggle = g.querySelector('[data-controls-toggle="cp"]');
    expect(toggle).not.toBeNull();
    const circle = toggle!.querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe(palette.primary);
  });

  it('renders hollow dot for inactive toggle', () => {
    const g = makeContainer();
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: true },
      palette,
      false
    );
    const toggle = g.querySelector('[data-controls-toggle="cp"]');
    const circle = toggle!.querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('none');
    expect(circle?.getAttribute('stroke')).toBe(palette.textMuted);
  });

  it('renders dimmed label for inactive toggle', () => {
    const g = makeContainer();
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: true },
      palette,
      false
    );
    const toggle = g.querySelector('[data-controls-toggle="cp"]');
    const text = toggle!.querySelector('text');
    expect(text?.getAttribute('opacity')).toBe('0.4');
  });

  it('renders full opacity label for active toggle', () => {
    const g = makeContainer();
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: true,
    });
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: true },
      palette,
      false
    );
    const toggle = g.querySelector('[data-controls-toggle="cp"]');
    const text = toggle!.querySelector('text');
    expect(text?.getAttribute('opacity')).toBe('1');
  });

  it('fires onControlsExpand callback on collapsed pill click', () => {
    const g = makeContainer();
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    const onControlsExpand = vi.fn();
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: false },
      palette,
      false,
      { onControlsExpand }
    );
    const el = g.querySelector('[data-legend-controls="collapsed"]') as Element;
    el.dispatchEvent(new Event('click'));
    expect(onControlsExpand).toHaveBeenCalledTimes(1);
  });

  it('fires onControlsToggle with correct id and flipped state on toggle click', () => {
    const g = makeContainer();
    const cg = makeControlsGroup(
      { id: 'cp', label: 'Critical Path', active: true },
      { id: 'deps', label: 'Dependencies', active: false }
    );
    const onControlsToggle = vi.fn();
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: true },
      palette,
      false,
      { onControlsToggle }
    );

    // Click "Critical Path" toggle (currently active → should fire with false)
    const cpToggle = g.querySelector('[data-controls-toggle="cp"]') as Element;
    cpToggle.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onControlsToggle).toHaveBeenCalledWith('cp', false);

    // Click "Dependencies" toggle (currently inactive → should fire with true)
    const depsToggle = g.querySelector(
      '[data-controls-toggle="deps"]'
    ) as Element;
    depsToggle.dispatchEvent(new Event('click', { bubbles: true }));
    expect(onControlsToggle).toHaveBeenCalledWith('deps', true);
  });

  it('setState with controlsExpanded changes re-renders correctly', () => {
    const g = makeContainer();
    const cg = makeControlsGroup({
      id: 'cp',
      label: 'Critical Path',
      active: false,
    });
    const handle = renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: cg }),
      { activeGroup: null, controlsExpanded: false },
      palette,
      false
    );

    // Initially collapsed
    expect(
      g.querySelector('[data-legend-controls="collapsed"]')
    ).not.toBeNull();
    expect(g.querySelector('[data-legend-controls="expanded"]')).toBeNull();

    // Expand
    handle.setState({ activeGroup: null, controlsExpanded: true });
    expect(g.querySelector('[data-legend-controls="collapsed"]')).toBeNull();
    expect(g.querySelector('[data-legend-controls="expanded"]')).not.toBeNull();

    // Collapse again
    handle.setState({ activeGroup: null, controlsExpanded: false });
    expect(
      g.querySelector('[data-legend-controls="collapsed"]')
    ).not.toBeNull();
  });

  it('does not render controls group when toggles are empty', () => {
    const g = makeContainer();
    renderLegendD3(
      select(g),
      defaultConfig({ controlsGroup: { toggles: [] } }),
      noActiveState,
      palette,
      false
    );
    expect(g.querySelector('[data-legend-controls]')).toBeNull();
  });
});
