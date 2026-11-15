import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { layoutGraph, type LayoutResult } from '../src/graph/layout';
import { renderFlowchart } from '../src/graph/flowchart-renderer';
import { getPalette } from '../src/palettes';

// A back edge between adjacent ranks — the retry loop — leaves the lower
// node's side and returns as an elbow beside the column, never along the
// forward edge it pairs with (#2034).

const P = getPalette('nord').light;
const RETRY = readFileSync(
  resolve(__dirname, '../gallery/fixtures/flowchart-retry.dgmo'),
  'utf-8'
);

function edge(layout: LayoutResult, source: string, target: string) {
  const e = layout.edges.find(
    (x) => x.source === source && x.target === target
  );
  if (!e) throw new Error(`no edge ${source} -> ${target}`);
  return e;
}

function node(layout: LayoutResult, id: string) {
  const n = layout.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
}

describe('a retry edge between adjacent nodes', () => {
  const layout = layoutGraph(parseFlowchart(RETRY, P));
  const pay = node(layout, 'process:pay');
  const ok = node(layout, 'decision:ok?');
  const back = edge(layout, 'decision:ok?', 'process:pay');
  const forward = edge(layout, 'process:pay', 'decision:ok?');

  it('leaves from the side of the lower node', () => {
    const start = back.points[0]!;
    expect(start.x).toBeCloseTo(ok.x + ok.width / 2);
    expect(start.y).toBeCloseTo(ok.y);
  });

  it('returns into the side of the upper node', () => {
    const end = back.points[back.points.length - 1]!;
    expect(end.x).toBeCloseTo(pay.x + pay.width / 2);
    expect(end.y).toBeCloseTo(pay.y);
  });

  it('runs its leg beside the column, clear of the forward edge', () => {
    const faces = Math.max(pay.x + pay.width / 2, ok.x + ok.width / 2);
    const inner = back.points.slice(1, -1);
    for (const p of inner) expect(p.x).toBeGreaterThan(faces);
    const forwardMaxX = Math.max(...forward.points.map((p) => p.x));
    const legX = Math.min(...inner.map((p) => p.x));
    expect(legX - forwardMaxX).toBeGreaterThan(pay.width / 2);
  });

  it('puts its label on the leg, between the two nodes', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const parsed = parseFlowchart(RETRY, P);
    renderFlowchart(el, parsed, layoutGraph(parsed), P, false, undefined, {
      width: 800,
      height: 600,
    });
    const groups = [...el.querySelectorAll('.fc-edge-group')];
    const label = groups
      .map((g) => g.querySelector('text.fc-edge-label'))
      .find((t) => t?.textContent === 'no');
    expect(label).toBeTruthy();
    const lx = Number(label!.getAttribute('x'));
    const ly = Number(label!.getAttribute('y'));
    const legX = Math.min(...back.points.slice(1, -1).map((p) => p.x));
    // The renderer draws in the layout's own coordinates inside a scaled
    // group, so the label is compared against the route, not the viewport.
    expect(Math.abs(lx - legX)).toBeLessThan(20);
    expect(ly).toBeGreaterThan(pay.y);
    expect(ly).toBeLessThan(ok.y);
    document.body.removeChild(el);
  });

  it('is part of the canvas, so the elbow is never clipped', () => {
    const legX = Math.max(...back.points.map((p) => p.x));
    expect(layout.width).toBeGreaterThan(legX);
  });

  it('hangs below the row under direction-lr', () => {
    const lr = layoutGraph(
      parseFlowchart(RETRY.replace('\n', '\ndirection-lr\n'), P)
    );
    const lrPay = node(lr, 'process:pay');
    const lrOk = node(lr, 'decision:ok?');
    const lrBack = edge(lr, 'decision:ok?', 'process:pay');
    const faces = Math.max(
      lrPay.y + lrPay.height / 2,
      lrOk.y + lrOk.height / 2
    );
    for (const p of lrBack.points.slice(1, -1))
      expect(p.y).toBeGreaterThan(faces);
    expect(lrBack.points[0]!.x).toBeCloseTo(lrOk.x);
  });
});

describe('a back edge that skips ranks', () => {
  it('keeps the route dagre gives it', () => {
    const layout = layoutGraph(
      parseFlowchart(
        '(Start) -> [A] -> [B] -> <Done?>\n<Done?> -no-> [A]\n<Done?> -yes-> (End)',
        P
      )
    );
    const a = node(layout, 'process:a');
    const back = edge(layout, 'decision:done?', 'process:a');
    // An elbow would start on the decision's side face, at its centre's
    // height; dagre's own route leaves through its top.
    const done = node(layout, 'decision:done?');
    expect(back.points[0]!.y).toBeLessThan(done.y);
    expect(a).toBeTruthy();
  });
});
