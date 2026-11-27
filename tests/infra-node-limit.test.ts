import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import {
  layoutInfra,
  FOLD_MIN_LENGTH,
  type InfraLayoutNode,
} from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { renderForExport } from '../src/d3';
import { INFRA_MAX_NODES } from '../src/infra/limits';
import { getPalette } from '../src/palettes';
import { validateDiagram } from '../src/validate-diagram';
import { getDiagnosticSpec } from '../src/diagnostics-registry';

/**
 * An infra chain of `n` nodes after the entry, like the 200-node pressure
 * file (#2446): `edge` → S1 → … → Sn, with an optional skip link i → i+2.
 * The entry counts as a node, so the diagram has n + 1 nodes.
 */
function chain(n: number, skip = false): string {
  const out = ['infra Chain', '', 'edge', '  rps: 1000', '  -> S1', ''];
  for (let i = 1; i <= n; i++) {
    out.push(`S${i}`, '  latency-ms: 10');
    if (i < n) out.push(`  -> S${i + 1}`);
    if (skip && i + 2 <= n) out.push(`  -> S${i + 2}`);
    out.push('');
  }
  return out.join('\n');
}

const tooMany = (src: string) =>
  parseInfra(src).diagnostics.filter(
    (d) => d.code === 'E_INFRA_TOO_MANY_NODES'
  );

function render(src: string): string {
  const parsed = parseInfra(src);
  const layout = layoutInfra(computeInfra(parsed));
  const container = document.createElement('div');
  renderInfra(
    container,
    layout,
    getPalette('nord').light,
    false,
    parsed.title,
    parsed.titleLineNumber,
    parsed.tagGroups,
    null
  );
  return container.innerHTML;
}

const rect = (n: InfraLayoutNode) => ({
  l: n.x - n.width / 2,
  r: n.x + n.width / 2,
  t: n.y - n.height / 2,
  b: n.y + n.height / 2,
});

describe('infra node limit (#2446)', () => {
  it('INFRA_MAX_NODES nodes parse and draw with no diagnostic', async () => {
    const src = chain(INFRA_MAX_NODES - 1);
    const parsed = parseInfra(src);
    expect(parsed.nodes).toHaveLength(INFRA_MAX_NODES);
    expect(parsed.error).toBeNull();
    expect(tooMany(src)).toHaveLength(0);
    const svg = await renderForExport(src, 'light');
    expect(svg).toContain('<svg');
    expect(svg.match(/class="infra-node"/g)?.length).toBe(INFRA_MAX_NODES);
  });

  it('one node past the limit: one error on that node, nothing drawn', async () => {
    const src = chain(INFRA_MAX_NODES);
    const parsed = parseInfra(src);
    expect(parsed.nodes).toHaveLength(INFRA_MAX_NODES + 1);
    const errs = tooMany(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.severity).toBe('error');
    expect(errs[0]!.message).toContain(`${INFRA_MAX_NODES + 1} nodes`);
    expect(errs[0]!.message).toContain(`at most ${INFRA_MAX_NODES}`);
    expect(parsed.error).not.toBeNull();
    // On the line of the first node past the limit (S100; edge is node 1).
    const lines = src.split('\n');
    expect(lines[errs[0]!.line - 1]!.trim()).toBe(`S${INFRA_MAX_NODES}`);
    expect(await renderForExport(src, 'light')).toBe('');
  });

  it('the 200-chain with skip links shows one error and no drawing', async () => {
    const src = chain(200, true);
    const errors = parseInfra(src).diagnostics.filter(
      (d) => d.severity === 'error'
    );
    expect(errors.map((d) => d.code)).toEqual(['E_INFRA_TOO_MANY_NODES']);
    expect(await renderForExport(src, 'light')).toBe('');
    const v = validateDiagram(src);
    expect(v.errors.map((e) => e.code)).toEqual(['E_INFRA_TOO_MANY_NODES']);
    expect(validateDiagram(chain(INFRA_MAX_NODES - 1)).errors).toEqual([]);
  });

  it('is registered', () => {
    expect(getDiagnosticSpec('E_INFRA_TOO_MANY_NODES')?.severity).toBe('error');
  });
});

describe('infra long chain folds into bands (#2446)', () => {
  it('a chain at the limit wraps to a landscape shape, not a hairline', () => {
    const layout = layoutInfra(
      computeInfra(parseInfra(chain(INFRA_MAX_NODES - 1)))
    );
    // Unfolded this chain was about 29,000 × 200 px.
    expect(layout.width).toBeLessThan(layout.height * 2.5);
    expect(layout.width).toBeLessThan(FOLD_MIN_LENGTH);
    // At a 1000×700 pane, nodes keep a visible width (unfolded: 5 px).
    const scale = Math.min(1000 / layout.width, 700 / layout.height);
    expect(layout.nodes[1]!.width * scale).toBeGreaterThan(35);
  });

  it('folded nodes do not overlap', () => {
    for (const skip of [false, true]) {
      const layout = layoutInfra(
        computeInfra(parseInfra(chain(INFRA_MAX_NODES - 1, skip)))
      );
      const rects = layout.nodes.map(rect);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!,
            b = rects[j]!;
          const overlap = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
          expect(
            overlap,
            `${layout.nodes[i]!.id} / ${layout.nodes[j]!.id}`
          ).toBe(false);
        }
      }
    }
  });

  it('an edge between bands routes through the gap between them', () => {
    const src = chain(INFRA_MAX_NODES - 1);
    const layout = layoutInfra(computeInfra(parseInfra(src)));
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    // The first chain edge whose target sits left of its source wraps.
    const wrap = layout.edges.find(
      (e) => byId.get(e.targetId)!.x < byId.get(e.sourceId)!.x
    )!;
    expect(wrap).toBeDefined();
    const s = rect(byId.get(wrap.sourceId)!);
    const t = rect(byId.get(wrap.targetId)!);
    expect(t.t).toBeGreaterThan(s.b);
    const svg = render(src);
    const doc = new DOMParser().parseFromString(svg, 'text/html');
    const path = [...doc.querySelectorAll('g.infra-edge')]
      .find(
        (g) =>
          g.getAttribute('data-from') === wrap.sourceId &&
          g.getAttribute('data-to') === wrap.targetId
      )!
      .querySelector('path')!
      .getAttribute('d')!;
    const nums = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    // The horizontal run lies in the gap: below band k, above band k+1.
    expect(ys.some((y) => y > s.b && y < t.t)).toBe(true);
  });

  it('a short chain under the fold threshold lays out as before', () => {
    const layout = layoutInfra(computeInfra(parseInfra(chain(9))));
    const ys = new Set(layout.nodes.map((n) => Math.round(n.y)));
    expect(ys.size).toBe(1);
  });
});
