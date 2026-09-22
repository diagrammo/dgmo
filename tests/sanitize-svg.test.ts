// The sanitizing boundary itself — the module hosts are told to call before
// renderer output reaches a live document (diagrammo/diagrammo#884).
//
// Until this file there was no unit test of the sanitizer anywhere: it lived
// in `src/auto/shared.ts`, private to the two IIFE script-tag bundles, and the
// hostile-label suites (`svg-xml-wellformed`, `in-arrow-label-xss`,
// `timeline-tooltip-xss`) all test renderers rather than this.
//
// The second describe block is the part that would have caught the reported
// defect: the sanitizer existing is worth nothing if no consumer can import it.

import { describe, it, expect } from 'vitest';
import {
  sanitizeSvgInPlace,
  sanitizeSvgMarkup,
} from '../src/utils/sanitize-svg';
import * as dgmo from '../src/index';

function parse(markup: string): Element {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

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
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('drops href %s', (href) => {
    const root = parse(`<svg><a href="${href}"><rect /></a></svg>`);
    sanitizeSvgInPlace(root);
    expect(root.querySelector('a')!.hasAttribute('href')).toBe(false);
  });

  it.each([
    'https://diagrammo.app/docs',
    'mailto:hi@diagrammo.app',
    '/relative/path',
    '#anchor',
  ])('keeps href %s', (href) => {
    const root = parse(`<svg><a href="${href}"><rect /></a></svg>`);
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

  it('leaves an already-clean tree byte-identical', () => {
    const markup = '<svg width="10"><g><rect fill="blue" /></g></svg>';
    const root = parse(markup);
    sanitizeSvgInPlace(root);
    expect(root.innerHTML).toBe(parse(markup).innerHTML);
  });
});

describe('sanitizeSvgMarkup', () => {
  it('returns markup with the script gone', () => {
    const out = sanitizeSvgMarkup('<svg><script>alert(1)</script></svg>');
    expect(out).not.toContain('script');
    expect(out).toContain('svg');
  });

  it('strips handlers and unsafe hrefs from a fragment with no single root', () => {
    const out = sanitizeSvgMarkup(
      '<style>.m{}</style><div onclick="a()"><a href="javascript:b()">x</a></div>'
    );
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('.m{}');
  });

  it('removes a foreignObject payload', () => {
    const out = sanitizeSvgMarkup(
      '<svg><foreignObject><img src=x onerror="alert(1)"></foreignObject></svg>'
    );
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('foreignObject');
  });

  it('does not execute or fetch anything while parsing', () => {
    // Template content is inert; if it were not, jsdom would raise on the
    // load handler rather than returning cleaned markup.
    expect(() =>
      sanitizeSvgMarkup('<svg onload="throw new Error(\'ran\')"></svg>')
    ).not.toThrow();
  });

  it('is idempotent', () => {
    const once = sanitizeSvgMarkup(
      '<svg onload="a()"><script>b()</script></svg>'
    );
    expect(sanitizeSvgMarkup(once)).toBe(once);
  });
});

describe('the package root entry exports the boundary', () => {
  // 🔴 This is the reported defect, stated as an assertion. `sanitizeSvgInPlace`
  // has existed since the embed bundles were written; what did not exist was
  // any way for `import … from '@diagrammo/dgmo'` to reach it, so the seven
  // app mount sites and dgmo's own `mountD3DataChart` had no boundary to call.
  it('exports sanitizeSvgInPlace', () => {
    expect(typeof dgmo.sanitizeSvgInPlace).toBe('function');
  });

  it('exports sanitizeSvgMarkup', () => {
    expect(typeof dgmo.sanitizeSvgMarkup).toBe('function');
  });

  it('exports the same function the embed bundles use', async () => {
    const shared = await import('../src/auto/shared');
    expect(shared.sanitizeSvgInPlace).toBe(dgmo.sanitizeSvgInPlace);
  });
});
