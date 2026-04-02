/**
 * Tests for the centralized legend layout engine (legend-layout.ts).
 *
 * Ensures:
 * 1. Single-row layout for small number of groups
 * 2. Active group capsule sizing
 * 3. Multi-row wrapping on overflow
 * 4. Controls right-anchored positioning
 * 5. Export mode: active-only, no-active = no legend
 * 6. Height reservation matches layout
 * 7. "+N more" when entries exceed max rows
 * 8. Inline-with-title variant (future test placeholder)
 */
import { describe, it, expect } from 'vitest';
import {
  computeLegendLayout,
  getLegendReservedHeight,
  pillWidth,
} from '../src/utils/legend-layout';
import { LEGEND_HEIGHT } from '../src/utils/legend-constants';
import type { LegendConfig, LegendState } from '../src/utils/legend-types';
import type { LegendGroupData } from '../src/utils/legend-svg';

const makeGroups = (count: number): LegendGroupData[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `Group${i + 1}`,
    entries: [
      { value: `Entry${i}A`, color: '#aaa' },
      { value: `Entry${i}B`, color: '#bbb' },
    ],
  }));

const defaultConfig = (
  groups: LegendGroupData[],
  overrides?: Partial<LegendConfig>
): LegendConfig => ({
  groups,
  position: { placement: 'top-center', titleRelation: 'below-title' },
  mode: 'fixed',
  ...overrides,
});

const noActiveState: LegendState = { activeGroup: null };

