// arc-label-limit.test.ts — above 50 nodes (ARC_LABEL_NODE_LIMIT) an arc
// diagram draws no node labels; hovering a node shows its label and its
// neighbours' labels, and mouse-leave hides them again (#2416). At 50 nodes or
// fewer every node keeps its label.

import { describe, it, expect } from 'vitest';
import { renderArcDiagram } from '../src/arc/renderer';
import { parseArc } from '../src/arc/parser';
import { getPalette } from '../src/palettes';

const name = (i: number) => `n${String(i).padStart(3, '0')}`;

/** A chain through every node plus a second link per node, as `arc` source. */
function arcSource(count: number, opts: { groups?: boolean } = {}): string {
  const lines = [`arc Pressure ${count}`, ''];
  const link = (a: number, b: number, v: number) =>
    `${opts.groups ? '  ' : ''}${name(a)} -> ${name(b)} ${v}`;
  if (opts.groups) {
    // Two groups, each a chain of its own half plus one cross link.
    const half = Math.floor(count / 2);
    lines.push('[Left] red');
    for (let i = 0; i < half - 1; i++) lines.push(link(i, i + 1, 1 + (i % 5)));
    lines.push('', '[Right] teal');
    for (let i = half; i < count - 1; i++)
      lines.push(link(i, i + 1, 1 + (i % 5)));
    lines.push(link(half, 0, 2));
  } else {
    for (let i = 0; i < count - 1; i++) lines.push(link(i, i + 1, 1 + (i % 5)));
    for (let i = 0; i < count; i += 3)
      lines.push(link(i, (i * 7 + 11) % count, 2));
  }
  return lines.join('\n') + '\n';
}

function render(
  source: string,
  opts: { exportDims?: { width: number; height: number } } = {}
): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 1200 });
  Object.defineProperty(container, 'clientHeight', { value: 600 });
  document.body.appendChild(container);
  renderArcDiagram(
    container,
    parseArc(source),
    getPalette('slate').light,
    false,
    undefined,
    opts.exportDims
  );
  return container;
}

/** Node names whose label <text> is currently in the SVG. */
function labelledNodes(container: HTMLDivElement): string[] {
  return [...container.querySelectorAll('svg text')]
    .map((t) => t.textContent ?? '')
    .filter((t) => /^n\d{3}$/.test(t))
    .sort();
}

function hover(container: HTMLDivElement, node: string): void {
  const el = container.querySelector(`.arc-node[data-node="${node}"]`)!;
  el.dispatchEvent(new MouseEvent('mouseenter'));
}

function leave(container: HTMLDivElement, node: string): void {
  const el = container.querySelector(`.arc-node[data-node="${node}"]`)!;
  el.dispatchEvent(new MouseEvent('mouseleave'));
}

describe('arc node labels above ARC_LABEL_NODE_LIMIT', () => {
  it('draws every label at 50 nodes', () => {
    const c = render(arcSource(50));
    expect(labelledNodes(c)).toHaveLength(50);
    expect(c.querySelector('.arc-hover-labels')).toBeNull();
    c.remove();
  });

  it('draws no node label at 51 nodes and 200 nodes', () => {
    for (const count of [51, 200]) {
      const c = render(arcSource(count));
      expect(c.querySelectorAll('.arc-node')).toHaveLength(count);
      expect(labelledNodes(c)).toEqual([]);
      c.remove();
    }
  });

  it('shows the hovered node and its neighbours on hover, and hides them on leave', () => {
    const c = render(arcSource(200));
    // n030's neighbours: its chain neighbours plus its extra links, read
    // from the parsed links rather than restated here.
    const links = parseArc(arcSource(200)).links;
    const expected = new Set<string>(['n030']);
    for (const l of links) {
      if (l.source === 'n030') expected.add(l.target);
      if (l.target === 'n030') expected.add(l.source);
    }
    hover(c, 'n030');
    expect(labelledNodes(c)).toEqual([...expected].sort());
    expect(expected.size).toBeGreaterThan(2);
    // The hovered label paints last, over its neighbours' halos.
    const drawn = [...c.querySelectorAll('.arc-hover-label')].map(
      (t) => t.textContent
    );
    expect(drawn[drawn.length - 1]).toBe('n030');
    expect(drawn.filter((t) => t === 'n030')).toHaveLength(1);
    // Hovering another node replaces the labels, never adds to them.
    hover(c, 'n100');
    expect(labelledNodes(c)).toContain('n100');
    expect(labelledNodes(c)).not.toContain('n030');
    leave(c, 'n100');
    expect(labelledNodes(c)).toEqual([]);
    c.remove();
  });

  it('shows no labels in a static export', () => {
    const c = render(arcSource(200), {
      exportDims: { width: 200 * 20 + 80, height: 600 },
    });
    expect(labelledNodes(c)).toEqual([]);
    c.remove();
  });

  it('hides labels in the vertical layout too, and hover shows them', () => {
    const src = arcSource(60).replace('\n\n', '\norientation-vertical\n\n');
    expect(parseArc(src).orientation).toBe('vertical');
    const c = render(src);
    expect(labelledNodes(c)).toEqual([]);
    hover(c, 'n010');
    expect(labelledNodes(c)).toContain('n010');
    expect(labelledNodes(c)).toContain('n011');
    c.remove();
  });

  it('keeps grouped arcs laid out: group names inside their bands', () => {
    const c = render(arcSource(120, { groups: true }));
    expect(labelledNodes(c)).toEqual([]);
    const bands = [...c.querySelectorAll('.arc-group-band')];
    const names = [...c.querySelectorAll('text.arc-group-label')];
    expect(bands).toHaveLength(2);
    expect(names.map((n) => n.textContent)).toEqual(['Left', 'Right']);
    for (const nameEl of names) {
      const band = bands.find(
        (b) =>
          b.getAttribute('data-group') === nameEl.getAttribute('data-group')
      )!;
      const top = Number(band.getAttribute('y'));
      const bottom = top + Number(band.getAttribute('height'));
      const left = Number(band.getAttribute('x'));
      const right = left + Number(band.getAttribute('width'));
      const y = Number(nameEl.getAttribute('y'));
      const x = Number(nameEl.getAttribute('x'));
      expect(y).toBeGreaterThan(top);
      expect(y).toBeLessThan(bottom);
      expect(x).toBeGreaterThan(left);
      expect(x).toBeLessThan(right);
    }
    c.remove();
  });
});
