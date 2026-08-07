// Story 8.11 (from the 2026-07-27 Diagrammo Cloud security audit).
//
// Renderers serialize via `outerHTML`, the HTML serializer — which escapes `&`
// and `"` inside attribute values but deliberately leaves `<` and `>` alone.
// That is correct for HTML: a quoted attribute value ends at its closing quote,
// so angle brackets inside one are inert characters, and the audit confirmed
// there is NO XSS here (a sweep of 20 chart types with attribute-breakout and
// text-breakout payloads found nothing that escapes its attribute).
//
// It stops being correct the moment the same bytes are parsed as XML. A label
// like `A</text><script>…` lands verbatim in `data-name` / `data-emph-key` /
// `data-participant-id`, and an XML parser rejects the whole document. Anywhere
// a `.svg` is served as `image/svg+xml` or loaded through `<img>` — the R2
// render cache, wrapper embeds, the planned `/r/:id.svg` endpoints — one
// unlucky label silently breaks the entire diagram.
//
// So these tests assert well-formedness, not sanitization.

import { describe, expect, it } from 'vitest';

import { render } from '../src/index';
import { escapeAttributeMarkupChars } from '../src/utils/svg-serialize';

/** Parse as XML and report the failure, if any. jsdom ships a real XML parser. */
function xmlError(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'application/xml');
  const err = doc.querySelector('parsererror');
  return err ? (err.textContent ?? 'parse error') : null;
}

/** A label that closes a text element and opens a script — the worst shape. */
const HOSTILE = 'Xx</text><script>alert(1)</script>';

const CASES: Record<string, string> = {
  pie: `pie\n  ${HOSTILE} 10\n  Other 20\n`,
  bar: `bar\n  ${HOSTILE} 10\n  Other 20\n`,
  boxes: `boxes\n  ${HOSTILE}\n  B\n  ${HOSTILE} -> B\n`,
  sequence: `sequence\n  A -> B ${HOSTILE}\n`,
  treemap: `treemap\n  ${HOSTILE} 10\n  Other 20\n`,
  funnel: `funnel\n  ${HOSTILE} 100\n  Next 50\n`,
  c4: `c4\n  ${HOSTILE}\n`,
  er: `er\n  ${HOSTILE}\n    id int pk\n`,
  kanban: `kanban\n  Todo\n    ${HOSTILE}\n`,
  mindmap: `mindmap\n  Root\n    ${HOSTILE}\n`,
  org: `org\n  ${HOSTILE}\n`,
  sketch: `sketch\n  ${HOSTILE}\n`,
  timeline: `timeline\n  2020 ${HOSTILE}\n  2021 Thing\n`,
};

describe('escapeAttributeMarkupChars', () => {
  it('escapes angle brackets inside attribute values', () => {
    expect(escapeAttributeMarkupChars('<g data-name="a<b>c"></g>')).toBe(
      '<g data-name="a&lt;b&gt;c"></g>'
    );
  });

  it('leaves element markup alone', () => {
    const svg = '<svg><g class="x"><text>hi</text></g></svg>';
    expect(escapeAttributeMarkupChars(svg)).toBe(svg);
  });

  it('leaves text content alone (the HTML serializer already escaped it)', () => {
    const svg = '<text>a &lt; b</text>';
    expect(escapeAttributeMarkupChars(svg)).toBe(svg);
  });

  it('handles namespaced and dotted attribute names', () => {
    expect(
      escapeAttributeMarkupChars('<use xlink:href="a<b" data-x.y="c>d"/>')
    ).toBe('<use xlink:href="a&lt;b" data-x.y="c&gt;d"/>');
  });

  it('cannot run past a value boundary (quotes are pre-escaped)', () => {
    // The serializer emits `&quot;` for any `"` inside a value, so `[^"]*`
    // always stops at the real closing quote.
    const svg = '<g data-a="x&quot;<y" data-b="z"></g>';
    expect(escapeAttributeMarkupChars(svg)).toBe(
      '<g data-a="x&quot;&lt;y" data-b="z"></g>'
    );
  });

  it('escapes a bare ampersand inside an attribute value', () => {
    // What an implementation that does not escape `&` itself leaves behind.
    // An XML parser rejects the whole document over this one character.
    expect(
      escapeAttributeMarkupChars('<g data-node-path="Sailing & Rigging"></g>')
    ).toBe('<g data-node-path="Sailing &amp; Rigging"></g>');
  });

  it('does NOT double-escape output that was already escaped', () => {
    // The trap this pass has to avoid. jsdom and every browser emit `&amp;`
    // themselves; turning that into `&amp;amp;` would corrupt the path that
    // works today, on every chart type, for the sake of the one that does not.
    const svg = '<g data-a="Sailing &amp; Rigging" data-b="x &lt; y"></g>';
    expect(escapeAttributeMarkupChars(svg)).toBe(svg);
  });

  it('leaves numeric and hex character references alone', () => {
    const svg = '<g data-a="a&#39;b" data-b="c&#x27;d"></g>';
    expect(escapeAttributeMarkupChars(svg)).toBe(svg);
  });

  it('escapes a bare ampersand next to an escaped one', () => {
    expect(escapeAttributeMarkupChars('<g data-a="R&D &amp; more"></g>')).toBe(
      '<g data-a="R&amp;D &amp; more"></g>'
    );
  });

  it('escapes an ampersand that only looks like a reference', () => {
    // `&nbsp` without its semicolon is not a character reference.
    expect(escapeAttributeMarkupChars('<g data-a="a&nbsp b"></g>')).toBe(
      '<g data-a="a&amp;nbsp b"></g>'
    );
  });
});

describe('rendered SVG is well-formed XML with hostile labels', () => {
  for (const [chart, source] of Object.entries(CASES)) {
    it(`${chart} parses as XML`, async () => {
      const { svg } = await render(source);
      expect(svg.length).toBeGreaterThan(0);
      expect(xmlError(svg)).toBeNull();
    });
  }

  it('keeps the label readable rather than stripping it', async () => {
    // Escaping, not removal: `data-name` feeds tooltips and `data-emph-key`
    // pairs a mark with its legend entry, so mangling the value would break
    // hover matching and show the wrong text.
    const { svg } = await render(CASES['pie']!);
    const doc = new DOMParser().parseFromString(svg, 'application/xml');
    const named = doc.querySelector('[data-name]');
    expect(named?.getAttribute('data-name')).toContain('</text>');
  });
});
