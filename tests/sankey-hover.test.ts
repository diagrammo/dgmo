import { describe, it, expect, afterEach } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';
import { attachDataChartInteractions } from '../src/charts-d3/interactions';
import { render } from '../src/render';

// #2463: selecting a node in a dense mesh lit its bar and left every flow
// equally faded. Twelve left, twelve middle and twelve right nodes; each
// left node feeds three middles and each middle feeds three rights.
const lines: string[] = ['sankey Mesh', ''];
for (let i = 1; i <= 12; i++)
  for (let k = 0; k < 3; k++)
    lines.push(`L${i} -> M${((i + k * 4) % 12) + 1} ${i + k + 1}`);
for (let j = 1; j <= 12; j++)
  for (let k = 0; k < 3; k++)
    lines.push(`M${j} -> R${((j + k * 5) % 12) + 1} ${j + k + 1}`);
const MESH = lines.join('\n');

const pairs = lines.slice(2).map((l) => {
  const [s, , t] = l.split(' ');
  return { s: s!, t: t! };
});

let host: HTMLDivElement;
let detach: { destroy: () => void } | undefined;

afterEach(() => {
  detach?.destroy();
  host?.remove();
});

describe('sankey node hover lights its flows (#2463)', () => {
  it('hovering M8 lights exactly its flows in and out, and dims the rest', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = await renderDataChartD3(MESH, 'light', undefined, {
      width: 900,
      height: 700,
    });
    const svg = host.querySelector('svg')!;
    detach = attachDataChartInteractions(svg, {});

    const ribbons = [
      ...svg.querySelectorAll<SVGElement>('[data-emph-key^="link:"]'),
    ];
    const nodes = [
      ...svg.querySelectorAll<SVGElement>('[data-emph-key^="node:"]'),
    ];
    expect(ribbons).toHaveLength(pairs.length);
    const m8 = nodes.find(
      (n) => n.getAttribute('data-emph-key') === 'node:M8'
    )!;
    m8.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    m8.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    const lit = (e: Element) => !e.classList.contains('dgmo-dim');
    const litLinks = ribbons
      .filter(lit)
      .map((r) => r.getAttribute('data-emph-key')!.slice(5))
      .sort();
    const expected = pairs
      .filter((p) => p.s === 'M8' || p.t === 'M8')
      .map((p) => `${p.s}␟${p.t}`)
      .sort();
    expect(expected).toHaveLength(6);
    expect(litLinks).toEqual(expected);

    const litNodes = nodes
      .filter(lit)
      .map((n) => n.getAttribute('data-emph-key')!.slice(5))
      .sort();
    const neighbours = new Set(['M8']);
    for (const p of pairs) {
      if (p.t === 'M8') neighbours.add(p.s);
      if (p.s === 'M8') neighbours.add(p.t);
    }
    expect(litNodes).toEqual([...neighbours].sort());

    // Moving the pointer off restores the normal view.
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    m8.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect([...ribbons, ...nodes].every(lit)).toBe(true);
  });

  it('the node closure matches the highlight directive', async () => {
    const plain = await renderDataChartD3(MESH, 'light');
    const lit = await renderDataChartD3(`${MESH}\nhighlight M8`, 'light');
    const doc = (s: string) => {
      const d = document.createElement('div');
      d.innerHTML = s;
      return d;
    };
    const p = doc(plain);
    const h = doc(lit);
    const id = p
      .querySelector('[data-emph-key="node:M8"]')!
      .getAttribute('data-flow-node')!;
    // Story view paints receded ribbons one ground colour: the commonest fill.
    const fills = [...h.querySelectorAll('[data-emph-key^="link:"]')].map((r) =>
      r.getAttribute('fill')
    );
    const count = new Map<string | null, number>();
    for (const f of fills) count.set(f, (count.get(f) ?? 0) + 1);
    const ground = [...count].sort((x, y) => y[1] - x[1])[0]![0];
    // A ribbon the directive keeps lit is exactly one M8's hover keeps lit.
    for (const r of h.querySelectorAll('[data-emph-key^="link:"]')) {
      const key = r.getAttribute('data-emph-key')!;
      const directiveLit = r.getAttribute('fill') !== ground;
      const hoverLit = (
        p
          .querySelector(`[data-emph-key="${key}"]`)!
          .getAttribute('data-lineage') ?? ''
      )
        .split(' ')
        .includes(id);
      expect(hoverLit, key).toBe(directiveLit);
    }
  });

  it('render() bakes one dim rule per node for export', async () => {
    const { svg } = await render(MESH, { theme: 'light' });
    const rules = svg.match(
      /svg:has\(rect\[data-flow-node\]\[data-flow-node="n\d+"\]:hover\) \[data-lineage\]:not\(\[data-lineage~="n\d+"\]\)\{opacity:0\.18\}/g
    );
    expect(rules).toHaveLength(36);
    expect(svg).not.toMatch(/exceeds cap/);
  });
});
