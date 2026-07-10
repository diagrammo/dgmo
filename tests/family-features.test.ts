// ============================================================
// Family Diagram — Feature batch (divorce, deceased, child-sort,
// generations gutter, `?` placeholder, lineage highlight)
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseFamily } from '../src/family/parser';
import { layoutFamily } from '../src/family/layout';
import { renderFamilyForExport } from '../src/family/renderer';
import { getPalette } from '../src/palettes';
import { resolveActiveTagGroup } from '../src/utils/tag-groups';

const codes = (src: string): string[] =>
  parseFamily(src).diagnostics.map((d) => d.code ?? '');

function render(src: string): SVGSVGElement {
  const palette = getPalette('nord').light;
  const parsed = parseFamily(src, palette);
  const layout = layoutFamily(parsed);
  const el = document.createElement('div');
  const activeTagGroup = resolveActiveTagGroup(
    parsed.tagGroups,
    parsed.options['active-tag']
  );
  renderFamilyForExport(el, parsed, layout, palette, false, {
    exportDims: { width: layout.width + 40, height: layout.height + 80 },
    activeTagGroup,
  });
  return el.querySelector('svg')!;
}

// ── 1. Divorce ──────────────────────────────────────────────
describe('family — divorce (bare `divorced` token)', () => {
  it('flags the union divorced and still attaches children', () => {
    const p = parseFamily(`family
Alice + Bob m: 1980 divorced
  Carol b: 1982`);
    expect(p.diagnostics).toHaveLength(0);
    const u = p.unions[0]!;
    expect(u.divorced).toBe(true);
    expect(u.metadata['m']).toBe('1980');
    expect(u.children.map((c) => c.personId)).toEqual(['carol']);
  });

  it('works without a marriage year', () => {
    const p = parseFamily(`family
Alice + Bob divorced`);
    expect(p.unions[0]!.divorced).toBe(true);
  });

  it('does not treat a person named "Divorced" alone as a divorce flag', () => {
    // No spaced `+` on the line → not a union → token is a plain name.
    const p = parseFamily(`family
Divorced`);
    expect(p.persons.has('divorced')).toBe(true);
  });

  it('renders the divorced marriage bar dashed', () => {
    const svg = render(`family
Alice + Bob m: 1980 divorced
  Carol`);
    const bar = svg.querySelector('.family-marriage-bar')!;
    expect(bar.getAttribute('stroke-dasharray')).toBe('6 3');
  });
});

// ── 1b. Adoption trailing token (regression) ────────────────
describe('family — adopted token AFTER metadata (spec §32.5)', () => {
  it('strips a trailing `adopted` even when it follows metadata values', () => {
    const p = parseFamily(`family
Anne + Bob
  Pearl b: 1715, sex: f, occupation: Cartographer adopted`);
    const pearl = p.persons.get('pearl')!;
    expect(pearl.metadata['occupation']).toBe('Cartographer'); // not "Cartographer adopted"
    expect(pearl.sex).toBe('f');
    expect(p.unions[0]!.children[0]!.adopted).toBe(true);
  });

  it('still handles the leading form `Name adopted, meta`', () => {
    const p = parseFamily(`family
Anne + Bob
  Kit adopted, sex: m`);
    expect(p.unions[0]!.children[0]!.adopted).toBe(true);
    expect(p.persons.get('kit')!.sex).toBe('m');
  });
});

// ── 2. Deceased marker ──────────────────────────────────────
describe('family — deceased dagger (derived from `d:`)', () => {
  it('prefixes a dagger on a person with a death year, not on the living', () => {
    const svg = render(`family
Blackbeard b: 1680, d: 1718
Blackbeard + Mary
  Edward b: 1710`);
    const labels = [...svg.querySelectorAll('.family-card > text')].map(
      (t) => t.textContent
    );
    expect(labels).toContain('† Blackbeard');
    expect(labels).toContain('Edward'); // living, no dagger
    expect(labels).not.toContain('† Edward');
  });

  it('placeholder `?` never gets a dagger', () => {
    const svg = render(`family
? + Mary
  Kid`);
    const labels = [...svg.querySelectorAll('.family-card > text')].map(
      (t) => t.textContent
    );
    expect(labels).toContain('?');
    expect(labels).not.toContain('† ?');
  });
});

// ── 3. Child sort by birth year ─────────────────────────────
describe('family — children sorted eldest→left by `b:`', () => {
  it('orders a union’s children left-to-right by birth year', () => {
    const parsed = parseFamily(`family
Anne + Bob
  Zeb b: 1690
  Amy b: 1685
  Mid b: 1688`);
    const layout = layoutFamily(parsed);
    const x = (id: string): number => layout.nodes.find((n) => n.id === id)!.x;
    expect(x('amy')).toBeLessThan(x('mid'));
    expect(x('mid')).toBeLessThan(x('zeb'));
  });

  it('undated children keep declaration order, after the dated ones', () => {
    const parsed = parseFamily(`family
Anne + Bob
  NoYearA
  Dated b: 1600
  NoYearB`);
    const layout = layoutFamily(parsed);
    const x = (id: string): number => layout.nodes.find((n) => n.id === id)!.x;
    expect(x('dated')).toBeLessThan(x('noyeara'));
    expect(x('noyeara')).toBeLessThan(x('noyearb'));
  });
});

