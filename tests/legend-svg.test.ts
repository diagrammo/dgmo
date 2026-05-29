/**
 * Tests for the centralized legend SVG renderer (legend-svg.ts).
 *
 * Ensures:
 * 1. Legend renders with correct data attributes for interactivity
 * 2. data-series-name preserves original casing (for ECharts dispatchAction)
 * 3. data-legend-entry is always lowercase (for CSS selectors)
 * 4. Collapsed vs expanded state works correctly
 * 5. Empty groups produce no output
 */
import { describe, it, expect } from 'vitest';
import { renderLegendSvg, type LegendGroupData } from '../src/utils/legend-svg';

const palette = {
  bg: '#ffffff',
  surface: '#f0f0f0',
  text: '#333333',
  textMuted: '#888888',
};

const groups: LegendGroupData[] = [
  {
    name: 'Group',
    entries: [
      { value: 'SaaS', color: '#5e81ac' },
      { value: 'Fintech', color: '#a3be8c' },
      { value: 'HealthTech', color: '#bf616a' },
    ],
  },
];

describe('renderLegendSvg', () => {
  it('returns empty for no groups', () => {
    const result = renderLegendSvg([], {
      palette,
      isDark: false,
      containerWidth: 1200,
    });
    expect(result.svg).toBe('');
    expect(result.height).toBe(0);
  });

  it('returns empty for groups with no entries', () => {
    const result = renderLegendSvg([{ name: 'Empty', entries: [] }], {
      palette,
      isDark: false,
      containerWidth: 1200,
    });
    expect(result.svg).toBe('');
    expect(result.height).toBe(0);
  });

  it('renders collapsed state (no activeGroup)', () => {
    const result = renderLegendSvg(groups, {
      palette,
      isDark: false,
      containerWidth: 1200,
    });
    expect(result.height).toBe(28);
    // Should have group pill but no entry dots
    expect(result.svg).toContain('data-legend-group="group"');
    expect(result.svg).not.toContain('data-legend-entry');
    expect(result.svg).not.toContain('data-series-name');
  });

  it('renders expanded state with correct data attributes', () => {
    const result = renderLegendSvg(groups, {
      palette,
      isDark: false,
      containerWidth: 1200,
      activeGroup: 'Group',
    });

    // data-legend-entry must be lowercase
    expect(result.svg).toContain('data-legend-entry="saas"');
    expect(result.svg).toContain('data-legend-entry="fintech"');
    expect(result.svg).toContain('data-legend-entry="healthtech"');

    // data-series-name must preserve original casing for ECharts highlight
    expect(result.svg).toContain('data-series-name="SaaS"');
    expect(result.svg).toContain('data-series-name="Fintech"');
    expect(result.svg).toContain('data-series-name="HealthTech"');
  });

  it('sets data-legend-active when activeGroup is provided', () => {
    const result = renderLegendSvg(groups, {
      palette,
      isDark: false,
      containerWidth: 1200,
      activeGroup: 'Group',
    });
    expect(result.svg).toContain('data-legend-active="group"');
  });

  it('renders only the active group when one is active', () => {
    // Matches the canonical layout engine (computeLegendLayout): when a group
    // is active it expands to a capsule and the others are hidden — same as
    // every D3 diagram. (ECharts charts only ever have a single group.)
    const multiGroups: LegendGroupData[] = [
      { name: 'Type', entries: [{ value: 'A', color: '#aaa' }] },
      { name: 'Status', entries: [{ value: 'Done', color: '#bbb' }] },
    ];
    const result = renderLegendSvg(multiGroups, {
      palette,
      isDark: false,
      containerWidth: 1200,
      activeGroup: 'Type',
    });
    expect(result.svg).toContain('data-legend-group="type"');
    expect(result.svg).not.toContain('data-legend-group="status"');
    // Only the active group's entries are expanded
    expect(result.svg).toContain('data-series-name="A"');
    expect(result.svg).not.toContain('data-series-name="Done"');
  });

  it('renders all groups as collapsed pills when none is active', () => {
    const multiGroups: LegendGroupData[] = [
      { name: 'Type', entries: [{ value: 'A', color: '#aaa' }] },
      { name: 'Status', entries: [{ value: 'Done', color: '#bbb' }] },
    ];
    const result = renderLegendSvg(multiGroups, {
      palette,
      isDark: false,
      containerWidth: 1200,
    });
    expect(result.svg).toContain('data-legend-group="type"');
    expect(result.svg).toContain('data-legend-group="status"');
    // Collapsed — no entries expanded
    expect(result.svg).not.toContain('data-series-name');
  });

  it('wraps a long entry list onto multiple rows', () => {
    const many: LegendGroupData[] = [
      {
        name: 'Series',
        entries: Array.from({ length: 14 }, (_, i) => ({
          value: `Cloud Service Number ${i + 1}`,
          color: '#5e81ac',
        })),
      },
    ];
    // Narrow budget forces wrapping.
    const result = renderLegendSvg(many, {
      palette,
      isDark: false,
      containerWidth: 600,
      activeGroup: 'Series',
    });
    // Taller than a single row, and stays within the wrap budget.
    expect(result.height).toBeGreaterThan(28);
    expect(result.width).toBeLessThanOrEqual(600);
    // Entries render at more than one vertical position (multiple rows).
    const cys = [
      ...result.svg.matchAll(/<circle cx="[^"]*" cy="([^"]*)"/g),
    ].map((m) => m[1]);
    expect(new Set(cys).size).toBeGreaterThan(1);
  });

  it('keeps a short entry list on a single row', () => {
    const result = renderLegendSvg(groups, {
      palette,
      isDark: false,
      containerWidth: 1200,
      activeGroup: 'Group',
    });
    expect(result.height).toBe(28);
  });

  it('applies className when provided', () => {
    const result = renderLegendSvg(groups, {
      palette,
      isDark: false,
      containerWidth: 1200,
      className: 'chart-legend',
    });
    expect(result.svg).toContain('class="chart-legend"');
  });
});
