// ============================================================
// XSS Lock-in Test Suite (spec: tech-spec-in-arrow-message-gauntlet.md, TD-12)
// ============================================================
//
// For each of 8 in-arrow-supporting chart types, render each XSS payload as
// an in-arrow label and assert that:
//   1. The rendered <text> element's textContent contains the literal payload
//      (proves the payload reached the DOM as text, not markup)
//   2. querySelectorAll('script') returns empty (no script injection)
//   3. querySelectorAll('img')    returns empty (no image/onerror injection)
//   4. Parsing doesn't crash and the chart type renders normally
//
// Per TD-12, all 8 renderers are ALREADY safe (they use D3 .text() / DOM
// textNodes). This suite is a LOCK-IN to prevent regression if anyone
// introduces .html() or innerHTML in a future refactor.

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';

beforeAll(() => {
  // Ensure DOM globals so the parser DOM helpers work; render() also sets
  // them up via ensureDom() but vitest + jsdom env benefit from an
  // explicit install before the first test.
  if (typeof document === 'undefined') {
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
  }
});

// ============================================================
// Payload set (from TD-12 in the spec)
// ============================================================

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=y>',
  '"><svg/onload=alert(1)>',
  '${payload}',
] as const;

// ============================================================
// Per-chart source builders
// ============================================================
//
// Each builder wraps the label into a minimal DGMO source that yields at
// least one edge with the label as an in-arrow label. The label is passed
// literally — no escaping, so the raw payload flows through parser →
// renderer → SVG DOM.

type ChartBuilder = { name: string; build: (label: string) => string };

const CHART_BUILDERS: ChartBuilder[] = [
  {
    name: 'sequence',
    build: (label) => `sequence\nA -${label}-> B`,
  },
  {
    name: 'flowchart',
    build: (label) => `flowchart\n[A] -${label}-> [B]`,
  },
  {
    name: 'state',
    build: (label) => `state\nA -${label}-> B`,
  },
  {
    name: 'infra',
    build: (label) => `infra\nA\n  -${label}-> B`,
  },
  {
    name: 'c4',
    // C4 needs both source and target declared, and the indented
    // relationship attaches to the last declared element — so declare
    // B first, then A, then indent the relationship under A.
    build: (label) => `c4\nB is a system\nA is a system\n  -${label}-> B`,
  },
  {
    name: 'er',
    // ER labels cannot contain dashes (INDENT_REL_RE uses `-{1,2}` as hard
    // delimiters), so we strip `-` from the payload to keep the XSS payload
    // actually reaching the renderer. This still exercises the character
    // classes that matter for XSS (`<`, `>`, `"`, `'`, `&`, `$`, `{`, `}`)
    // and asserts no `<script>`/`<img>` injection after render.
    build: (label) => `er\ntable_a\n  1-${label.replace(/-/g, '')}-* table_b`,
  },
  {
    name: 'class',
    build: (label) => `class\nFoo\n  --|> Bar ${label}`,
  },
  {
    name: 'boxes-and-lines',
    build: (label) => `boxes-and-lines\nA -${label}-> B`,
  },
];

// Parse an SVG string into a queryable DOM so we can assert on elements.
function parseSvgString(svgString: string): Document {
  return new JSDOM(svgString, { contentType: 'image/svg+xml' }).window.document;
}

// Charts where the payload is expected to survive intact as a text node.
// For these, we ASSERT the rendered SVG contains a <text> element whose
// textContent includes the literal payload. For `er`, payload is passed
// through a dash-stripping filter and the rendered label comparison uses
// the filtered form.
const CHARTS_THAT_MUST_PRESERVE_PAYLOAD: Record<string, (p: string) => string> =
  {
    sequence: (p) => p,
    flowchart: (p) => p,
    state: (p) => p,
    infra: (p) => p,
    c4: (p) => p,
    class: (p) => p,
    'boxes-and-lines': (p) => p,
    // ER strips dashes in the builder (see CHART_BUILDERS above).
    er: (p) => p.replace(/-/g, ''),
  };

describe('AC-8 — XSS lock-in across all in-arrow-supporting charts', () => {
  for (const chart of CHART_BUILDERS) {
    describe(chart.name, () => {
      for (const payload of PAYLOADS) {
        it(`payload ${JSON.stringify(payload)} is plain-text in SVG`, async () => {
          const source = chart.build(payload);
          const { svg } = await render(source);

          // Crash / empty-output check.
          expect(typeof svg).toBe('string');
          expect(svg.length).toBeGreaterThan(0);

          const doc = parseSvgString(svg);

          // (2) No <script> elements anywhere in the rendered SVG.
          expect(doc.querySelectorAll('script').length).toBe(0);

          // (3) No <img> elements either.
          expect(doc.querySelectorAll('img').length).toBe(0);

          // (1) Required: the rendered SVG's combined text content must
          // contain the expected payload somewhere. Some charts (notably
          // c4) word-wrap long labels into multiple <tspan> children, so
          // the payload may not live inside a single <text> node. What
          // matters for AC-8 is that the characters reached the DOM as
          // text and were NOT interpreted as markup — which is already
          // guaranteed by the script/img absence checks above, plus this
          // textContent membership check.
          const expectedText =
            CHARTS_THAT_MUST_PRESERVE_PAYLOAD[chart.name](payload);
          const allText = Array.from(doc.querySelectorAll('text'))
            .map((t) => t.textContent ?? '')
            .join('\n');
          // c4 wrap-breaks the payload across tspans at word boundaries,
          // so join with a normalized-whitespace form and check there.
          const normalized = allText.replace(/\s+/g, ' ');
          const expectedNormalized = expectedText.replace(/\s+/g, ' ');
          expect(
            normalized.includes(expectedNormalized) ||
              allText.includes(expectedText),
            `chart ${chart.name} must render "${expectedText}" as text content in the rendered SVG`
          ).toBe(true);
        });
      }
    });
  }
});
