/**
 * Tests for export consistency of the centralized legend system.
 *
 * Ensures:
 * 1. Export with active group shows only that group expanded
 * 2. Export with no active group shows no legend elements
 * 3. Controls with exportBehavior 'strip' excluded from export
 * 4. Controls with exportBehavior 'include' present in export
 */
import { describe, it, expect } from 'vitest';
import { computeLegendLayout } from '../src/utils/legend-layout';
import type { LegendConfig, LegendState } from '../src/utils/legend-types';
import type { LegendGroupData } from '../src/utils/legend-svg';

const groups: LegendGroupData[] = [
  {
    name: 'Team',
    entries: [
      { value: 'Frontend', color: '#3182ce' },
      { value: 'Backend', color: '#38a169' },
    ],
  },
  {
    name: 'Priority',
    entries: [
      { value: 'High', color: '#e53e3e' },
      { value: 'Low', color: '#718096' },
    ],
  },
];

const exportConfig = (overrides?: Partial<LegendConfig>): LegendConfig => ({
  groups,
  position: { placement: 'top-center', titleRelation: 'below-title' },
  mode: 'inline', // export mode
  ...overrides,
});

describe('Legend export consistency', () => {
  it('no active group → no legend in export', () => {
    const layout = computeLegendLayout(
      exportConfig(),
      { activeGroup: null },
      800
    );
    expect(layout.height).toBe(0);
    expect(layout.pills).toHaveLength(0);
    expect(layout.activeCapsule).toBeUndefined();
    expect(layout.controls).toHaveLength(0);
  });

  it('active group → only that group shown in export', () => {
    const state: LegendState = { activeGroup: 'Team' };
    const layout = computeLegendLayout(exportConfig(), state, 800);
    expect(layout.height).toBeGreaterThan(0);
    // Active capsule present
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.activeCapsule!.groupName).toBe('Team');
    expect(layout.activeCapsule!.entries).toHaveLength(2);
    // Non-active pills hidden in export
    expect(layout.pills).toHaveLength(0);
  });

  it('active group entries have correct colors', () => {
    const state: LegendState = { activeGroup: 'Team' };
    const layout = computeLegendLayout(exportConfig(), state, 800);
    expect(layout.activeCapsule!.entries[0].color).toBe('#3182ce');
    expect(layout.activeCapsule!.entries[1].color).toBe('#38a169');
  });

  it('controls with exportBehavior strip are excluded', () => {
    const config = exportConfig({
      controls: [
        { id: 'play', icon: '▶', label: 'Play', exportBehavior: 'strip' },
        { id: 'info', icon: 'ℹ', label: 'Info', exportBehavior: 'include' },
      ],
    });
    const state: LegendState = { activeGroup: 'Team' };
    const layout = computeLegendLayout(config, state, 800);
    // Only 'include' control should be present
    expect(layout.controls).toHaveLength(1);
    expect(layout.controls[0].id).toBe('info');
  });

  it('controls with exportBehavior include are present', () => {
    const config = exportConfig({
      controls: [
        {
          id: 'indicator',
          icon: '●',
          label: 'Speed',
          exportBehavior: 'include',
        },
      ],
    });
    const state: LegendState = { activeGroup: 'Team' };
    const layout = computeLegendLayout(config, state, 800);
    expect(layout.controls).toHaveLength(1);
    expect(layout.controls[0].id).toBe('indicator');
  });

  it('controls with exportBehavior static are present', () => {
    const config = exportConfig({
      controls: [
        { id: 'speed', icon: '◆', label: '2x', exportBehavior: 'static' },
      ],
    });
    const state: LegendState = { activeGroup: 'Team' };
    const layout = computeLegendLayout(config, state, 800);
    expect(layout.controls).toHaveLength(1);
    expect(layout.controls[0].exportBehavior).toBe('static');
  });

  it('case-insensitive active group matching in export', () => {
    const state: LegendState = { activeGroup: 'team' };
    const layout = computeLegendLayout(exportConfig(), state, 800);
    expect(layout.activeCapsule).toBeDefined();
    expect(layout.activeCapsule!.groupName).toBe('Team');
  });
});
