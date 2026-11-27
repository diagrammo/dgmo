// C4 — long names, relationship labels and the title stay inside their shapes
// and the canvas (#2426): wrap first, then cut the last line with "…".
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseC4 } from '../src/c4/parser';
import { layoutC4Context, layoutC4Containers } from '../src/c4/layout';
import {
  renderC4ContextForExport,
  renderC4ContainersForExport,
} from '../src/c4/renderer';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';
import { FULL_TEXT_ATTR } from '../src/utils/full-text';

let win: JSDOM['window'];
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  win = dom.window;
  for (const key of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? win : (win as never)[key],
      configurable: true,
    });
  }
});

const palette = getPalette('nord').light;

const SPACED = Array.from({ length: 60 }, () => 'A').join(' ') + 'A'; // 120 chars
const SOLID = 'B'.repeat(120);
const REL =
  Array.from({ length: 24 }, (_, i) => `rel${i % 10}`).join(' ') + ' e'; // 120 chars
const TITLE = Array.from({ length: 30 }, () => 'Title').join(' ');

const CONTEXT = `c4 ${TITLE}

${SPACED} is a person description: Somebody with a very long name
${SOLID} is a system description: A system with an unbroken name
  -${REL}-> ${SPACED}
Short is a system
  -Uses-> ${SOLID}`;

const CONTAINERS = `c4 ${TITLE}

${SPACED} is a person
Banking is a system description: Internet banking
  -Serves-> ${SPACED}
  containers
    ${SOLID} is a container tech: React, description: SPA frontend
      -${REL}-> API tech: JSON/HTTPS
    API is a container is a queue tech: Node.js, description: REST API`;

const BOLD = { bold: true } as const;

function parse(svg: string): SVGSVGElement {
  const doc = new win.DOMParser().parseFromString(svg, 'image/svg+xml');
  return doc.documentElement as unknown as SVGSVGElement;
}

/** Content group transform: translate(a, b) scale(s). */
function contentTransform(svg: SVGSVGElement) {
  const g = Array.from(svg.children).find(
    (c) =>
      c.tagName === 'g' && /scale\(/.test(c.getAttribute('transform') ?? '')
  )!;
  const m = /translate\(([-\d.e]+),\s*([-\d.e]+)\)\s*scale\(([-\d.e]+)\)/.exec(
    g.getAttribute('transform')!
  )!;
  return { tx: +m[1]!, ty: +m[2]!, s: +m[3]! };
}

function checkNames(
  svg: SVGSVGElement,
  nodes: readonly { id: string; width: number; height: number }[]
) {
  for (const card of Array.from(svg.querySelectorAll('g.c4-card'))) {
    const node = nodes.find((n) => n.id === card.getAttribute('data-node-id'))!;
    const names = Array.from(card.querySelectorAll('text')).filter(
      (t) => t.getAttribute('font-weight') === 'bold'
    );
    expect(names.length).toBeGreaterThan(0);
    for (const t of names) {
      const w = measureText(t.textContent!, 13, BOLD);
      const x = +t.getAttribute('x')!;
      const left = t.getAttribute('text-anchor') === 'start' ? x : x - w / 2;
      expect(left).toBeGreaterThanOrEqual(-node.width / 2);
      expect(left + w).toBeLessThanOrEqual(node.width / 2);
      const y = +t.getAttribute('y')!;
      expect(y - 7).toBeGreaterThanOrEqual(-node.height / 2);
      expect(y + 7).toBeLessThanOrEqual(node.height / 2);
    }
    // Every text line of the card, description included, stays in the box.
    for (const t of Array.from(card.querySelectorAll('text'))) {
      expect(+t.getAttribute('y')!).toBeLessThanOrEqual(node.height / 2);
    }
  }
}

function checkLabelsAndTitle(svg: SVGSVGElement) {
  const W = +svg.getAttribute('width')!;
  const H = +svg.getAttribute('height')!;
  const { tx, ty, s } = contentTransform(svg);
  const bgs = Array.from(svg.querySelectorAll('rect.c4-edge-label-bg'));
  expect(bgs.length).toBeGreaterThan(0);
  for (const r of bgs) {
    const x = tx + +r.getAttribute('x')! * s;
    const y = ty + +r.getAttribute('y')! * s;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + +r.getAttribute('width')! * s).toBeLessThanOrEqual(W);
    expect(y + +r.getAttribute('height')! * s).toBeLessThanOrEqual(H);
    // The knockout holds every line drawn on it.
    for (const t of Array.from(
      r.parentElement!.querySelectorAll('text.c4-edge-label')
    )) {
      expect(measureText(t.textContent!, 11)).toBeLessThanOrEqual(
        +r.getAttribute('width')!
      );
    }
  }
  const title = svg.querySelector('text.chart-title')!;
  const spans = Array.from(title.querySelectorAll('tspan'));
  const lines = spans.length > 0 ? spans : [title];
  expect(lines.length).toBeGreaterThan(1);
  for (const l of lines) {
    const w = measureText(l.textContent!, 20, BOLD);
    expect(W / 2 - w / 2).toBeGreaterThanOrEqual(0);
    expect(W / 2 + w / 2).toBeLessThanOrEqual(W);
  }
  expect(title.getAttribute(FULL_TEXT_ATTR)).toBe(TITLE);
  expect(svg.querySelector('title')).toBeNull();
}

