import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseOrg } from '../src/org/parser';
import { layoutOrg } from '../src/org/layout';
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
    const parsed = parseOrg('org\nAlice');
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
    const parsed = parseOrg('org\nAlice\n  Bob');
    const layout = layoutOrg(parsed);

    expect(layout.nodes).toHaveLength(2);
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    expect(bob.y).toBeGreaterThan(alice.y);
  });

  it('creates elbow edges between parent and child', () => {
    const parsed = parseOrg('org\nAlice\n  Bob');
    const layout = layoutOrg(parsed);

    expect(layout.edges).toHaveLength(1);
    const edge = layout.edges[0];
    expect(edge.sourceId).toBe('node-1');
    expect(edge.targetId).toBe('node-2');
    expect(edge.points).toHaveLength(4);
    // Elbow: vertical down, horizontal, vertical down
    expect(edge.points[0].y).toBeLessThan(edge.points[3].y);
  });

  it('uses bus pattern for multiple children (no overlapping edges)', () => {
    const parsed = parseOrg('org\nAlice\n  Bob\n  Carol\n  Dave');
    const layout = layoutOrg(parsed);

    // Bus pattern: 1 trunk + 1 horizontal bus + 3 drops = 5 edges
    expect(layout.edges).toHaveLength(5);

    const trunk = layout.edges[0];
    expect(trunk.points).toHaveLength(2);
    // Trunk is vertical (same x)
    expect(trunk.points[0].x).toBe(trunk.points[1].x);
    expect(trunk.points[0].y).toBeLessThan(trunk.points[1].y);

    const bus = layout.edges[1];
    expect(bus.points).toHaveLength(2);
    // Bus is horizontal (same y)
    expect(bus.points[0].y).toBe(bus.points[1].y);
    expect(bus.points[0].x).toBeLessThan(bus.points[1].x);

    // Drops: each has 2 points, vertical
    for (let i = 2; i < 5; i++) {
      const drop = layout.edges[i];
      expect(drop.points).toHaveLength(2);
      expect(drop.points[0].x).toBe(drop.points[1].x);
      expect(drop.points[0].y).toBeLessThan(drop.points[1].y);
    }
  });

  it('centers parent exactly between direct children', () => {
    const parsed = parseOrg('org\nAlice\n  Bob\n  Carol\n  Dave\n  Eve');
    const layout = layoutOrg(parsed);

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const children = ['Bob', 'Carol', 'Dave', 'Eve'].map(
      (name) => layout.nodes.find((n) => n.label === name)!
    );
    const leftmost = children.reduce((a, b) => (a.x < b.x ? a : b));
    const rightmost = children.reduce((a, b) => (a.x > b.x ? a : b));

    // Alice's center X should be exactly midpoint of leftmost and rightmost child
    const expectedX =
      (leftmost.x + leftmost.width / 2 + rightmost.x + rightmost.width / 2) / 2;
    expect(alice.x + alice.width / 2).toBeCloseTo(expectedX, 1);
  });

  it('handles multiple roots with virtual root', () => {
    const parsed = parseOrg('org\nAlice\nBob');
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
    const parsed = parseOrg('org\nAlice Park | role: Senior Software Engineer');
    const layout = layoutOrg(parsed);

    const node = layout.nodes[0];
    // Should be wider than MIN_CARD_WIDTH due to long metadata
    expect(node.width).toBeGreaterThan(140);
  });

  it('computes card height from metadata count', () => {
    const parsed = parseOrg('org\nAlice\n  role: Engineer\n  location: NY');
    const layout = layoutOrg(parsed);

    const node = layout.nodes[0];
    // Height should account for header + 2 metadata rows
    expect(node.height).toBeGreaterThan(40);
  });

  it('does not color nodes from tag groups (legend only)', () => {
    const content = `org

tag Location
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
    const content = `org
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
    const parsed = parseOrg('org\n[Engineering]\n  Alice\n  Bob');
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
    const parsed = parseOrg('org\n[Empty Team]');
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
    const parsed = parseOrg('org');
    const layout = layoutOrg(parsed);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.containers).toHaveLength(0);
  });

  it('places heaviest subtrees in center positions', () => {
    const parsed = parseOrg(
      'org\n' +
        'Boss\n' +
        '  Alice\n' +
        '  Bob\n' +
        '    B1\n' +
        '      B1a\n' +
        '        B1a1\n' +
        '  Carol\n'
    );
    const layout = layoutOrg(parsed);
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    const carol = layout.nodes.find((n) => n.label === 'Carol')!;

    // Bob (heaviest) should be between Alice and Carol (center position)
    expect(bob.x).toBeGreaterThan(Math.min(alice.x, carol.x));
    expect(bob.x).toBeLessThan(Math.max(alice.x, carol.x));
  });

  it('produces positive width and height', () => {
    const parsed = parseOrg('org\nAlice\n  Bob\n  Carol');
    const layout = layoutOrg(parsed);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// ============================================================
// renderOrgForExport
// ============================================================

describe('renderOrgForExport', () => {
  const basicInput = `org Test Org

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
    const input = `org
Alice
  [Platform Team]
    Bob`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    expect(svg).toContain('org-container');
    // Container children rendered as normal cards, not the container itself
    expect(svg).toContain('Bob');
  });

  it('renders childless containers as container boxes', () => {
    const input = `org
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
    const input = `tag Title t
  CTO(purple)

tag Location loc
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
    const content = `org
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
    const content = `org\nAlice`;
    const parsed = parseOrg(content, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    const svg = container.innerHTML;
    expect(svg).not.toContain('data-node-toggle');
  });

  it('renders collapsed accent bar (not metadata row)', () => {
    const content = `org
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
    // No metadata row for hidden count
    expect(svg).not.toContain('Sub-node Count');
    // Accent bar rendered instead
    expect(svg).toContain('org-collapse-bar');
    expect(svg).toContain('aria-expanded="false"');
  });

  it('collapsed nodes use hiddenCount instead of custom sub-node-label metadata', () => {
    const content = `org
sub-node-label Direct Reports
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

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    // Collapsed nodes no longer inject count as metadata
    expect(alice.metadata['Direct Reports']).toBeUndefined();
    // Instead, hiddenCount is set for the renderer to draw a chevron indicator
    expect(alice.hiddenCount).toBe(2);
  });

  it('shows sub-node count on all nodes when show-sub-node-count', () => {
    const content = `org
show-sub-node-count yes
sub-node-label Reports
Alice
  Bob
    Charlie
  Carol`;
    const parsed = parseOrg(content, palette.light);
    const layout = layoutOrg(parsed);

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    // Bob(+Charlie) + Carol = 3 descendants
    expect(alice.metadata['Reports']).toBe('3');

    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    expect(bob.metadata['Reports']).toBe('1');

    // Leaf nodes should not have the count
    const carol = layout.nodes.find((n) => n.label === 'Carol')!;
    expect(carol.metadata['Reports']).toBeUndefined();
  });

  it('sub-node count includes collapsed descendants for expanded nodes only', () => {
    const content = `org
show-sub-node-count yes
sub-node-label Reports
Alice
  Bob
    Charlie
    Dave
  Carol`;
    const parsed = parseOrg(content, palette.light);
    const bobId = parsed.roots[0].children[0].id;
    const { parsed: collapsed, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([bobId])
    );
    const layout = layoutOrg(collapsed, hiddenCounts);

    // Alice is expanded: Bob(1) + Bob's hidden(Charlie+Dave=2) + Carol(1) = 4
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    expect(alice.metadata['Reports']).toBe('4');

    // Bob is collapsed: no metadata row, uses hiddenCount instead
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    expect(bob.metadata['Reports']).toBeUndefined();
    expect(bob.hiddenCount).toBe(2);
  });

  it('adds data-node-toggle on containers with children', () => {
    const content = `org
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

  it('collapsed node with container-only children retains data-node-toggle', () => {
    // Reproduces the Anne Bonny scenario: a node whose only children are containers
    const content = `org
Boss
  Manager
    [Team A]
      Alice
      Bob
    [Team B]
      Carol`;
    const parsed = parseOrg(content, palette.light);
    // Manager is node-2, has only container children
    const managerId = parsed.roots[0].children[0].id;
    expect(managerId).toBe('node-2');

    // Collapse Manager
    const { parsed: collapsed, hiddenCounts } = collapseOrgTree(
      parsed,
      new Set([managerId])
    );
    expect(hiddenCounts.get(managerId)).toBe(3); // Alice + Bob + Carol

    const layout = layoutOrg(collapsed, hiddenCounts);

    // Manager should be in layout nodes with hasChildren
    const managerNode = layout.nodes.find((n) => n.id === managerId);
    expect(managerNode).toBeDefined();
    expect(managerNode!.hasChildren).toBe(true);
    expect(managerNode!.hiddenCount).toBe(3);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, collapsed, layout, palette.light, false);

    const svg = container.innerHTML;
    // Collapsed Manager should have toggle attribute and collapse bar
    expect(svg).toContain(`data-node-toggle="${managerId}"`);
    expect(svg).toContain('org-collapse-bar');
    expect(svg).toContain('aria-expanded="false"');
  });
});

// ============================================================
// Legend
// ============================================================

describe('legend rendering', () => {
  it('renders legend in export mode', () => {
    const input = `org

tag Location
  NY(blue)
  LA(yellow)

Alice
  location: NY
Bob
  location: LA`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    expect(svg).toContain('data-legend-group');
    expect(svg).toContain('Location');
  });

  it('does not render legend when no tag groups defined', () => {
    const input = `org
Alice
  Bob`;
    const svg = renderOrgForExport(input, 'light', palette.light);
    expect(svg).not.toContain('data-legend-group');
  });

  it('shows group names in legend (interactive)', () => {
    const input = `org

tag Location
  NY(blue)
  LA(yellow)

tag Status
  FTE(green)

Alice | location: NY, status: FTE`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);
    const svg = container.innerHTML;

    // Two legend groups
    const matches = svg.match(/data-legend-group/g);
    expect(matches).toHaveLength(2);
    // Group names rendered as headers
    expect(svg).toContain('>Location<');
    expect(svg).toContain('>Status<');
  });

  it('shows entry values with colored indicators (interactive)', () => {
    const input = `org

tag Location
  NY(blue)
  LA(yellow)

Alice | location: NY
Bob | location: LA`;
    const parsed = parseOrg(input, palette.light);
    // Need activeTagGroup to render the group fully (with entries)
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'location'
    );
    const svg = container.innerHTML;

    // Entry values rendered (only values used by nodes)
    expect(svg).toContain('>NY<');
    expect(svg).toContain('>LA<');
    // Colored circles (indicators)
    expect(svg).toContain('<circle');
  });

  it('omits unused tag group values from legend', () => {
    const input = `org

tag Location
  NY(blue)
  LA(yellow)

Alice | location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'location'
    );
    const svg = container.innerHTML;

    // NY is used by Alice, LA is not used by any node
    expect(svg).toContain('>NY<');
    expect(svg).not.toContain('>LA<');
  });

  it('activeTagGroup colors nodes from matching tag entries', () => {
    const input = `org

tag Location
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
    const input = `org

tag Location
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

  it('nodes without explicit metadata get default (first entry) tag color when activeTagGroup set', () => {
    const input = `org

tag Location
  NY(blue)

Alice
  location: NY
Bob`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    const bob = layout.nodes.find((n) => n.label === 'Bob')!;
    // Both get NY's color — Alice explicitly, Bob via first-entry default
    expect(alice.color).toBeTruthy();
    expect(bob.color).toBe(alice.color);
  });

  it('nodes without metadata get default tag group color when activeTagGroup set', () => {
    const input = `org

tag Location
  CO(green)
  NY(blue)

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
    const input = `org

tag Location
  CO(green)
  NY(blue)

tag Status
  FTE(green)
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
    const input = `org

tag Location
  CO(green)
  NY(blue)

Alice
  location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    expect(alice.metadata['location']).toBe('NY');
  });

  it('containers do not get default metadata', () => {
    const input = `org

tag Status
  FTE(green)

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
    const input = `org

tag Location
  CO(green)
  NY(blue)

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
    const input = `org

tag Location
  CO(green)
  NY(blue)

Alice
  location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    // Alice explicitly has NY, not the default CO
    const nyEntry = parsed.tagGroups[0].entries.find((e) => e.value === 'NY')!;
    expect(alice.color).toBe(nyEntry.color);
  });

  it('places legend at top-left', () => {
    const input = `org

tag Location
  NY(blue)
  LA(yellow)

tag Status
  FTE(green)

Alice | location: NY, status: FTE`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    // Legend should be at top-left: groups in a horizontal row
    expect(layout.legend.length).toBeGreaterThanOrEqual(2);
    const [first, second] = layout.legend;
    // Same Y (both on same row)
    expect(first.y).toBe(second.y);
    // Laid out horizontally: second to the right of first
    expect(second.x).toBeGreaterThan(first.x);
    // X starts at MARGIN (40), Y starts at MARGIN (40)
    expect(first.x).toBe(40);
    expect(first.y).toBe(40);
  });

  it('legend adds height and shifts content down', () => {
    const input = `org

tag Location
  NY(blue)

Alice | location: NY
  Bob | location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    // Legend should exist and be positioned at top
    expect(layout.legend).toHaveLength(1);
    expect(layout.legend[0].y).toBe(40); // MARGIN
    // First node should be pushed down by LEGEND_HEIGHT (28) + LEGEND_GROUP_GAP (12)
    expect(layout.nodes[0].y).toBeGreaterThanOrEqual(40 + 28 + 12);
  });

  it('legend groups have data-legend-group attributes', () => {
    const input = `org

tag Location
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

  it('only active legend group rendered when activeTagGroup set', () => {
    const input = `org

tag Location
  NY(blue)

tag Status
  FTE(green)

Alice | location: NY, status: FTE`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'location'
    );

    const legendGroups = container.querySelectorAll('[data-legend-group]');
    // Centralized legend shows all groups — active one expanded, others as pills
    expect(legendGroups.length).toBeGreaterThanOrEqual(1);
    const activeGroup = container.querySelector(
      '[data-legend-group="location"]'
    );
    expect(activeGroup).not.toBeNull();
    // Active group has entry dots (full rendering)
    expect(activeGroup!.querySelectorAll('circle').length).toBeGreaterThan(0);
  });

  it('all legend groups rendered minified when no activeTagGroup', () => {
    const input = `org

tag Location
  NY(blue)

tag Status
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

    // All groups are minified — no entry dots, just headers
    for (const g of legendGroups) {
      expect(g.querySelectorAll('circle').length).toBe(0);
    }
  });

  it('active legend group has distinct border styling', () => {
    const input = `org

tag Location
  NY(blue)
  LA(yellow)

Alice | location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'location'
    );

    const legendGroup = container.querySelector(
      '[data-legend-group="location"]'
    );
    expect(legendGroup).toBeTruthy();
    // Active group renders as capsule: outer rounded rect + inner pill + pill border
    const rects = legendGroup!.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(2);
    // Entries should be visible (dot circles)
    const dots = legendGroup!.querySelectorAll('circle');
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Visibility toggles (hiddenAttributes)
// ============================================================

describe('hiddenAttributes visibility', () => {
  const input = `org

tag Location
  NY(blue)
  LA(yellow)

tag Status
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
    const hiddenLayout = layoutOrg(
      parsed,
      undefined,
      undefined,
      new Set(['location'])
    );

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
    const inputWithDefaults = `org

tag Status
  FTE(green)

Alice`;
    const parsed = parseOrg(inputWithDefaults, palette.light);
    const layout = layoutOrg(parsed, undefined, undefined, new Set(['status']));

    // The orgNode still has the default injected
    expect(parsed.roots[0].metadata['status']).toBe('FTE');
    // But the layout node has it filtered out
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    expect(alice.metadata['status']).toBeUndefined();
  });

  it('container metadata is also filtered', () => {
    const containerInput = `org

tag Status
  FTE(green)

[Engineering]
  status: FTE
  Alice`;
    const parsed = parseOrg(containerInput, palette.light);
    const layout = layoutOrg(parsed, undefined, undefined, new Set(['status']));

    const eng = layout.containers.find((c) => c.label === 'Engineering')!;
    expect(eng.metadata['status']).toBeUndefined();
  });

  it('active legend group shows entry dots', () => {
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location', new Set());

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'location',
      new Set()
    );

    // Active legend group should have entry dots
    const legendGroup = container.querySelector(
      '[data-legend-group="location"]'
    );
    expect(legendGroup).toBeTruthy();
    const dots = legendGroup!.querySelectorAll('circle');
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });

  it('no entry dots when no active tag group', () => {
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    // Minified pills have no entry dots
    const legendGroups = container.querySelectorAll('[data-legend-group]');
    for (const g of legendGroups) {
      expect(g.querySelectorAll('circle').length).toBe(0);
    }
  });

  it('hidden attributes still filter card metadata', () => {
    const parsed = parseOrg(input, palette.light);
    const hidden = new Set(['location']);
    const layout = layoutOrg(parsed, undefined, 'location', hidden);

    // Cards should have location filtered from metadata
    const alice = layout.nodes.find((n) => n.label === 'Alice')!;
    expect(alice.metadata['location']).toBeUndefined();
  });

  it('export respects DSL hide option', () => {
    const exportInput = `org
hide location

tag Location
  NY(blue)

tag Status
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

// ============================================================
// Tag-group-only (legend-only) rendering
// ============================================================

describe('tag-group-only legend', () => {
  const tagGroupOnlyInput = `tag Rank r
  Captain(red)
  Sailor(blue)

tag Status
  Active(green)
  Inactive(gray)`;

  it('layoutOrg produces legend groups with no nodes', () => {
    const parsed = parseOrg(tagGroupOnlyInput);
    const layout = layoutOrg(parsed);

    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.legend).toHaveLength(2);
    expect(layout.legend[0].name).toBe('Rank');
    expect(layout.legend[1].name).toBe('Status');
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('stacks legend groups vertically', () => {
    const parsed = parseOrg(tagGroupOnlyInput);
    const layout = layoutOrg(parsed);

    // Same x, increasing y
    expect(layout.legend[0].x).toBe(layout.legend[1].x);
    expect(layout.legend[1].y).toBeGreaterThan(layout.legend[0].y);
  });

  it('carries alias in legend data', () => {
    const parsed = parseOrg(tagGroupOnlyInput);
    const layout = layoutOrg(parsed);

    expect(layout.legend[0].alias).toBe('r');
  });

  it('renders all groups expanded with entries', () => {
    const svg = renderOrgForExport(tagGroupOnlyInput, 'light', palette.light);
    expect(svg).toContain('<svg');
    // Both groups should be rendered
    const groupMatches = svg.match(/data-legend-group/g);
    expect(groupMatches?.length).toBe(2);
    // Entries should be visible (expanded capsules)
    expect(svg).toContain('>Captain<');
    expect(svg).toContain('>Sailor<');
    expect(svg).not.toContain('(default)');
    expect(svg).toContain('>Active<');
    expect(svg).toContain('>Inactive<');
  });

  it('shows group name without alias in pill label', () => {
    const svg = renderOrgForExport(tagGroupOnlyInput, 'light', palette.light);
    expect(svg).toContain('>Rank<');
    expect(svg).not.toContain('>Rank (r)<');
  });
});

// ============================================================
// Legend entry hover data attributes
// ============================================================

describe('legend entry hover attributes', () => {
  it('wraps legend entries in g[data-legend-entry]', () => {
    const input = `org

tag Location
  NY(blue)
  LA(yellow)

Alice | location: NY
Bob | location: LA`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'location'
    );

    const entries = container.querySelectorAll('[data-legend-entry]');
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const values = Array.from(entries).map((e) =>
      e.getAttribute('data-legend-entry')
    );
    expect(values).toContain('ny');
    expect(values).toContain('la');
  });

  it('each legend entry wraps circle + text', () => {
    const input = `org

tag Location
  NY(blue)

Alice | location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'location'
    );

    const entry = container.querySelector('[data-legend-entry="ny"]');
    expect(entry).toBeTruthy();
    expect(entry!.querySelector('circle')).toBeTruthy();
    expect(entry!.querySelector('text')).toBeTruthy();
  });

  it('adds data-tag-* on nodes when activeTagGroup is set', () => {
    const input = `org

tag Location
  NY(blue)
  LA(yellow)

Alice
  location: NY
Bob
  location: LA`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'location');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'location'
    );

    const alice = container.querySelector('.org-node[data-tag-location="ny"]');
    const bob = container.querySelector('.org-node[data-tag-location="la"]');
    expect(alice).toBeTruthy();
    expect(bob).toBeTruthy();
  });

  it('does not add data-tag-* when no activeTagGroup', () => {
    const input = `org

tag Location
  NY(blue)

Alice
  location: NY`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed);

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(container, parsed, layout, palette.light, false);

    const tagged = container.querySelector('[data-tag-location]');
    expect(tagged).toBeNull();
  });

  it('adds data-tag-* on containers when activeTagGroup is set', () => {
    const input = `org

tag Status
  Active(green)

[Engineering]
  status: Active
  Alice`;
    const parsed = parseOrg(input, palette.light);
    const layout = layoutOrg(parsed, undefined, 'status');

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });

    renderOrg(
      container,
      parsed,
      layout,
      palette.light,
      false,
      undefined,
      undefined,
      'status'
    );

    const eng = container.querySelector(
      '.org-container[data-tag-status="active"]'
    );
    expect(eng).toBeTruthy();
  });
});
