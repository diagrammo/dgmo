import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseCycle } from '../src/cycle/parser';
import { computeCycleLayout } from '../src/cycle/layout';
import { renderCycle } from '../src/cycle/renderer';
import { getPalette } from '../src/palettes';
import { getRenderCategory } from '../src/dgmo-router';

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

const nordLight = getPalette('nord').light;

// ============================================================
// Parser tests
// ============================================================

describe('cycle parser — basic', () => {
  it('parses title and nodes', () => {
    const result = parseCycle(`cycle OODA Loop

Observe
Orient
Decide
Act`);
    expect(result.type).toBe('cycle');
    expect(result.title).toBe('OODA Loop');
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(4);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.error).toBeNull();
  });

  it('parses 2-node cycle', () => {
    const result = parseCycle(`cycle Ping Pong

Ping
Pong`);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(2);
    expect(result.error).toBeNull();
  });

  it('parses 3-node cycle', () => {
    const result = parseCycle(`cycle Triangle

A
B
C`);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(3);
  });

  it('extracts title correctly', () => {
    const result = parseCycle(`cycle My Complex Title Here

Node1
Node2`);
    expect(result.title).toBe('My Complex Title Here');
  });

  it('handles no title', () => {
    const result = parseCycle(`cycle

A
B`);
    expect(result.title).toBe('');
    expect(result.nodes).toHaveLength(2);
  });
});

describe('cycle parser — node pipe metadata', () => {
  it('parses color metadata', () => {
    const result = parseCycle(`cycle Colors

Red Node | color: red
Blue Node | color: blue`);
    expect(result.nodes[0].color).toBe('red');
    expect(result.nodes[1].color).toBe('blue');
  });

  it('parses span metadata', () => {
    const result = parseCycle(`cycle Span Test

Short | span: 1
Long | span: 3`);
    expect(result.nodes[0].span).toBe(1);
    expect(result.nodes[1].span).toBe(3);
  });

  it('parses description from pipe metadata', () => {
    const result = parseCycle(`cycle Desc Test

Node A | description: inline description
Node B`);
    expect(result.nodes[0].description).toEqual(['inline description']);
  });

  it('parses combined metadata', () => {
    const result = parseCycle(`cycle Combined

Node A | color: blue, span: 2
Node B`);
    expect(result.nodes[0].color).toBe('blue');
    expect(result.nodes[0].span).toBe(2);
  });

  it('defaults span to 1', () => {
    const result = parseCycle(`cycle Default

Node A
Node B`);
    expect(result.nodes[0].span).toBe(1);
    expect(result.nodes[1].span).toBe(1);
  });
});

describe('cycle parser — descriptions', () => {
  it('accumulates indented descriptions', () => {
    const result = parseCycle(`cycle Desc

Node A
  Line one
  Line two
  Line three
Node B`);
    expect(result.nodes[0].description).toEqual([
      'Line one',
      'Line two',
      'Line three',
    ]);
  });

  it('handles bullet descriptions', () => {
    const result = parseCycle(`cycle Bullets

Node A
  - First item
  - Second item
Node B`);
    expect(result.nodes[0].description).toEqual([
      '• First item',
      '• Second item',
    ]);
  });

  it('concatenates pipe description with indented lines', () => {
    const result = parseCycle(`cycle Concat

Node A | description: inline text
  More details here
Node B`);
    expect(result.nodes[0].description).toEqual([
      'inline text',
      'More details here',
    ]);
  });
});

describe('cycle parser — edges', () => {
  it('parses edge labels', () => {
    const result = parseCycle(`cycle Edge Labels

Node A
  -Process->
Node B`);
    const explicitEdge = result.edges.find(
      (e) => e.sourceIndex === 0 && e.label
    );
    expect(explicitEdge).toBeDefined();
    expect(explicitEdge!.label).toBe('Process');
  });

  it('parses bare -> edge', () => {
    const result = parseCycle(`cycle Bare Edge

Node A
  ->
Node B`);
    expect(result.edges[0].sourceIndex).toBe(0);
    expect(result.edges[0].targetIndex).toBe(1);
    expect(result.edges[0].label).toBeUndefined();
  });

  it('parses edge pipe metadata', () => {
    const result = parseCycle(`cycle Edge Meta

Node A
  -Go-> | color: red, width: 6
Node B`);
    const edge = result.edges[0];
    expect(edge.color).toBe('red');
    expect(edge.width).toBe(6);
  });

  it('accumulates edge descriptions', () => {
    const result = parseCycle(`cycle Edge Desc

Node A
  -Process->
    Step one of the process
    Step two follows
Node B`);
    const edge = result.edges[0];
    expect(edge.description).toEqual([
      'Step one of the process',
      'Step two follows',
    ]);
  });

  it('handles mixed: some nodes with edges, some without', () => {
    const result = parseCycle(`cycle Mixed

Node A
  -Go->
Node B
Node C`);
    expect(result.edges).toHaveLength(3);
    // First edge is explicit
    expect(result.edges[0].label).toBe('Go');
    // Other edges are implicit
    expect(result.edges[1].label).toBeUndefined();
    expect(result.edges[2].label).toBeUndefined();
  });

  it('generates implicit edges wrapping last to first', () => {
    const result = parseCycle(`cycle Wrap

A
B
C`);
    expect(result.edges).toHaveLength(3);
    expect(result.edges[2].sourceIndex).toBe(2);
    expect(result.edges[2].targetIndex).toBe(0); // wraps to first
  });
});