describe('C4 long labels (#2426)', () => {
  it('context: names wrap inside their boxes; label and title stay on the canvas', () => {
    const parsed = parseC4(CONTEXT, palette);
    expect(parsed.error).toBeFalsy();
    const layout = layoutC4Context(parsed);
    const svg = parse(renderC4ContextForExport(CONTEXT, 'light', palette));
    checkNames(svg, layout.nodes);
    checkLabelsAndTitle(svg);

    // The spaced name wraps; the unbroken one is cut and keeps its words.
    const solid = svg.querySelector(`g.c4-card[${FULL_TEXT_ATTR}^="${SOLID}"]`);
    expect(solid).not.toBeNull();
    // The 120-character label wraps onto several lines and loses no words.
    const edge = Array.from(svg.querySelectorAll('g.c4-edge-group')).find((g) =>
      g.querySelector('text.c4-edge-label')?.textContent?.startsWith('rel0')
    )!;
    const lines = Array.from(edge.querySelectorAll('text.c4-edge-label'));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((t) => t.textContent).join(' ')).toBe(REL);
    expect(edge.hasAttribute(FULL_TEXT_ATTR)).toBe(false);

    // A label too long for its line cap is cut and keeps its words.
    const LONG = Array.from({ length: 40 }, () => 'relationship').join(' ');
    const cut = parse(
      renderC4ContextForExport(
        `c4\n\nX is a system\n  -${LONG}-> Y\nY is a system`,
        'light',
        palette
      )
    );
    const cutEdge = cut.querySelector('g.c4-edge-group')!;
    expect(cutEdge.getAttribute(FULL_TEXT_ATTR)).toBe(LONG);
    const cutLines = Array.from(cutEdge.querySelectorAll('text.c4-edge-label'));
    expect(cutLines).toHaveLength(3);
    expect(cutLines[2]!.textContent!.endsWith('…')).toBe(true);
  });

  it('containers: the same, on the container renderer', () => {
    const parsed = parseC4(CONTAINERS, palette);
    expect(parsed.error).toBeFalsy();
    const layout = layoutC4Containers(parsed, 'Banking');
    const svg = parse(
      renderC4ContainersForExport(CONTAINERS, 'Banking', 'light', palette)
    );
    checkNames(svg, layout.nodes);
    checkLabelsAndTitle(svg);
  });

  it('short names draw on one line, as before', () => {
    const src =
      'c4 Short\n\nCustomer is a person\nBank is a system\n  -Uses-> Customer';
    const svg = parse(renderC4ContextForExport(src, 'light', palette));
    for (const card of Array.from(svg.querySelectorAll('g.c4-card'))) {
      const bold = Array.from(card.querySelectorAll('text')).filter(
        (t) => t.getAttribute('font-weight') === 'bold'
      );
      expect(bold).toHaveLength(1);
      expect(card.hasAttribute(FULL_TEXT_ATTR)).toBe(false);
    }
    expect(svg.querySelector('text.chart-title tspan')).toBeNull();
  });
});
