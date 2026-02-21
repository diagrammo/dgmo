import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseOrg } from '../src/org/parser';
import { layoutOrg } from '../src/org/layout';
import type { OrgLayoutResult } from '../src/org/layout';
import { renderOrgForExport, renderOrg } from '../src/org/renderer';
import { collapseOrgTree } from '../src/org/collapse';
import { getPalette } from '../src/palettes';

// Set up jsdom globals
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

const palette = getPalette('nord');

// ============================================================
// layoutOrg
// ============================================================

describe('layoutOrg', () => {
  it('positions a single root node', () => {
    const parsed = parseOrg('chart: org\nAlice');
    const layout = layoutOrg(parsed);

    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].label).toBe('Alice');
    expect(layout.nodes[0].x).toBeGreaterThan(0);
    expect(layout.nodes[0].y).toBeGreaterThan(0);
    expect(layout.nodes[0].width).toBeGreaterThanOrEqual(140);
    expect(layout.nodes[0].height).toBeGreaterThan(0);
    expect(layout.edges).toHaveLength(0);
  });

  it('arranges parent-child in separate rows', () => {
    const parsed = parseOrg('chart: org\nAlice\n  Bob');
    const layout = layoutOrg(parsed);

    expect(layout.nodes).toHaveLength(2);
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    expect(bob.y).toBeGreaterThan(alice.y);
  });

  it('creates elbow edges between parent and child', () => {
    const parsed = parseOrg('chart: org\nAlice\n  Bob');
    const layout = layoutOrg(parsed);

    expect(layout.edges).toHaveLength(1);
    const edge = layout.edges[0];
    expect(edge.sourceId).toBe('node-1');
    expect(edge.targetId).toBe('node-2');
    expect(edge.points).toHaveLength(4);
    // Elbow: vertical down, horizontal, vertical down
    expect(edge.points[0].y).toBeLessThan(edge.points[3].y);
  });

  it('handles multiple roots with virtual root', () => {
    const parsed = parseOrg('chart: org\nAlice\nBob');
    const layout = layoutOrg(parsed);

    expect(layout.nodes).toHaveLength(2);
    // Both should be on the same row
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    expect(alice.y).toBe(bob.y);
    // No edges (virtual root edges are excluded)
    expect(layout.edges).toHaveLength(0);
  });

  it('computes card width from label and metadata', () => {
    const parsed = parseOrg(
      'chart: org\nAlice Park | role: Senior Software Engineer'
    );
    const layout = layoutOrg(parsed);

    const node = layout.nodes[0];
    // Should be wider than MIN_CARD_WIDTH due to long metadata
    expect(node.width).toBeGreaterThan(140);
  });

  it('computes card height from metadata count', () => {
    const parsed = parseOrg(
      'chart: org\nAlice\n  role: Engineer\n  location: NY'
    );
    const layout = layoutOrg(parsed);

    const node = layout.nodes[0];
    // Height should account for header + 2 metadata rows
    expect(node.height).toBeGreaterThan(40);
  });

  it('does not color nodes from tag groups (legend only)', () => {
    const content = `chart: org

## Location
  NY(blue)
  LA(yellow)

Alice
  location: NY
Bob
  location: LA`;
    const parsed = parseOrg(content, palette.light);
    const layout = layoutOrg(parsed);

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    // Tag groups drive legend only, not node colors
    expect(alice.color).toBeUndefined();
    expect(bob.color).toBeUndefined();
  });

  it('resolves explicit node colors', () => {
    const content = `chart: org
Alice(red)
Bob`;
    const parsed = parseOrg(content, palette.light);
    const layout = layoutOrg(parsed);

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    expect(alice.color).toBeTruthy();
    expect(bob.color).toBeUndefined();
  });

  it('computes container bounds for containers with children', () => {
    const parsed = parseOrg(
      'chart: org\n[Engineering]\n  Alice\n  Bob'
    );
    const layout = layoutOrg(parsed);

    expect(layout.containers).toHaveLength(1);
    const c = layout.containers[0];
    expect(c.label).toBe('Engineering');
    expect(c.width).toBeGreaterThan(0);
    expect(c.height).toBeGreaterThan(0);
    // Box should encompass children
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    expect(c.x).toBeLessThanOrEqual(alice.x - alice.width / 2);
    expect(c.x + c.width).toBeGreaterThanOrEqual(bob.x + bob.width / 2);
  });

  it('creates container bounds for childless containers', () => {
    const parsed = parseOrg('chart: org\n[Empty Team]');
    const layout = layoutOrg(parsed);

    expect(layout.containers).toHaveLength(1);
    expect(layout.containers[0].label).toBe('Empty Team');
  });

  it('creates nested container bounds', () => {
    const parsed = parseOrg(
      '[Engineering]\n  [Platform]\n    Alice\n  [Frontend]\n    Bob'
    );
    const layout = layoutOrg(parsed);

    // Engineering + Platform + Frontend (all have children)
    expect(layout.containers).toHaveLength(3);
    const eng = layout.containers.find((c) => c.label === 'Engineering')!;
    const plat = layout.containers.find((c) => c.label === 'Platform')!;
    expect(eng).toBeDefined();
    expect(plat).toBeDefined();
    // Engineering box should be larger than Platform box
    expect(eng.width).toBeGreaterThanOrEqual(plat.width);
  });

  it('returns empty result for empty input', () => {
    const parsed = parseOrg('chart: org');
    const layout = layoutOrg(parsed);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.containers).toHaveLength(0);
  });

  it('produces positive width and height', () => {
    const parsed = parseOrg('chart: org\nAlice\n  Bob\n  Carol');
    const layout = layoutOrg(parsed);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// ============================================================
// renderOrgForExport
// ============================================================

describe('renderOrgForExport', () => {
  const basicInput = `chart: org
title: Test Org

Alice
  role: CEO
  Bob
    role: CTO`;

  it('produces valid SVG', () => {
    const svg = renderOrgForExport(basicInput, 'light', palette.light);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders in dark theme', () => {
    const svg = renderOrgForExport(basicInput, 'dark', palette.dark);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders in transparent theme', () => {
    const svg = renderOrgForExport(basicInput, 'transparent', palette.light);
    expect(svg).toContain('<svg');
    expect(svg).toContain('background: none');
  });

  it('returns empty string for error input', () => {
    const svg = renderOrgForExport('', 'light', palette.light);
    expect(svg).toBe('');
  });

  it('renders containers with children as background boxes', () => {
    const input = `chart: org
Alice
  [Platform Team]
    Bob`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    expect(svg).toContain('org-container');
    // Container children rendered as normal cards, not the container itself
    expect(svg).toContain('Bob');
  });

  it('renders childless containers as container boxes', () => {
    const input = `chart: org
Alice
  [Empty Team]`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    expect(svg).toContain('org-container');
    expect(svg).toContain('Empty Team');
  });

  it('renders metadata text', () => {
    const svg = renderOrgForExport(basicInput, 'light', palette.light);
    expect(svg).toContain('CEO');
    expect(svg).toContain('CTO');
  });

  it('renders tag group names with original casing as display labels', () => {
    const input = `## Title alias t
  CTO(purple)

## Location alias loc
  NY(blue)

Sean Curtis| t: CTO, loc: NY`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    // Should show "Title: " and "Location: " (original group casing), not "title: " or "t: "
    expect(svg).toContain('Title: ');
    expect(svg).toContain('Location: ');
    expect(svg).not.toContain('>t: <');
    expect(svg).not.toContain('>loc: <');
  });

  it('includes data-line-number attributes', () => {
    const svg = renderOrgForExport(basicInput, 'light', palette.light);
    expect(svg).toContain('data-line-number');
  });

  it('renders title', () => {
    const svg = renderOrgForExport(basicInput, 'light', palette.light);
    expect(svg).toContain('Test Org');
  });

  it('renders edges as paths', () => {
    const svg = renderOrgForExport(basicInput, 'light', palette.light);
    expect(svg).toContain('org-edge');
  });
});

// ============================================================
// Collapse interactivity attributes
// ============================================================

describe('collapse attributes in rendered SVG', () => {
  it('adds data-node-toggle on nodes with children', () => {
    const content = `chart: org
Alice
  Bob
  Carol`;
    const parsed = parseOrg(content, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    // Need to set client dimensions for renderOrg
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    const svg = container.innerHTML;
    expect(svg).toContain('data-node-toggle');
    expect(svg).toContain('aria-expanded="true"');
    expect(svg).toContain('role="button"');
  });

  it('does not add data-node-toggle on leaf nodes', () => {
    const content = `chart: org\nAlice`;
    const parsed = parseOrg(content, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    const svg = container.innerHTML;
    expect(svg).not.toContain('data-node-toggle');
  });

  it('renders +N badge on collapsed nodes', () => {
    const content = `chart: org
Alice
  Bob
  Carol`;
    const parsed = parseOrg(content, palette.light);
    const aliceId = parsed.roots[0].id;
    const { parsed: collapsed, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([aliceId])
    );
    const layout = layoutOrg(collapsed, hiddenCounts);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, collapsed, layout, palette.light, false);

    const svg = container.innerHTML;
    expect(svg).toContain('org-collapse-badge');
    expect(svg).toContain('+2');
    expect(svg).toContain('aria-expanded="false"');
  });

  it('adds data-node-toggle on containers with children', () => {
    const content = `chart: org
[Engineering]
  Alice
  Bob`;
    const parsed = parseOrg(content, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    const svg = container.innerHTML;
    // Container should have toggle
    expect(svg).toContain('data-node-toggle');
  });
});

// ============================================================
// Legend
// ============================================================

describe('legend rendering', () => {
  it('renders legend when tag groups exist', () => {
    const input = `chart: org

## Location
  NY(blue)
  LA(yellow)

Alice
  location: NY
Bob
  location: LA`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    expect(svg).toContain('org-legend-group');
  });

  it('does not render legend when no tag groups defined', () => {
    const input = `chart: org
Alice
  Bob`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    expect(svg).not.toContain('org-legend-group');
  });

  it('shows group names in legend', () => {
    const input = `chart: org

## Location
  NY(blue)
  LA(yellow)

## Status
  FTE(green)

Alice | location: NY, status: FTE`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    // Two legend groups
    const matches = svg.match(/org-legend-group/g);
    expect(matches).toHaveLength(2);
    // Group names rendered as headers
    expect(svg).toContain('>Location<');
    expect(svg).toContain('>Status<');
  });

  it('shows entry values with colored indicators', () => {
    const input = `chart: org

## Location
  NY(blue)
  LA(yellow)

Alice | location: NY`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    // Entry values rendered
    expect(svg).toContain('>NY<');
    expect(svg).toContain('>LA<');
    // Colored circles (indicators)
    expect(svg).toContain('<circle');
  });

  it('activeTagGroup colors nodes from matching tag entries', () => {
    const input = `chart: org

## Location
  NY(blue)
  LA(yellow)

Alice
  location: NY
Bob
  location: LA`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    // Should have colors resolved from the Location group
    expect(alice.color).toBeTruthy();
    expect(bob.color).toBeTruthy();
    // Colors should differ (NY=blue, LA=yellow)
    expect(alice.color).not.toBe(bob.color);
  });

  it('explicit node (color) is not overridden by activeTagGroup', () => {
    const input = `chart: org

## Location
  NY(blue)

Alice(red)
  location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    // Explicit red wins over tag group blue
    expect(alice.color).toBeTruthy();
    // Should be the parsed red color, not a blue-ish one
    expect(alice.color).toBe(parsed.roots[0].color);
  });

  it('nodes without matching metadata get gray when activeTagGroup set', () => {
    const input = `chart: org

## Location
  NY(blue)

Alice
  location: NY
Bob`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    expect(alice.color).toBeTruthy();
    expect(bob.color).toBe('#999999');
  });

  it('nodes without metadata get default tag group color when activeTagGroup set', () => {
    const input = `chart: org

## Location
  NY(blue)
  CO(green) default

Alice
  location: NY
Bob`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    // Alice has explicit location: NY → blue
    expect(alice.color).toBeTruthy();
    // Bob has no location metadata → falls back to default CO → green
    expect(bob.color).toBeTruthy();
    expect(alice.color).not.toBe(bob.color);
  });

  it('nodes display default metadata values from tag groups', () => {
    const input = `chart: org

## Location
  NY(blue)
  CO(green) default

## Status
  FTE(green) default
  Contractor(orange)

Alice
  location: NY
Bob`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    // Alice has explicit location, should keep it; gets default status
    expect(alice.metadata['location']).toBe('NY');
    expect(alice.metadata['status']).toBe('FTE');
    // Bob has no metadata, should get both defaults
    expect(bob.metadata['location']).toBe('CO');
    expect(bob.metadata['status']).toBe('FTE');
  });

  it('default metadata does not override explicit values', () => {
    const input = `chart: org

## Location
  NY(blue)
  CO(green) default

Alice
  location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    expect(alice.metadata['location']).toBe('NY');
  });

  it('containers do not get default metadata', () => {
    const input = `chart: org

## Status
  FTE(green) default

[Engineering]
  Alice`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const eng = layout.containers.find((c) => c.label === 'Engineering')!;
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    expect(eng.metadata['status']).toBeUndefined();
    expect(alice.metadata['status']).toBe('FTE');
  });

  it('containers do not get default tag group color', () => {
    const input = `chart: org

## Location
  NY(blue)
  CO(green) default

[Engineering]
  Alice
    location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const eng = layout.containers.find((c) => c.label === 'Engineering')!;
    // Alice gets NY blue
    expect(alice.color).toBeTruthy();
    // Container should NOT get default CO green — gets gray fallback instead
    expect(eng.color).toBe('#999999');
  });

  it('explicit metadata wins over default tag group value', () => {
    const input = `chart: org

## Location
  NY(blue)
  CO(green) default

Alice
  location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    // Alice explicitly has NY, not the default CO
    const nyEntry = parsed.tagGroups[0].entries.find(e => e.value === 'NY')!;
    expect(alice.color).toBe(nyEntry.color);
  });

  it('includes legend in layout dimensions (bottom position)', () => {
    const withGroups = `chart: org
legend-position: bottom

## Location
  NY(blue)

Alice | location: NY`;
    const withoutGroups = `chart: org
Alice`;
    const parsedWith = parseOrg(withGroups, palette.light);
    const layoutWith = layoutOrg(parsedWith);
    const parsedWithout = parseOrg(withoutGroups, palette.light);
    const layoutWithout = layoutOrg(parsedWithout);

    // Layout with legend should have legend groups
    expect(layoutWith.legend).toHaveLength(1);
    expect(layoutWith.legend[0].name).toBe('Location');
    // Layout without tag groups should have empty legend
    expect(layoutWithout.legend).toHaveLength(0);
    // Bottom legend adds to height — legend Y is below content
    expect(layoutWith.height).toBeGreaterThan(layoutWith.legend[0].y);
  });

  it('places legend at top-right by default', () => {
    const input = `chart: org

## Location
  NY(blue)
  LA(yellow)

## Status
  FTE(green)

Alice | location: NY, status: FTE`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    // Legend should be at top-right: all groups share same X, stacked vertically
    expect(layout.legend.length).toBeGreaterThanOrEqual(2);
    const [first, second] = layout.legend;
    // Same X (both at top-right)
    expect(first.x).toBe(second.x);
    // Stacked vertically: second below first
    expect(second.y).toBeGreaterThan(first.y);
    // Y starts at MARGIN (40)
    expect(first.y).toBe(40);
  });

  it('top legend does not add to height when shorter than content', () => {
    const input = `chart: org

## Location
  NY(blue)

Alice
  Bob
    Carol
      Dave`;
    const withoutLegend = `chart: org
Alice
  Bob
    Carol
      Dave`;
    const parsedWith = parseOrg(input, palette.light);
    const layoutWith = layoutOrg(parsedWith);
    const parsedWithout = parseOrg(withoutLegend, palette.light);
    const layoutWithout = layoutOrg(parsedWithout);

    // Top legend is short (1 group) and the content is deep (4 levels)
    // So legend should NOT increase diagram height
    expect(layoutWith.height).toBe(layoutWithout.height);
  });

  it('legend groups have data-legend-group attributes', () => {
    const input = `chart: org

## Location
  NY(blue)
  LA(yellow)

Alice | location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    const legendGroups = container.querySelectorAll('[data-legend-group]');
    expect(legendGroups).toHaveLength(1);
    expect(legendGroups[0].getAttribute('data-legend-group')).toBe('location');
  });

  it('only active legend group is rendered when activeTagGroup set', () => {
    const input = `chart: org

## Location
  NY(blue)

## Status
  FTE(green)

Alice | location: NY, status: FTE`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container, parsed, layout, palette.light, false,
      undefined, undefined, 'location'
    );

    const legendGroups = container.querySelectorAll('[data-legend-group]');
    expect(legendGroups).toHaveLength(1);
    expect(legendGroups[0].getAttribute('data-legend-group')).toBe('location');
  });

  it('all legend groups rendered when no activeTagGroup', () => {
    const input = `chart: org

## Location
  NY(blue)

## Status
  FTE(green)

Alice | location: NY, status: FTE`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    const legendGroups = container.querySelectorAll('[data-legend-group]');
    expect(legendGroups).toHaveLength(2);
  });

  it('active legend group has distinct border styling', () => {
    const input = `chart: org

## Location
  NY(blue)
  LA(yellow)

Alice | location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container, parsed, layout, palette.light, false,
      undefined, undefined, 'location'
    );

    const legendGroup = container.querySelector('[data-legend-group="location"]');
    expect(legendGroup).toBeTruthy();
    const rect = legendGroup!.querySelector('rect');
    expect(rect).toBeTruthy();
    // Active group should have stroke-width of 2
    expect(rect!.getAttribute('stroke-width')).toBe('2');
    // Active group should use palette.primary as stroke
    expect(rect!.getAttribute('stroke')).toBe(palette.light.primary);
  });
});

// ============================================================
// Visibility toggles (hiddenAttributes)
// ============================================================

describe('hiddenAttributes visibility', () => {
  const input = `chart: org

## Location
  NY(blue)
  LA(yellow)

## Status
  FTE(green)

Alice
  location: NY
  status: FTE
Bob
  location: LA
  status: FTE`;

  it('cards shrink when attributes are hidden', () => {
    const parsed = parseOrg(input, palette.light);
    const fullLayout = layoutOrg(parsed);
    const hiddenLayout = layoutOrg(parsed, undefined, undefined, new Set(['location']));

    const aliceFull = fullLayout.nodes.find((n) => n.label === 'Alice')!;
    const aliceHidden = hiddenLayout.nodes.find((n) => n.label === 'Alice')!;
    // Height should decrease when one attribute is hidden
    expect(aliceHidden.height).toBeLessThan(aliceFull.height);
  });

  it('hiding all attributes produces header-only cards', () => {
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(
      parsed,
      undefined,
      undefined,
      new Set(['location', 'status'])
    );

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    // No metadata → height = HEADER_HEIGHT + CARD_V_PAD = 28 + 10 = 38
    expect(alice.height).toBe(38);
    expect(Object.keys(alice.metadata)).toHaveLength(0);
  });

  it('hidden defaults still exist on orgNode but filtered from layout', () => {
    const inputWithDefaults = `chart: org

## Status
  FTE(green) default

Alice`;
    const parsed = parseOrg(inputWithDefaults, palette.light);
    const layout = layoutOrg(
      parsed,
      undefined,
      undefined,
      new Set(['status'])
    );

    // The orgNode still has the default injected
    expect(parsed.roots[0].metadata['status']).toBe('FTE');
    // But the layout node has it filtered out
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    expect(alice.metadata['status']).toBeUndefined();
  });

  it('container metadata is also filtered', () => {
    const containerInput = `chart: org

## Status
  FTE(green)

[Engineering]
  status: FTE
  Alice`;
    const parsed = parseOrg(containerInput, palette.light);
    const layout = layoutOrg(
      parsed,
      undefined,
      undefined,
      new Set(['status'])
    );

    const eng = layout.containers.find((c) => c.label === 'Engineering')!;
    expect(eng.metadata['status']).toBeUndefined();
  });

  it('eye icon renders when hiddenAttributes provided', () => {
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, undefined, new Set());

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container, parsed, layout, palette.light, false,
      undefined, undefined, undefined, new Set()
    );

    const eyeIcons = container.querySelectorAll('.org-legend-eye');
    expect(eyeIcons.length).toBeGreaterThanOrEqual(2);
  });

  it('no eye icon when hiddenAttributes not provided', () => {
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    const eyeIcons = container.querySelectorAll('.org-legend-eye');
    expect(eyeIcons).toHaveLength(0);
  });

  it('closed eye path when attribute is hidden', () => {
    const parsed = parseOrg(input, palette.light);
    const hidden = new Set(['location']);
    const layout = layoutOrg(parsed, undefined, undefined, hidden);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container, parsed, layout, palette.light, false,
      undefined, undefined, undefined, hidden
    );

    const locationEye = container.querySelector(
      '[data-legend-visibility="location"]'
    );
    expect(locationEye).toBeTruthy();
    // Hidden attribute has a slash line instead of pupil circle
    const slashLine = locationEye!.querySelector('line');
    expect(slashLine).toBeTruthy();
    const pupilCircle = locationEye!.querySelector('circle');
    expect(pupilCircle).toBeNull();

    // Status eye should be open (has pupil, no slash)
    const statusEye = container.querySelector(
      '[data-legend-visibility="status"]'
    );
    expect(statusEye).toBeTruthy();
    const statusPupil = statusEye!.querySelector('circle');
    expect(statusPupil).toBeTruthy();
  });

  it('no eye icons in export', () => {
    const parsed = parseOrg(input, palette.light);
    const hidden = new Set(['location']);
    const layout = layoutOrg(parsed, undefined, undefined, hidden);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container, parsed, layout, palette.light, false,
      undefined, { width: 800, height: 600 }, undefined, hidden
    );

    const eyeIcons = container.querySelectorAll('.org-legend-eye');
    expect(eyeIcons).toHaveLength(0);
  });

  it('export respects DSL hide option', () => {
    const exportInput = `chart: org
hide: location

## Location
  NY(blue)

## Status
  FTE(green)

Alice
  location: NY
  status: FTE`;
    const svg = renderOrgForExport(exportInput, 'light', palette.light);
    expect(svg).toContain('<svg');
    // Location should be filtered out from card metadata
    // Status should still be visible
    expect(svg).toContain('>FTE<');
    // No eye icons in export
    expect(svg).not.toContain('org-legend-eye');
  });
});