describe('cycle parser — directives', () => {
  it('parses direction-counterclockwise', () => {
    const result = parseCycle(`cycle CCW

direction-counterclockwise

A
B
C`);
    expect(result.direction).toBe('counterclockwise');
  });

  it('defaults to clockwise', () => {
    const result = parseCycle(`cycle CW

A
B
C`);
    expect(result.direction).toBe('clockwise');
  });
});

describe('cycle parser — explicit target tolerance', () => {
  it('accepts explicit target matching next node', () => {
    const result = parseCycle(`cycle Target

Observe
  -> Orient
Orient
Decide`);
    // No diagnostic when target matches actual next node
    const targetDiags = result.diagnostics.filter((d) =>
      d.message.includes('Explicit target')
    );
    expect(targetDiags).toHaveLength(0);
  });

  it('emits info diagnostic when explicit target mismatches', () => {
    const result = parseCycle(`cycle Mismatch

Observe
  -> Decide
Orient
Decide`);
    const diag = result.diagnostics.find((d) =>
      d.message.includes('Explicit target')
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain("next node ('Orient')");
    expect(diag!.message).toContain("'Decide' is ignored");
  });
});

describe('cycle parser — errors', () => {
  it('errors on fewer than 2 nodes', () => {
    const result = parseCycle(`cycle Solo

OnlyOne`);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('at least 2 nodes');
  });

  it('errors on span: 0', () => {
    const result = parseCycle(`cycle Zero Span

Node A | span: 0
Node B`);
    const diag = result.diagnostics.find((d) =>
      d.message.includes('span must be a positive number')
    );
    expect(diag).toBeDefined();
  });

  it('errors on span: -1', () => {
    const result = parseCycle(`cycle Neg Span

Node A | span: -1
Node B`);
    const diag = result.diagnostics.find((d) =>
      d.message.includes('span must be a positive number')
    );
    expect(diag).toBeDefined();
  });

  it('errors on -> in node label', () => {
    const result = parseCycle(`cycle Arrow Label

A -> B
Node C`);
    const diag = result.diagnostics.find((d) =>
      d.message.includes('cannot contain "->"')
    );
    expect(diag).toBeDefined();
  });
});

describe('cycle parser — comments and blanks', () => {
  it('skips comments and blank lines', () => {
    const result = parseCycle(`cycle Comments

// This is a comment
Node A

// Another comment
Node B`);
    expect(result.nodes).toHaveLength(2);
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ============================================================
// Layout tests
// ============================================================

describe('cycle layout — equidistant', () => {
  it('positions 4 nodes at 90° intervals', () => {
    const parsed = parseCycle(`cycle Four

A
B
C
D`);
    const layout = computeCycleLayout(parsed, { width: 400, height: 400 });
    expect(layout.nodes).toHaveLength(4);

    // All nodes should be equidistant from center
    const distances = layout.nodes.map((n) => {
      const dx = n.x - layout.cx;
      const dy = n.y - layout.cy;
      return Math.sqrt(dx * dx + dy * dy);
    });
    const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
    distances.forEach((d) => {
      expect(d).toBeCloseTo(avgDist, 0);
    });

    // First node should be at top (y < cy)
    expect(layout.nodes[0].y).toBeLessThan(layout.cy);
  });

  it('first node is at the top', () => {
    const parsed = parseCycle(`cycle Top

A
B
C`);
    const layout = computeCycleLayout(parsed, { width: 400, height: 400 });
    // First node angle is -π/2 (top)
    expect(layout.nodes[0].angle).toBeCloseTo(-Math.PI / 2);
  });
});

describe('cycle layout — non-equidistant (span)', () => {
  it('span: 3 produces 3x gap between node edges', () => {
    const parsed = parseCycle(`cycle Span

Short | span: 1
Long | span: 3
Medium | span: 1`);
    const layout = computeCycleLayout(parsed, { width: 400, height: 400 });

    // Total span = 5, gaps are distributed proportionally to span.
    // Gap after Short (span 1) : Gap after Long (span 3) = 1 : 3
    // Center-to-center arcs differ from pure span ratio because
    // footprint-based spacing accounts for node sizes at each position.
    // Verify: gap ratio ≈ 1:3 by checking that the span-3 gap is ~3x the span-1 gap.
    const angle0 = layout.nodes[0].angle;
    const angle1 = layout.nodes[1].angle;
    const angle2 = layout.nodes[2].angle;
    // Arc 0→1 (span 1 gap), Arc 1→2 (span 3 gap)
    const arc01 = Math.abs(angle1 - angle0);
    const arc12 = Math.abs(angle2 - angle1);
    // The ratio of gaps is 1:3, but center-to-center arcs include footprints.
    // Still, the span-3 arc should be significantly larger than the span-1 arc.
    expect(arc12).toBeGreaterThan(arc01 * 2);
  });
});

describe('cycle layout — counterclockwise', () => {
  it('reverses angle direction', () => {
    const parsed = parseCycle(`cycle CCW

direction-counterclockwise

A
B
C`);
    const layout = computeCycleLayout(parsed, { width: 400, height: 400 });

    // In counterclockwise, second node should be to the left of first
    // (negative angular progression from top)
    // First node is at top (-π/2). Second should be at -π/2 - 2π/3
    const expectedAngle = -Math.PI / 2 - (2 * Math.PI) / 3;
    expect(layout.nodes[1].angle).toBeCloseTo(expectedAngle, 1);
  });
});

describe('cycle layout — edges', () => {
  it('produces N edge paths for N nodes', () => {
    const parsed = parseCycle(`cycle Edges

A
B
C
D`);
    const layout = computeCycleLayout(parsed);
    expect(layout.edges).toHaveLength(4);
    layout.edges.forEach((e) => {
      expect(e.path).toBeTruthy();
      expect(e.path).toContain('M');
      expect(e.path).toContain('A');
    });
  });
});

// ============================================================
// Router tests
// ============================================================

describe('cycle router', () => {
  it('getRenderCategory returns visualization for cycle', () => {
    expect(getRenderCategory('cycle')).toBe('visualization');
  });
});

// ============================================================
// Renderer tests (jsdom)
// ============================================================

describe('cycle renderer', () => {
  function createContainer(w = 800, h = 600): HTMLDivElement {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: w });
    Object.defineProperty(container, 'clientHeight', { value: h });
    document.body.appendChild(container);
    return container;
  }

  it('creates SVG with correct dimensions', () => {
    const parsed = parseCycle(`cycle Test

A
B
C`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('800');
    expect(svg!.getAttribute('height')).toBe('600');
  });

  it('renders N nodes as rect elements', () => {
    const parsed = parseCycle(`cycle Nodes

A
B
C
D`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });

    const rects = container.querySelectorAll('.cycle-node rect');
    expect(rects).toHaveLength(4);
  });

  it('renders N edges as path elements', () => {
    const parsed = parseCycle(`cycle Edges

A
B
C`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });

    const paths = container.querySelectorAll('.cycle-edge path');
    expect(paths).toHaveLength(3);
  });

  it('renders arrowhead markers in defs', () => {
    const parsed = parseCycle(`cycle Arrows

A
B`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });

    const markers = container.querySelectorAll('defs marker');
    expect(markers.length).toBeGreaterThan(0);
  });

  it('renders edge labels as text', () => {
    const parsed = parseCycle(`cycle Labels

A
  -Process->
B`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });

    const texts = container.querySelectorAll('.cycle-edge text');
    expect(texts.length).toBeGreaterThan(0);
  });

  it('adds data-line-number attributes to nodes', () => {
    const parsed = parseCycle(`cycle Data

A
B
C`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });

    const nodes = container.querySelectorAll('[data-line-number]');
    expect(nodes.length).toBeGreaterThanOrEqual(3); // at least 3 nodes
  });

  it('renders edge with custom width', () => {
    const parsed = parseCycle(`cycle Width

A
  -> | width: 6
B`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });

    const paths = container.querySelectorAll('.cycle-edge path');
    // The explicitly annotated edge should have width 6
    const widths = Array.from(paths).map((p) => p.getAttribute('stroke-width'));
    expect(widths).toContain('6');
  });
});
