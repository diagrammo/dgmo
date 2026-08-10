import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { layoutGraph } from '../src/graph/layout';
import { renderFlowchart } from '../src/graph/flowchart-renderer';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { getPalette } from '../src/palettes';
import { EDGE_LABEL_KNOCKOUT_OPACITY } from '../src/utils/visual-conventions';

// An edge label sits ON its connector, so each of these three renderers knocks
// a `palette.bg` rect out behind the text. Boxes-and-lines drew that rect at
// 0.72 and the line showed through on the glyphs' baseline band, which is
// exactly where a strikethrough goes — every arrow label rendered looking
// struck out (issue 159). The three renderers had three different values.
//
// These tests assert the property, not the number: one shared constant, opaque
// enough that the connector cannot cross the text.

const P = getPalette('nord').light;
const DIMS = { width: 800, height: 600 };

/** The knockout is the rect drawn immediately before the label's text run. */
function knockoutOpacities(svg: SVGSVGElement, labelText: string): number[] {
  const out: number[] = [];
  for (const text of svg.querySelectorAll('text')) {
    if (text.textContent?.trim() !== labelText) continue;
    // The rect and the text are siblings under the label group, or the rect is
    // the last one drawn before the text within the same parent.
    const parent = text.parentElement;
    if (!parent) continue;
    const rects = [...parent.querySelectorAll('rect')];
    const rect = rects[rects.length - 1];
    if (rect) out.push(Number(rect.getAttribute('opacity')));
  }
  return out;
}

describe('an edge label is not crossed by its own connector', () => {
  it('boxes-and-lines knocks the connector out from behind the label', async () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\nYour files -Copy it in-> A space'
    );
    const layout = await layoutBoxesAndLines(parsed);
    const el = document.createElement('div');
    renderBoxesAndLines(el, parsed, layout, P, false, { exportDims: DIMS });
    const svg = el.querySelector('svg')!;

    const opacities = knockoutOpacities(svg, 'Copy it in');
    expect(opacities.length).toBe(1);
    expect(opacities[0]).toBe(EDGE_LABEL_KNOCKOUT_OPACITY);
  });

  it('flowchart knocks the connector out from behind the label', () => {
    const parsed = parseFlowchart('(Start) -Copy it in-> [Process]', P);
    const layout = layoutGraph(parsed);
    const el = document.createElement('div');
    document.body.appendChild(el);
    renderFlowchart(el, parsed, layout, P, false, undefined, DIMS);
    const svg = el.querySelector('svg')!;

    const rect = svg.querySelector('.fc-edge-label-bg')!;
    expect(Number(rect.getAttribute('opacity'))).toBe(
      EDGE_LABEL_KNOCKOUT_OPACITY
    );
    document.body.removeChild(el);
  });

  it('infra knocks the connector out from behind the label', () => {
    // Infra edges are indented under their source (§4.4), not written inline.
    const parsed = parseInfra(`infra
edge
  rps: 100
  -> LB
LB
  -Copy it in-> API`);
    expect(parsed.error).toBeNull();
    const layout = layoutInfra(computeInfra(parsed));
    const el = document.createElement('div');
    renderInfra(
      el,
      layout,
      P,
      false,
      parsed.title,
      parsed.titleLineNumber,
      parsed.tagGroups,
      null,
      false,
      null,
      null
    );
    const svg = el.querySelector('svg')!;

    const opacities = knockoutOpacities(svg, 'Copy it in');
    expect(opacities.length).toBeGreaterThan(0);
    for (const o of opacities) expect(o).toBe(EDGE_LABEL_KNOCKOUT_OPACITY);
  });

  it('leaves too little of the connector showing to read as a strikethrough', () => {
    // 0.72 was the value that produced the bug. The floor is a guard against a
    // future edit drifting back toward it, not a claim that 0.9 is the only
    // defensible number.
    expect(EDGE_LABEL_KNOCKOUT_OPACITY).toBeGreaterThanOrEqual(0.85);
    expect(EDGE_LABEL_KNOCKOUT_OPACITY).toBeLessThan(1);
  });
});