// ── 4. Generation gutter (opt-in) ───────────────────────────
describe('family — `generations` gutter', () => {
  it('emits one Roman-numeral label per occupied row when enabled', () => {
    const svg = render(`family
generations
A + B
  C + D
    E`);
    const labels = [...svg.querySelectorAll('.family-generations text')].map(
      (t) => t.textContent
    );
    expect(labels).toEqual(['Gen I', 'Gen II', 'Gen III']);
  });

  it('draws no gutter when the option is absent', () => {
    const svg = render(`family
A + B
  C`);
    expect(svg.querySelector('.family-generations')).toBeNull();
    expect(svg.querySelector('.family-generation-bands')).toBeNull();
  });

  it('shades alternating generations with subtle zebra bands, behind everything', () => {
    const svg = render(`family
generations
A + B
  C + D
    E + F
      G`);
    const bands = svg.querySelectorAll('.family-generation-bands rect');
    expect(bands.length).toBe(2); // 4 rows → every other → 2 bands
    const root = svg.querySelector('g[transform*="scale"]')!;
    expect(root.children[0]!.getAttribute('class')).toBe(
      'family-generation-bands'
    );
  });
});

// ── 5. Unknown `?` placeholder ──────────────────────────────
describe('family — anonymous `?` placeholder', () => {
  it('makes each `?` a distinct, unmerged person', () => {
    const p = parseFamily(`family
? + Anne
  Kid
? + Bea
  Kid2`);
    const placeholders = [...p.persons.values()].filter((x) => x.placeholder);
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]!.id).not.toBe(placeholders[1]!.id);
  });

  it('renders a faint, name-only `?` card with a SOLID (not dashed) border', () => {
    const svg = render(`family
? + Anne
  Kid`);
    const cards = [...svg.querySelectorAll('.family-card')];
    const ph = cards.find((c) => c.querySelector('text')?.textContent === '?')!;
    const rect = ph.querySelector('rect')!;
    // Solid border — dashing is reserved for adoption/divorce edges.
    expect(rect.getAttribute('stroke-dasharray')).toBeNull();
    expect(rect.getAttribute('stroke')).toBeTruthy();
    // No focus dot-target on a placeholder.
    expect(ph.querySelector('.family-focus-icon')).toBeNull();
  });
});

// ── 6. Lineage highlight ────────────────────────────────────
describe('family — `highlight <name>` bloodline dimming', () => {
  const SRC = `family
highlight Ned

Jack + Grace
  Ned
  Mabel
Ned + Anne
  Tom`;

  it('dims everyone outside the named person’s bloodline, keeps the line lit', () => {
    const parsed = parseFamily(SRC);
    const layout = layoutFamily(parsed);
    const dim = (id: string): boolean =>
      !!layout.nodes.find((n) => n.id === id)?.dimmed;
    // Bloodline of Ned: his ancestors (Jack, Grace), descendants (Tom),
    // and spouse (Anne) stay lit.
    expect(dim('ned')).toBe(false);
    expect(dim('jack')).toBe(false);
    expect(dim('grace')).toBe(false);
    expect(dim('tom')).toBe(false);
    expect(dim('anne')).toBe(false);
    // Collateral relative (Ned’s sibling) is dimmed.
    expect(dim('mabel')).toBe(true);
  });

  it('fades the dimmed cards in the SVG', () => {
    const svg = render(SRC);
    const faded = [...svg.querySelectorAll('.family-card')].filter(
      (c) => c.getAttribute('opacity') === '0.28'
    );
    expect(faded.length).toBeGreaterThanOrEqual(1);
  });

  it('backs each dimmed card with an opaque occluder so no line bleeds through', () => {
    const svg = render(SRC);
    const faded = [...svg.querySelectorAll('.family-card')].filter(
      (c) => c.getAttribute('opacity') === '0.28'
    ).length;
    const occ = svg.querySelectorAll('.family-dim-occluders rect');
    expect(occ.length).toBe(faded);
    // opaque (no opacity attr) and drawn before the cards so it occludes edges
    expect([...occ].every((r) => r.getAttribute('opacity') === null)).toBe(
      true
    );
  });

  it('warns and dims nothing when the target is unknown', () => {
    expect(
      codes(`family
highlight Ghost

Anne + Bob`)
    ).toContain('W_FAMILY_HIGHLIGHT_UNKNOWN');
    const layout = layoutFamily(
      parseFamily(`family
highlight Ghost

Anne + Bob`)
    );
    expect(layout.nodes.every((n) => !n.dimmed)).toBe(true);
  });
});
