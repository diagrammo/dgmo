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
  getMaxLegendReservedHeight,
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
  mode: 'preview',
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

  it('creates active capsule when group is active (hides inactive pills)', () => {
    const groups = makeGroups(2);
    const state: LegendState = { activeGroup: 'Group1' };
    const layout = computeLegendLayout(defaultConfig(groups), state, 800);
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.activeCapsule!.groupName).toBe('Group1');
    expect(layout.activeCapsule!.entries).toHaveLength(2);
    expect(layout.pills).toHaveLength(0);
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
      mode: 'export',
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
    const config = defaultConfig(groups, { mode: 'export' });
    const layout = computeLegendLayout(config, noActiveState, 800);
    expect(layout.height).toBe(0);
    expect(layout.pills).toHaveLength(0);
    expect(layout.activeCapsule).toBeUndefined();
  });

  it('export mode with active group shows only that group', () => {
    const groups = makeGroups(3);
    const config = defaultConfig(groups, { mode: 'export' });
    const state: LegendState = { activeGroup: 'Group2' };
    const layout = computeLegendLayout(config, state, 800);
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.activeCapsule!.groupName).toBe('Group2');
    // No collapsed pills in export
    expect(layout.pills).toHaveLength(0);
    expect(layout.height).toBe(LEGEND_HEIGHT);
  });

  it('export mode drops the controlsGroup wholesale', () => {
    const groups = makeGroups(2);
    const config = defaultConfig(groups, {
      mode: 'export',
      controlsGroup: {
        toggles: [
          {
            id: 'descriptions',
            type: 'toggle',
            label: 'Descriptions',
            active: true,
            onToggle: () => {},
          },
        ],
      },
    });
    const state: LegendState = { activeGroup: 'Group1' };
    const layout = computeLegendLayout(config, state, 800);
    expect(layout.controlsGroup).toBeUndefined();
  });

  it('export mode centers a single active capsule within containerWidth', () => {
    const groups = makeGroups(2);
    const config = defaultConfig(groups, { mode: 'export' });
    const state: LegendState = { activeGroup: 'Group1' };
    const containerWidth = 1200;
    const layout = computeLegendLayout(config, state, containerWidth);
    const capsule = layout.activeCapsule!;
    const centerX = capsule.x + capsule.width / 2;
    expect(Math.abs(centerX - containerWidth / 2)).toBeLessThan(0.5);
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
    const config = defaultConfig(makeGroups(2), { mode: 'export' });
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

// ── Continuation row indent ─────────────────────────────────

describe('buildCapsuleLayout indent', () => {
  it('row 2+ entries indent to align with first entry after pill', () => {
    const manyEntries: LegendGroupData = {
      name: 'Rank',
      entries: Array.from({ length: 8 }, (_, i) => ({
        value: `Entry${i}`,
        color: `#${i}${i}${i}`,
      })),
    };
    const config = defaultConfig([manyEntries]);
    const state: LegendState = { activeGroup: 'Rank' };
    const layout = computeLegendLayout(config, state, 400);
    const capsule = layout.activeCapsule!;
    expect(capsule.entries.length).toBeGreaterThan(0);

    const firstEntryX = capsule.entries[0].x;
    const row2Entries = capsule.entries.filter(
      (e) => e.y > 0 && e.y === LEGEND_HEIGHT
    );
    if (row2Entries.length > 0) {
      for (const e of row2Entries) {
        expect(e.x).toBeGreaterThanOrEqual(firstEntryX);
      }
    }
  });
});

// ── Inactive pill hiding ────────────────────────────────────

describe('computeLegendLayout inactive pill hiding', () => {
  it('hides inactive pills when a group is active', () => {
    const groups = makeGroups(3);
    const state: LegendState = { activeGroup: 'Group1' };
    const layout = computeLegendLayout(defaultConfig(groups), state, 800);
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.pills).toHaveLength(0);
  });

  it('shows all groups as pills when no group is active', () => {
    const groups = makeGroups(3);
    const layout = computeLegendLayout(
      defaultConfig(groups),
      noActiveState,
      800
    );
    expect(layout.activeCapsule).toBeUndefined();
    expect(layout.pills).toHaveLength(3);
  });
});

// ── getMaxLegendReservedHeight ──────────────────────────────

describe('getMaxLegendReservedHeight', () => {
  it('returns max capsule height across all groups', () => {
    const groups: LegendGroupData[] = [
      {
        name: 'Small',
        entries: [
          { value: 'A', color: '#aaa' },
          { value: 'B', color: '#bbb' },
        ],
      },
      {
        name: 'Big',
        entries: Array.from({ length: 10 }, (_, i) => ({
          value: `LongEntry${i}`,
          color: `#${i}00`,
        })),
      },
    ];
    const config = defaultConfig(groups);
    const h = getMaxLegendReservedHeight(config, 400);
    expect(h).toBeGreaterThan(LEGEND_HEIGHT);
    expect(h).toBeLessThanOrEqual(LEGEND_HEIGHT * 3);
  });

  it('returns LEGEND_HEIGHT for 0 groups', () => {
    const config = defaultConfig([]);
    expect(getMaxLegendReservedHeight(config, 800)).toBe(LEGEND_HEIGHT);
  });

  it('returns LEGEND_HEIGHT for groups that all fit on one row', () => {
    const groups = makeGroups(1);
    const config = defaultConfig(groups);
    expect(getMaxLegendReservedHeight(config, 800)).toBe(LEGEND_HEIGHT);
  });
});

// ── Entry truncation ────────────────────────────────────────

describe('entry label truncation', () => {
  it('truncates entry wider than available row width', () => {
    const group: LegendGroupData = {
      name: 'Test',
      entries: [
        {
          value: 'Very Long Entry Name That Exceeds Available Space Completely',
          color: '#aaa',
        },
      ],
    };
    const config = defaultConfig([group]);
    const state: LegendState = { activeGroup: 'Test' };
    const layout = computeLegendLayout(config, state, 200);
    const capsule = layout.activeCapsule!;
    expect(capsule.entries).toHaveLength(1);
    const entry = capsule.entries[0];
    expect(entry.displayValue).toBeDefined();
    expect(entry.displayValue!.endsWith('…')).toBe(true);
    expect(entry.value).toBe(
      'Very Long Entry Name That Exceeds Available Space Completely'
    );
  });
});

describe('computeLegendLayout — gradient (choropleth) groups', () => {
  const scoreGroup: LegendGroupData = {
    name: 'Pipeline',
    entries: [],
    gradient: { min: 11, max: 92, hue: '#bf616a', base: '#ffffff' },
  };
  const tierGroup: LegendGroupData = {
    name: 'Tier',
    entries: [
      { value: 'Core', color: '#5e81ac' },
      { value: 'Growth', color: '#88c0d0' },
    ],
  };

  it('renders an active gradient group as a swatch capsule (no entry dots)', () => {
    const layout = computeLegendLayout(
      defaultConfig([scoreGroup, tierGroup]),
      { activeGroup: 'Pipeline' },
      800
    );
    const cap = layout.activeCapsule!;
    expect(cap.groupName).toBe('Pipeline');
    expect(cap.entries).toHaveLength(0);
    expect(cap.gradient).toBeDefined();
    expect(cap.gradient!.minText).toBe('11');
    expect(cap.gradient!.maxText).toBe('92');
    expect(cap.gradient!.rampW).toBeGreaterThan(0);
  });

  it('a gradient group survives the empty-entries filter (it has no dots)', () => {
    const layout = computeLegendLayout(
      defaultConfig([scoreGroup]),
      { activeGroup: 'Pipeline' },
      800
    );
    expect(layout.height).toBe(LEGEND_HEIGHT);
    expect(layout.activeCapsule?.gradient).toBeDefined();
  });

  it('showInactivePills keeps siblings as clickable pills while one is active', () => {
    const layout = computeLegendLayout(
      defaultConfig([scoreGroup, tierGroup], { showInactivePills: true }),
      { activeGroup: 'Pipeline' },
      800
    );
    expect(layout.activeCapsule?.groupName).toBe('Pipeline');
    expect(layout.pills.map((p) => p.groupName)).toContain('Tier');
  });

  it('without showInactivePills, an active group hides its siblings (legacy)', () => {
    const layout = computeLegendLayout(
      defaultConfig([scoreGroup, tierGroup]),
      { activeGroup: 'Pipeline' },
      800
    );
    expect(layout.pills).toHaveLength(0);
  });
});
