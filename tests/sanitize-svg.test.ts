// The sanitizing boundary itself — the module hosts are told to call before
// renderer output reaches a live document (diagrammo/diagrammo#884).
//
// Until this file there was no unit test of the sanitizer anywhere: it lived
// in `src/auto/shared.ts`, private to the two IIFE script-tag bundles, and the
// hostile-label suites (`svg-xml-wellformed`, `in-arrow-label-xss`,
// `timeline-tooltip-xss`) all test renderers rather than this.
//
// 🔴 Everything here reaches the sanitizer through the PACKAGE ROOT ENTRY,
// never through `src/utils/sanitize-svg` directly. That is the defect this row
// reports — the function existed and no consumer could import it — so a suite
// that reached past the entry would be testing the half that was never broken.

import { describe, it, expect } from 'vitest';
import * as dgmo from '../src/index';

const sanitizeSvgInPlace = (root: Element): void =>
  dgmo.sanitizeSvgInPlace(root);

function parse(markup: string): Element {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

describe('the package root entry exports the boundary', () => {
  // `sanitizeSvgInPlace` has existed since the embed bundles were written;
  // what did not exist was any way for `import … from '@diagrammo/dgmo'` to
  // reach it, so the seven app mount sites and dgmo's own `mountD3DataChart`
  // had no boundary to call.
  it('exports sanitizeSvgInPlace', () => {
    expect(typeof dgmo.sanitizeSvgInPlace).toBe('function');
  });

  it('exports the same function the embed bundles use, not a second copy', async () => {
    const shared = await import('../src/auto/shared');
    expect(shared.sanitizeSvgInPlace).toBe(dgmo.sanitizeSvgInPlace);
  });
});

describe('sanitizeSvgInPlace', () => {
  it('removes a script element', () => {
    const root = parse('<svg><script>alert(1)</script><rect /></svg>');
    sanitizeSvgInPlace(root);
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('rect')).not.toBeNull();
  });

  it('removes a foreignObject, payload and all', () => {
    const root = parse(
      '<svg><foreignObject><div onclick="steal()">x</div></foreignObject></svg>'
    );
    sanitizeSvgInPlace(root);
    expect(root.querySelector('foreignObject')).toBeNull();
    expect(root.textContent).not.toContain('x');
  });

  it('strips every on* handler attribute, whatever its case', () => {
    const root = parse(
      '<svg onload="a()"><rect ONMOUSEOVER="b()" onFocus="c()" fill="red" /></svg>'
    );
    sanitizeSvgInPlace(root);
    const svg = root.querySelector('svg')!;
    const rect = root.querySelector('rect')!;
    expect(svg.hasAttribute('onload')).toBe(false);
    expect(rect.hasAttribute('onmouseover')).toBe(false);
    expect(rect.hasAttribute('onfocus')).toBe(false);
    // …and leaves the drawing alone.
    expect(rect.getAttribute('fill')).toBe('red');
  });

  it('scrubs the root element it was handed, not only its descendants', () => {
    const host = document.createElement('div');
    host.setAttribute('onmouseenter', 'alert(1)');
    sanitizeSvgInPlace(host);
    expect(host.hasAttribute('onmouseenter')).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '\tjavascript:alert(1)',
    // Browsers strip tab/LF/CR from anywhere in a URL, so a scheme split by
    // one navigates exactly as if it were whole.
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('drops href %j', (href) => {
    const root = parse('<svg><a><rect /></a></svg>');
    root.querySelector('a')!.setAttribute('href', href);
    sanitizeSvgInPlace(root);
    expect(root.querySelector('a')!.hasAttribute('href')).toBe(false);
  });

  it.each([
    'https://diagrammo.app/docs',
    'mailto:hi@diagrammo.app',
    '/relative/path',
    '#anchor',
  ])('keeps href %j', (href) => {
    const root = parse('<svg><a><rect /></a></svg>');
    root.querySelector('a')!.setAttribute('href', href);
    sanitizeSvgInPlace(root);
    expect(root.querySelector('a')!.getAttribute('href')).toBe(href);
  });

  it('drops an unsafe xlink:href and keeps a safe one', () => {
    const XLINK = 'http://www.w3.org/1999/xlink';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const bad = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    bad.setAttributeNS(XLINK, 'xlink:href', 'javascript:alert(1)');
    const good = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    good.setAttributeNS(XLINK, 'xlink:href', 'https://diagrammo.app');
    svg.append(bad, good);

    sanitizeSvgInPlace(svg);

    expect(bad.hasAttributeNS(XLINK, 'href')).toBe(false);
    expect(good.getAttributeNS(XLINK, 'href')).toBe('https://diagrammo.app');
  });

  // ── SMIL rewrites an attribute after the check has read it ──
  //
  // The static href is clean when scrubbed and hostile when clicked, so a
  // sanitizer that only reads attributes passes the whole payload through.
  describe('SMIL animations that target a URL attribute', () => {
    it.each(['animate', 'set', 'animateTransform', 'animateMotion'])(
      'removes <%s attributeName="href">',
      (tag) => {
        const root = parse(
          `<svg><a href="#x"><${tag} attributeName="href" values="javascript:alert(1)" begin="0s"/><text>click</text></a></svg>`
        );
        sanitizeSvgInPlace(root);
        expect(root.querySelector(tag)).toBeNull();
        // The link itself survives — only the rewrite is removed.
        expect(root.querySelector('a')!.getAttribute('href')).toBe('#x');
        expect(root.querySelector('text')).not.toBeNull();
      }
    );

    it('removes one targeting xlink:href, and tolerates spacing and case', () => {
      const root = parse(
        '<svg><a href="#x"><animate attributeName=" XLink:Href " to="javascript:alert(1)"/></a></svg>'
      );
      sanitizeSvgInPlace(root);
      expect(root.querySelector('animate')).toBeNull();
    });

    it('keeps an animation of an ordinary attribute', () => {
      // The infra renderer emits these for real — offset, opacity, radius —
      // so a blanket removal would break a chart type to close a hole the
      // animation is not in.
      const root = parse(
        '<svg><circle r="3"><animate attributeName="opacity" values="0;1"/></circle>' +
          '<circle><animateMotion dur="2s" path="M0,0 L10,10"/></circle></svg>'
      );
      sanitizeSvgInPlace(root);
      expect(root.querySelector('animate')).not.toBeNull();
      expect(root.querySelector('animateMotion')).not.toBeNull();
    });
  });

  it('leaves an already-clean tree byte-identical', () => {
    const markup = '<svg width="10"><g><rect fill="blue" /></g></svg>';
    const root = parse(markup);
    sanitizeSvgInPlace(root);
    expect(root.innerHTML).toBe(parse(markup).innerHTML);
  });

  it('is idempotent on a hostile tree', () => {
    const markup =
      '<svg onload="a()"><script>b()</script><a href="javascript:c()">' +
      '<animate attributeName="href" to="javascript:d()"/></a></svg>';
    const once = parse(markup);
    sanitizeSvgInPlace(once);
    const twice = parse(once.innerHTML);
    sanitizeSvgInPlace(twice);
    expect(twice.innerHTML).toBe(once.innerHTML);
  });
});
