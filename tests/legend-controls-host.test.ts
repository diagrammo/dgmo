/**
 * Tests for app-hosted controls (`controlsHost: 'app'`) in the centralized
 * legend layout engine (tech-spec-chart-controls-to-rail).
 *
 * The gate must be strictly opt-in: with `controlsHost` unset (the default for
 * every non-app consumer — Obsidian, site, remark-family, CLI), the inline gear
 * controlsGroup renders exactly as before and NO controls anchor is emitted.
 * When `controlsHost: 'app'`, the inline gear is suppressed, a fixed-height
 * controls row is reserved at the top, and a controls anchor is emitted at the
 * top-right for the app overlay strip to align to.
 */
import { describe, it, expect } from 'vitest';
import {
  computeLegendLayout,
  getMaxLegendReservedHeight,
} from '../src/utils/legend-layout';
import { LEGEND_HEIGHT, CONTROLS_ROW_H } from '../src/utils/legend-constants';
import type {
  LegendConfig,
  LegendState,
  ControlsGroupConfig,
} from '../src/utils/legend-types';
import type { LegendGroupData } from '../src/utils/legend-svg';

const controlsGroup: ControlsGroupConfig = {
  toggles: [
    {
      id: 'descriptions',
      type: 'toggle',
      label: 'Descriptions',
      active: true,
      onToggle: () => {},
    },
  ],
};

const baseConfig = (overrides?: Partial<LegendConfig>): LegendConfig => ({
  groups: [],
  position: { placement: 'top-center', titleRelation: 'below-title' },
  mode: 'preview',
  controlsGroup,
  ...overrides,
});

const groups = (n: number): LegendGroupData[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Group${i + 1}`,
    entries: [{ value: `E${i}`, color: '#aaa' }],
  }));

const noActive: LegendState = { activeGroup: null };

describe('controlsHost gating', () => {
  it('default (unset) renders the inline gear and emits no anchor', () => {
    const layout = computeLegendLayout(baseConfig(), noActive, 800);
    expect(layout.controlsGroup).toBeDefined();
    expect(layout.controlsAnchor).toBeUndefined();
    expect(layout.height).toBe(LEGEND_HEIGHT);
  });

  it("'inline' is treated as default — gear present, no anchor", () => {
    const layout = computeLegendLayout(
      baseConfig({ controlsHost: 'inline' }),
      noActive,
      800
    );
    expect(layout.controlsGroup).toBeDefined();
    expect(layout.controlsAnchor).toBeUndefined();
  });

  it("'app' suppresses the gear and emits a top-right anchor (no groups)", () => {
    const layout = computeLegendLayout(
      baseConfig({ controlsHost: 'app' }),
      noActive,
      800
    );
    expect(layout.controlsGroup).toBeUndefined();
    expect(layout.controlsAnchor).toBeDefined();
    const a = layout.controlsAnchor!;
    expect(a.y).toBe(0);
    expect(a.height).toBe(CONTROLS_ROW_H);
    // Right-aligned: right edge reaches the container width.
    expect(a.x + a.width).toBe(800);
    // No extra row reserved beyond the single controls row.
    expect(layout.height).toBe(CONTROLS_ROW_H);
  });

  it("'app' with groups reserves a controls row on top and shifts content down", () => {
    const inline = computeLegendLayout(
      baseConfig({ groups: groups(2) }),
      noActive,
      800
    );
    const gated = computeLegendLayout(
      baseConfig({ groups: groups(2), controlsHost: 'app' }),
      noActive,
      800
    );
    expect(gated.controlsAnchor).toBeDefined();
    expect(gated.controlsAnchor!.y).toBe(0);
    // One extra row of height for the controls band.
    expect(gated.height).toBe(inline.height + CONTROLS_ROW_H);
    // Every legend item is pushed down by exactly one controls row.
    const inlinePillY = inline.pills[0]!.y;
    const gatedPillY = gated.pills[0]!.y;
    expect(gatedPillY).toBe(inlinePillY + CONTROLS_ROW_H);
  });

  it('never gates on the export path', () => {
    const layout = computeLegendLayout(
      baseConfig({ controlsHost: 'app', mode: 'export', groups: groups(1) }),
      { activeGroup: 'group1' },
      800
    );
    expect(layout.controlsAnchor).toBeUndefined();
  });

  it('getMaxLegendReservedHeight adds the controls row only when gated', () => {
    const inline = getMaxLegendReservedHeight(
      baseConfig({ groups: groups(2) }),
      800
    );
    const gated = getMaxLegendReservedHeight(
      baseConfig({ groups: groups(2), controlsHost: 'app' }),
      800
    );
    expect(gated).toBe(inline + CONTROLS_ROW_H);
  });

  it('getMaxLegendReservedHeight reserves a single row when gated with no groups', () => {
    const gated = getMaxLegendReservedHeight(
      baseConfig({ controlsHost: 'app' }),
      800
    );
    expect(gated).toBe(CONTROLS_ROW_H);
  });
});