describe('computeLegendLayout', () => {
  it('returns height 0 for empty groups', () => {
    const layout = computeLegendLayout(defaultConfig([]), noActiveState, 800);
    expect(layout.height).toBe(0);
    expect(layout.pills).toHaveLength(0);
  });

  it('returns height 0 for groups with no entries', () => {
    const layout = computeLegendLayout(
      defaultConfig([{ name: 'Empty', entries: [] }]),
      noActiveState,
      800
    );
    expect(layout.height).toBe(0);
  });

  it('lays out single group as one pill, height 28px', () => {
    const groups = makeGroups(1);
    const layout = computeLegendLayout(
      defaultConfig(groups),
      noActiveState,
      800
    );
    expect(layout.height).toBe(LEGEND_HEIGHT);
    expect(layout.pills).toHaveLength(1);
    expect(layout.pills[0].groupName).toBe('Group1');
    expect(layout.pills[0].isActive).toBe(false);
    expect(layout.activeCapsule).toBeUndefined();
  });

  it('lays out multiple groups as pills in one row', () => {
    const groups = makeGroups(3);
    const layout = computeLegendLayout(
      defaultConfig(groups),
      noActiveState,
      800
    );
    expect(layout.height).toBe(LEGEND_HEIGHT);
    expect(layout.pills).toHaveLength(3);
    // Verify pills are ordered
    expect(layout.pills[0].groupName).toBe('Group1');
    expect(layout.pills[1].groupName).toBe('Group2');
    expect(layout.pills[2].groupName).toBe('Group3');
  });

  it('creates active capsule when group is active', () => {
    const groups = makeGroups(2);
    const state: LegendState = { activeGroup: 'Group1' };
    const layout = computeLegendLayout(defaultConfig(groups), state, 800);
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.activeCapsule!.groupName).toBe('Group1');
    expect(layout.activeCapsule!.entries).toHaveLength(2);
    // The non-active group is a pill
    expect(layout.pills).toHaveLength(1);
    expect(layout.pills[0].groupName).toBe('Group2');
  });

  it('case-insensitive activeGroup matching', () => {
    const groups = makeGroups(1);
    const state: LegendState = { activeGroup: 'group1' };
    const layout = computeLegendLayout(defaultConfig(groups), state, 800);
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.activeCapsule!.groupName).toBe('Group1');
    expect(layout.pills).toHaveLength(0);
  });

  it('capsule entries have correct color from group data', () => {
    const groups = makeGroups(1);
    const state: LegendState = { activeGroup: 'Group1' };
    const layout = computeLegendLayout(defaultConfig(groups), state, 800);
    expect(layout.activeCapsule!.entries[0].color).toBe('#aaa');
    expect(layout.activeCapsule!.entries[1].color).toBe('#bbb');
  });

  // ── Overflow / wrapping ──────────────────────────────────

  it('wraps pills to second row on narrow container', () => {
    const groups = makeGroups(6);
    // Each pill is ~70px, 6 * 70 + 5 * 12 = 480 → should wrap on 300px container
    const layout = computeLegendLayout(
      defaultConfig(groups),
      noActiveState,
      300
    );
    expect(layout.height).toBeGreaterThan(LEGEND_HEIGHT);
    expect(layout.rows.length).toBeGreaterThan(1);
  });

  // ── Controls ─────────────────────────────────────────────

  it('positions controls right-aligned', () => {
    const groups = makeGroups(1);
    const config = defaultConfig(groups, {
      controls: [
        {
          id: 'eye',
          icon: '<circle/>',
          label: 'Meta',
          exportBehavior: 'strip',
        },
      ],
    });
    const layout = computeLegendLayout(config, noActiveState, 800);
    expect(layout.controls).toHaveLength(1);
    expect(layout.controls[0].id).toBe('eye');
    // Control should be positioned towards the right
    expect(layout.controls[0].x).toBeGreaterThan(
      layout.pills[0].x + layout.pills[0].width
    );
  });

  it('strips controls with exportBehavior strip in export mode', () => {
    const groups = makeGroups(1);
    const config = defaultConfig(groups, {
      mode: 'inline',
      controls: [
        {
          id: 'eye',
          icon: '<circle/>',
          label: 'Meta',
          exportBehavior: 'strip',
        },
        {
          id: 'info',
          icon: '<rect/>',
          label: 'Info',
          exportBehavior: 'include',
        },
      ],
    });
    const state: LegendState = { activeGroup: 'Group1' };
    const layout = computeLegendLayout(config, state, 800);
    // Only 'include' control should be present
    expect(layout.controls).toHaveLength(1);
    expect(layout.controls[0].id).toBe('info');
  });

  // ── Export mode ──────────────────────────────────────────

  it('export mode with no active group returns height 0', () => {
    const groups = makeGroups(2);
    const config = defaultConfig(groups, { mode: 'inline' });
    const layout = computeLegendLayout(config, noActiveState, 800);
    expect(layout.height).toBe(0);
    expect(layout.pills).toHaveLength(0);
    expect(layout.activeCapsule).toBeUndefined();
  });

  it('export mode with active group shows only that group', () => {
    const groups = makeGroups(3);
    const config = defaultConfig(groups, { mode: 'inline' });
    const state: LegendState = { activeGroup: 'Group2' };
    const layout = computeLegendLayout(config, state, 800);
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.activeCapsule!.groupName).toBe('Group2');
    // No collapsed pills in export
    expect(layout.pills).toHaveLength(0);
    expect(layout.height).toBe(LEGEND_HEIGHT);
  });

  // ── Height reservation ───────────────────────────────────

  it('getLegendReservedHeight matches layout height', () => {
    const groups = makeGroups(2);
    const config = defaultConfig(groups);
    const state: LegendState = { activeGroup: 'Group1' };
    const layout = computeLegendLayout(config, state, 800);
    const reserved = getLegendReservedHeight(config, state, 800);
    expect(reserved).toBe(layout.height);
  });

  it('getLegendReservedHeight is 0 for export with no active group', () => {
    const config = defaultConfig(makeGroups(2), { mode: 'inline' });
    expect(getLegendReservedHeight(config, noActiveState, 800)).toBe(0);
  });

  // ── Pill width sanity ────────────────────────────────────

  it('pillWidth uses proportional text measurement', () => {
    const w1 = pillWidth('Short');
    const w2 = pillWidth('Much Longer Name');
    expect(w2).toBeGreaterThan(w1);
    // Both should be positive and reasonable
    expect(w1).toBeGreaterThan(20);
    expect(w2).toBeGreaterThan(40);
  });
});
