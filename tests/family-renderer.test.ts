import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFamily } from '../src/family/parser';
import { layoutFamily } from '../src/family/layout';
import { renderFamilyForExport } from '../src/family/renderer';
import { getPalette } from '../src/palettes';
import { resolveActiveTagGroup } from '../src/utils/tag-groups';

const FIX = (name: string): string =>
  readFileSync(join(__dirname, '..', 'gallery', 'fixtures', name), 'utf8');

function render(
  src: string,
  isDark = false,
  activeOverride?: string
): SVGSVGElement {
  const palette = isDark ? getPalette('nord').dark : getPalette('nord').light;
  const parsed = parseFamily(src, palette);
  const layout = layoutFamily(parsed);
  const el = document.createElement('div');
  // Mirror the real export path: the active group defaults to the first tag
  // group (the synthesized "Sex" group when any sex is present).
  const activeTagGroup = resolveActiveTagGroup(
    parsed.tagGroups,
    parsed.options['active-tag'],
    activeOverride
  );
  renderFamilyForExport(el, parsed, layout, palette, isDark, {
    exportDims: {
      width: layout.width + 40,
      height: layout.height + 80,
    },
    activeTagGroup,
  });
  return el.querySelector('svg')!;
}

describe('family renderer — structure (AC9)', () => {
  it('draws one card per person, a marriage bar, and a standard tag-group legend', () => {
    const svg = render(FIX('family.dgmo'));
    const parsed = parseFamily(FIX('family.dgmo'));
    expect(svg.querySelectorAll('.family-card').length).toBe(
      parsed.persons.size
    );
    expect(
      svg.querySelectorAll('.family-marriage-bar').length
    ).toBeGreaterThanOrEqual(1);
    // Standard tag-group legend (framework) present — the synthesized Sex group.
    expect(svg.querySelector('.family-legend-group')).not.toBeNull();
    // Cards carry data-tag-sex for hover-dim.
    expect(svg.querySelector('.family-card[data-tag-sex]')).not.toBeNull();
  });

  it('synthesizes a Sex tag group as the default-active coloring channel', () => {
    const parsed = parseFamily(`family
Anne sex: f
Bob sex: m`);
    expect(parsed.tagGroups[0]!.name).toBe('Sex');
    expect(parsed.tagGroups[0]!.entries.map((e) => e.value)).toEqual([
      'Male',
      'Female',
    ]);
    // No Sex group when no sex is declared.
    expect(parseFamily('family\nAnne\nBob').tagGroups).toHaveLength(0);
  });

  it('renders at least one dashed adopted drop, others solid (AC4)', () => {
    const svg = render(FIX('family.dgmo'));
    const dashed = Array.from(
      svg.querySelectorAll('.family-edges path')
    ).filter((p) => p.getAttribute('stroke-dasharray') === '6 3');
    const solid = Array.from(svg.querySelectorAll('.family-edges path')).filter(
      (p) => !p.getAttribute('stroke-dasharray')
    );
    expect(dashed.length).toBeGreaterThanOrEqual(1);
    expect(solid.length).toBeGreaterThanOrEqual(1);
  });
});

describe('family renderer — sex color + overrides', () => {
  it('renders in light and dark without hardcoded hex leaking from src', () => {
    // Both themes render some cards.
    for (const dark of [false, true]) {
      const svg = render(
        `family
Anne sex: f
Bob sex: m
Cy`,
        dark
      );
      expect(svg.querySelectorAll('.family-card').length).toBe(3);
    }
  });

  it('default-active Sex colors the card; switching the active group recolors (AC6)', () => {
    const src = `family
tag Allegiance as loyalty
  Crown blue
  Brethren red
Anne sex: f, loyalty: Crown`;
    const palette = getPalette('nord').light;
    // Default active = Sex → female → purple.
    const bySex = render(src).querySelector('.family-card rect')!;
    expect(bySex.getAttribute('stroke')).toBe(palette.colors.purple);
    // Switch active group to Allegiance → Crown → blue.
    const byTag = render(src, false, 'Allegiance').querySelector(
      '.family-card rect'
    )!;
    expect(byTag.getAttribute('stroke')).toBe(palette.colors.blue);
  });

  it('an explicit inline (color) always wins over the active group', () => {
    // Anne is female (sex active → purple) but carries an inline green.
    const svg = render(`family
Anne green sex: f`);
    const palette = getPalette('nord').light;
    const stroke = svg
      .querySelector('.family-card rect')!
      .getAttribute('stroke');
    expect(stroke).toBe(palette.colors.green);
  });
});

describe('family renderer — meta rows (AC7)', () => {
  it('shows a year range and labeled rows', () => {
    const svg = render(`family
Anne b: 1682, d: 1720, bp: Bristol, military: Royal Navy`);
    const texts = Array.from(svg.querySelectorAll('.family-card text')).map(
      (t) => t.textContent
    );
    expect(texts).toContain('1682 – 1720');
    expect(texts.some((t) => t?.startsWith('Born'))).toBe(true);
    expect(texts.some((t) => t?.startsWith('Military'))).toBe(true);
  });
});
