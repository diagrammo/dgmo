/**
 * Tests for app-hosted controls (`controlsHost: 'app'`) in the centralized
 * legend layout engine (tech-spec-chart-controls-to-rail).
 *
 * The gate is strictly opt-in: with `controlsHost` unset (the default for every
 * non-app consumer — Obsidian, site, remark-family, CLI), the inline gear
 * controlsGroup renders exactly as before. When `controlsHost: 'app'`, the
 * controlsGroup is dropped entirely (no gear, no reserved row) — the app overlay
 * strip owns the controls, pinned to the top edge of the preview, so dgmo
 * reclaims that space.
 */
import { describe, it, expect } from 'vitest';
import {
  computeLegendLayout,
  getMaxLegendReservedHeight,
} from '../src/utils/legend-layout';
import { LEGEND_HEIGHT } from '../src/utils/legend-constants';
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
  it('default (unset) renders the inline gear', () => {
    const layout = computeLegendLayout(baseConfig(), noActive, 800);
    expect(layout.controlsGroup).toBeDefined();
    expect(layout.height).toBe(LEGEND_HEIGHT);
  });

  it("'inline' is treated as default — gear present", () => {
    const layout = computeLegendLayout(
      baseConfig({ controlsHost: 'inline' }),
      noActive,
      800
    );
    expect(layout.controlsGroup).toBeDefined();
  });

  it("'app' drops the controlsGroup entirely (no gear, no row) when there are no groups", () => {
    const layout = computeLegendLayout(
      baseConfig({ controlsHost: 'app' }),
      noActive,
      800
    );
    expect(layout.controlsGroup).toBeUndefined();
    // Controls-only legend collapses to nothing — the chart reclaims the space.
    expect(layout.height).toBe(0);
  });

  it("'app' with groups renders the groups only, no reserved controls row", () => {
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
    expect(gated.controlsGroup).toBeUndefined();
    // The inline gear shares row 0 with the groups, so dropping it doesn't add
    // or remove a row — same height, no extra band.
    expect(gated.height).toBe(inline.height);
    expect(gated.pills[0]!.y).toBe(inline.pills[0]!.y);
  });

  it('never gates on the export path', () => {
    const layout = computeLegendLayout(
      baseConfig({ controlsHost: 'app', mode: 'export', groups: groups(1) }),
      { activeGroup: 'group1' },
      800
    );
    // Export ignores controlsHost; controlsGroup is stripped in export anyway.
    expect(layout.controlsGroup).toBeUndefined();
  });

  it('getMaxLegendReservedHeight is unaffected by controlsHost', () => {
    const inline = getMaxLegendReservedHeight(
      baseConfig({ groups: groups(2) }),
      800
    );
    const gated = getMaxLegendReservedHeight(
      baseConfig({ groups: groups(2), controlsHost: 'app' }),
      800
    );
    expect(gated).toBe(inline);
  });
});
