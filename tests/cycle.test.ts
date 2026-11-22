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

Red Node color: red
Blue Node color: blue`);
    expect(result.nodes[0].color).toBe('red');
    expect(result.nodes[1].color).toBe('blue');
  });

  it('parses span metadata', () => {
    const result = parseCycle(`cycle Span Test

Short span: 1
Long span: 3`);
    expect(result.nodes[0].span).toBe(1);
    expect(result.nodes[1].span).toBe(3);
  });

  it('parses description from pipe metadata', () => {
    const result = parseCycle(`cycle Desc Test

Node A description: inline description
Node B`);
    expect(result.nodes[0].description).toEqual(['inline description']);
  });

  it('parses combined metadata', () => {
    const result = parseCycle(`cycle Combined

Node A color: blue, span: 2
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

Node A description: inline text
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
  -Go-> color: red, width: 6
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

describe('cycle parser — explicit target (#2219)', () => {
  const userSource = `cycle a process

T1
  fisrt stage

T2
  second stage

T3
  another state

T4
  now i want to return to T2
  -> T2`;

  it('obeys an explicit target and drops the implicit edge', () => {
    const result = parseCycle(userSource);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.edges).toHaveLength(4);
    expect(result.edges[3]).toMatchObject({ sourceIndex: 3, targetIndex: 1 });
    expect(
      result.edges.some((e) => e.sourceIndex === 3 && e.targetIndex === 0)
    ).toBe(false);
  });

  it('matches the target ignoring case', () => {
    const result = parseCycle(userSource.replace('-> T2', '-> t2'));
    expect(result.edges[3]!.targetIndex).toBe(1);
  });

  it('accepts a target naming the next step with no diagnostic', () => {
    const result = parseCycle(`cycle Target

Observe
  -> Orient
Orient
Decide`);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.edges[0]!.targetIndex).toBe(1);
  });

  it('warns on an unknown target and falls back to the next step', () => {
    const result = parseCycle(`cycle Unknown

A
B
C
  -> T9`);
    expect(result.edges[2]!.targetIndex).toBe(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.severity).toBe('warning');
    expect(result.diagnostics[0]!.message).toBe(
      "No step named 'T9'. The arrow goes to the next step ('A')."
    );
  });

  it('warns on a self target and falls back to the next step', () => {
    const result = parseCycle(`cycle Self

A
B
  -> B
C`);
    expect(result.edges[1]!.targetIndex).toBe(2);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain('cannot point to itself');
    expect(result.diagnostics[0]!.message).toContain("next step ('C')");
  });

  it('keeps label and same-line metadata with a target', () => {
    const result = parseCycle(`cycle Labelled

Scout
Build
Ship
  -Back to scouting-> Scout color: red, width: 5
Measure`);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.edges[2]).toMatchObject({
      sourceIndex: 2,
      targetIndex: 0,
      label: 'Back to scouting',
      color: 'red',
      width: 5,
    });
  });

  it('uses the last edge line when a step has several', () => {
    const result = parseCycle(`cycle Several

A
B
C
D
  -> B
  -Second-> A`);
    const fromD = result.edges.filter((e) => e.sourceIndex === 3);
    expect(fromD).toHaveLength(1);
    expect(fromD[0]).toMatchObject({ targetIndex: 0, label: 'Second' });
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

Node A span: 0
Node B`);
    const diag = result.diagnostics.find((d) =>
      d.message.includes('span must be a positive number')
    );
    expect(diag).toBeDefined();
  });

  it('errors on span: -1', () => {
    const result = parseCycle(`cycle Neg Span

Node A span: -1
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

Short span: 1
Long span: 3
Medium span: 1`);
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
  -> width: 6
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

// ============================================================
// Circle Nodes
// ============================================================

describe('circle-nodes option', () => {
  function createContainer(w = 800, h = 600): HTMLDivElement {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: w });
    Object.defineProperty(container, 'clientHeight', { value: h });
    document.body.appendChild(container);
    return container;
  }

  it('parser recognizes circle-nodes keyword', () => {
    const parsed = parseCycle(`cycle Test
circle-nodes
A
B`);
    expect(parsed.options['circle-nodes']).toBe('true');
  });

  it('layout produces isCircle: true on all nodes', () => {
    const parsed = parseCycle(`cycle Test
circle-nodes
A
B
C`);
    const layout = computeCycleLayout(parsed, { width: 800, height: 600 });
    for (const node of layout.nodes) {
      expect(node.isCircle).toBe(true);
    }
  });

  it('circle nodes have width === height (square bounding box)', () => {
    const parsed = parseCycle(`cycle Test
circle-nodes
Alpha
Beta
Gamma`);
    const layout = computeCycleLayout(parsed, { width: 800, height: 600 });
    for (const node of layout.nodes) {
      expect(node.width).toBe(node.height);
    }
  });

  it('without circle-nodes, nodes have isCircle: false', () => {
    const parsed = parseCycle(`cycle Test
A
B`);
    const layout = computeCycleLayout(parsed, { width: 800, height: 600 });
    for (const node of layout.nodes) {
      expect(node.isCircle).toBe(false);
    }
  });

  it('renders <circle> elements for circle nodes', () => {
    const parsed = parseCycle(`cycle Test
circle-nodes
A color: blue
B color: red`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });
    const circles = container.querySelectorAll('circle');
    // Background rect doesn't count — only node circles
    expect(circles.length).toBe(2);
  });

  it('renders <rect> elements for non-circle nodes', () => {
    const parsed = parseCycle(`cycle Test
A
B`);
    const container = createContainer();
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });
    const circles = container.querySelectorAll('.cycle-node circle');
    expect(circles.length).toBe(0);
    const rects = container.querySelectorAll('.cycle-node rect');
    expect(rects.length).toBe(2);
  });

  it('circle nodes with descriptions have width === height', () => {
    const parsed = parseCycle(`cycle Test
circle-nodes
A
  Some description text
B
  Another description`);
    const layout = computeCycleLayout(parsed, { width: 800, height: 600 });
    for (const node of layout.nodes) {
      expect(node.width).toBe(node.height);
      expect(node.wrappedDesc.length).toBeGreaterThan(0);
    }
  });

  it('edge paths connect properly with circle nodes', () => {
    const parsed = parseCycle(`cycle Test
circle-nodes
A
  -Go->
B
C`);
    const layout = computeCycleLayout(parsed, { width: 800, height: 600 });
    // All edges should produce valid SVG paths
    for (const edge of layout.edges) {
      expect(edge.path).toMatch(/^M .+ A .+$/);
    }
  });
});

// ============================================================
// Centre text, step numbers, arrows meeting node outlines
// ============================================================

describe('cycle — center text and autonumber', () => {
  it('parses `center` with and without quotes', () => {
    expect(parseCycle('cycle T\ncenter PDCA\nA\nB').options['center']).toBe(
      'PDCA'
    );
    expect(
      parseCycle('cycle T\ncenter "Deming wheel"\nA\nB').options.center
    ).toBe('Deming wheel');
  });

  it('keeps a step called "Center" as a step', () => {
    const parsed = parseCycle('cycle T\nCenter\nA');
    expect(parsed.nodes.map((n) => n.label)).toEqual(['Center', 'A']);
    expect(parsed.options['center']).toBeUndefined();
  });

  it('parses autonumber', () => {
    expect(parseCycle('cycle T\nautonumber\nA\nB').options.autonumber).toBe(
      'on'
    );
  });

  function render(src: string): HTMLDivElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderCycle(container, parseCycle(src), nordLight, false, undefined, {
      width: 800,
      height: 600,
    });
    return container;
  }

  it('draws centre text only when given', () => {
    expect(render('cycle T\nA\nB').querySelector('.cycle-center')).toBeNull();
    const c = render('cycle T\ncenter PDCA\nA\nB');
    expect(c.querySelector('.cycle-center')!.textContent).toBe('PDCA');
  });

  it('draws one numbered badge per step when autonumber is on', () => {
    expect(
      render('cycle T\nA\nB').querySelector('.cycle-step-numbers')
    ).toBeNull();
    const c = render('cycle T\nautonumber\nA\nB\nC');
    const nums = [...c.querySelectorAll('.cycle-step-numbers text')].map(
      (t) => t.textContent
    );
    expect(nums).toEqual(['1', '2', '3']);
  });
});

describe('cycle layout — arrows touch the target outline', () => {
  // Distance from (px,py) to the outline of an axis-aligned rect (rounding
  // ignored: at most a couple of pixels at the corners).
  function outlineDistance(
    n: { x: number; y: number; width: number; height: number },
    px: number,
    py: number
  ): number {
    const dx = Math.abs(px - n.x) - n.width / 2;
    const dy = Math.abs(py - n.y) - n.height / 2;
    return Math.abs(Math.max(dx, dy));
  }

  for (const dirLine of ['', 'direction-counterclockwise\n']) {
    it(`arrow tip lands on the node edge (${dirLine ? 'ccw' : 'cw'})`, () => {
      const parsed = parseCycle(`cycle T
${dirLine}Plan
  -Define scope-> width: 6
Do
  Execute the plan with a lot of detail that wraps over several lines
Check
Act
  Standardise
Observe
Orient
Decide`);
      const layout = computeCycleLayout(parsed, { width: 900, height: 700 });
      const dir = parsed.direction === 'clockwise' ? 1 : -1;
      parsed.edges.forEach((edge, i) => {
        const m = layout.edges[i]!.path.match(
          /A [\d.]+ [\d.]+ 0 \d \d ([-\d.e]+) ([-\d.e]+)$/
        )!;
        const ex = Number(m[1]);
        const ey = Number(m[2]);
        const stroke = Math.max(edge.width ?? 3, 2);
        const arrowLen = (8 + 6 * Math.sqrt(stroke)) * 0.9;
        const a =
          Math.atan2(ey - layout.cy, ex - layout.cx) +
          (dir * arrowLen) / layout.radius;
        const tipX = layout.cx + layout.radius * Math.cos(a);
        const tipY = layout.cy + layout.radius * Math.sin(a);
        const tgt = layout.nodes[edge.targetIndex]!;
        expect(outlineDistance(tgt, tipX, tipY)).toBeLessThan(2.5);
      });
    });
  }
});

describe('cycle layout — explicit targets (#2219)', () => {
  const src = `cycle a process

T1
  fisrt stage

T2
  second stage

T3
  another state

T4
  now i want to return to T2
  -> T2`;

  // Endpoint of a path's last command ("... x y").
  function pathEnd(path: string): [number, number] {
    const nums = path.trim().split(/[\s,]+/);
    return [Number(nums[nums.length - 2]), Number(nums[nums.length - 1])];
  }
  function nearOutline(
    n: { x: number; y: number; width: number; height: number },
    px: number,
    py: number,
    slack: number
  ): boolean {
    return (
      Math.abs(px - n.x) <= n.width / 2 + slack &&
      Math.abs(py - n.y) <= n.height / 2 + slack
    );
  }

  for (const dirLine of ['', 'direction-counterclockwise\n']) {
    const label = dirLine ? 'ccw' : 'cw';
    it(`draws a chord from T4 ending at T2 and no T4→T1 path (${label})`, () => {
      const parsed = parseCycle(src.replace('\n\nT1', `\n${dirLine}\nT1`));
      expect(parsed.direction).toBe(dirLine ? 'counterclockwise' : 'clockwise');
      const layout = computeCycleLayout(parsed, { width: 900, height: 700 });
      expect(
        layout.edges.some((e) => e.sourceIndex === 3 && e.targetIndex === 0)
      ).toBe(false);
      const chord = layout.edges.find(
        (e) => e.sourceIndex === 3 && e.targetIndex === 1
      )!;
      expect(chord.path).toMatch(/^M [-\d.e]+ [-\d.e]+ Q /);
      // Starts at T4's centre, ends one arrowhead short of T2's outline.
      const t4 = layout.nodes[3]!;
      const t2 = layout.nodes[1]!;
      expect(chord.path.startsWith(`M ${t4.x} ${t4.y}`)).toBe(true);
      const [ex, ey] = pathEnd(chord.path);
      const arrowLen = (8 + 6 * Math.sqrt(3)) * 0.9;
      expect(nearOutline(t2, ex, ey, arrowLen + 1)).toBe(true);
      expect(nearOutline(t2, ex, ey, 0)).toBe(false);
      // The chord clears the steps it passes (T1 and T3): sample the curve.
      const [x0, y0, qx, qy, x2, y2] = chord.path
        .replace(/[MQ]/g, ' ')
        .trim()
        .split(/\s+/)
        .map(Number) as [number, number, number, number, number, number];
      for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        const u = 1 - t;
        const px = u * u * x0 + 2 * u * t * qx + t * t * x2;
        const py = u * u * y0 + 2 * u * t * qy + t * t * y2;
        for (const i of [0, 2])
          expect(nearOutline(layout.nodes[i]!, px, py, 5)).toBe(false);
      }
    });
  }

  it('draws an edge to the previous step as an inner arc', () => {
    const parsed = parseCycle(`cycle Back

Draft
Edit
Review
  -Rework-> Edit
Publish`);
    const layout = computeCycleLayout(parsed, { width: 800, height: 600 });
    const back = layout.edges.find(
      (e) => e.sourceIndex === 2 && e.targetIndex === 1
    )!;
    const fwd = layout.edges.find(
      (e) => e.sourceIndex === 1 && e.targetIndex === 2
    )!;
    const arcRadius = (p: string) => Number(p.match(/ A ([\d.]+) /)![1]);
    expect(arcRadius(fwd.path)).toBeCloseTo(layout.radius, 5);
    expect(arcRadius(back.path)).toBeLessThan(layout.radius - 5);
    // The label sits inside the ring.
    const d = Math.hypot(back.labelX - layout.cx, back.labelY - layout.cy);
    expect(d).toBeLessThan(layout.radius);
    expect(
      layout.edges.some((e) => e.sourceIndex === 2 && e.targetIndex === 3)
    ).toBe(false);
  });

  it('renders the chord with the edge data attributes and its label', () => {
    const parsed = parseCycle(`cycle Labelled

Scout
Build
Ship
  -Back to scouting-> Scout
Measure`);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderCycle(container, parsed, nordLight, false, undefined, {
      width: 800,
      height: 600,
    });
    const edges = [
      ...container.querySelectorAll('g.cycle-edge[data-from="2"]'),
    ];
    const pathG = edges.find((g) => g.querySelector('path'))!;
    expect(pathG.getAttribute('data-to')).toBe('0');
    expect(pathG.getAttribute('data-line-number')).toBe('6');
    expect(pathG.querySelector('path')!.getAttribute('d')).toContain(' Q ');
    expect(
      container.querySelector('g.cycle-edge[data-from="2"][data-to="3"]')
    ).toBeNull();
    const labelG = container.querySelector(
      'g.cycle-edge-labels g.cycle-edge[data-line-number="6"]'
    )!;
    expect(labelG.textContent).toContain('Back to scouting');
  });
});
