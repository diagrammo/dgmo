/**
 * The supported sanitizing boundary for renderer output that is about to land
 * in a live document.
 *
 * Renderer output is trusted only as far as the renderer that produced it, and
 * every host — the desktop app, the web editor, Obsidian, the script-tag
 * drop-ins, this library's own `mountD3DataChart` — puts that output into the
 * DOM. This module is what they call first. It lives here, beside `safe-href`,
 * rather than inside `src/auto/shared.ts` where it started: that module is the
 * browser-embed bundle's private toolbox, reachable only from the two IIFE
 * script-tag builds, so a host importing `@diagrammo/dgmo` could not call the
 * sanitizer at all however much it wanted to.
 *
 * 🔴 **Call it on a DETACHED tree, then insert.** Parse into a holder the
 * document does not own, sanitize, and move the result across:
 *
 * ```ts
 * const holder = document.createElement('div');
 * holder.innerHTML = svg;          // inert: nothing here is connected yet
 * sanitizeSvgInPlace(holder);
 * container.replaceChildren(...Array.from(holder.childNodes));
 * ```
 *
 * Sanitizing *after* assigning into a live container is too late — connecting
 * the subtree is what creates a nested browsing context for an `<iframe>`,
 * starts a fetch for an `<img>`, and runs a custom element's
 * `connectedCallback`, all synchronously inside the assignment. `auto/index.ts`
 * and `element/index.ts` have always done it in this order; `mount.ts` learned
 * it on diagrammo/diagrammo#884.
 *
 * **What this does NOT do**, so a caller is not misled about the contract: it
 * removes the script-execution surface listed below. It does not parse CSS, so
 * an `@import` or a `url()` inside a `<style>` element passes through; it does
 * not sandbox layout or styling; and it is no substitute for escaping at the
 * point a renderer interpolates author text (see `src/embed/escape.ts`).
 *
 * Browser-only — it needs a live DOM. There is nothing to sanitize on the
 * rasterising path, which never builds a document.
 */

import { safeHref } from './safe-href';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * SMIL can rewrite an attribute after the sanitizer has inspected it, so an
 * `<animate attributeName="href" values="javascript:…">` inside an `<a>` walks
 * straight past a check that only reads the static attribute — the link is
 * clean when scrubbed and hostile when clicked.
 *
 * Only the animations that target a URL attribute are removed. The infra
 * renderer emits `<animate>` and `<animateMotion>` for real (offset, opacity,
 * radius), and dropping those would break a chart type to close a hole they are
 * not in.
 */
const ANIMATION_TAGS = new Set(
  ['animate', 'set', 'animateTransform', 'animateMotion'].map((t) =>
    t.toLowerCase()
  )
);
const ANIMATED_URL_ATTRS = new Set(['href', 'xlink:href']);

function isUrlAnimation(node: Element): boolean {
  if (!ANIMATION_TAGS.has(node.localName.toLowerCase())) return false;
  const target = (node.getAttribute('attributeName') ?? '')
    .trim()
    .toLowerCase();
  return ANIMATED_URL_ATTRS.has(target);
}

/** Strip the script-execution surface from one already-parsed element. */
function scrubElement(node: Element): void {
  for (const attr of Array.from(node.attributes)) {
    if (attr.name.toLowerCase().startsWith('on')) {
      node.removeAttribute(attr.name);
    }
  }
  if (node.hasAttribute('href')) {
    const safe = safeHref(node.getAttribute('href'));
    if (safe === null) node.removeAttribute('href');
  }
  if (node.hasAttributeNS(XLINK_NS, 'href')) {
    const v = node.getAttributeNS(XLINK_NS, 'href');
    if (safeHref(v) === null) {
      node.removeAttributeNS(XLINK_NS, 'href');
    }
  }
}

/**
 * Strip script-execution surface from a freshly parsed SVG tree before it
 * lands in the live DOM. This is the safety net that lets us build SVG from
 * markup without trusting renderer output to be fully sanitized.
 *
 * Removes `<script>`/`<foreignObject>`, any SMIL element animating an `href`,
 * any `on*` event-handler attribute, and any `href`/`xlink:href` failing the
 * `safeHref` allowlist.
 *
 * Mutates `root` and returns nothing. Call it on a detached holder — see the
 * module comment above for why the order matters.
 */
export function sanitizeSvgInPlace(root: Element): void {
  const dangerous = root.querySelectorAll('script, foreignObject');
  dangerous.forEach((n) => n.remove());

  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const node of all) {
    if (isUrlAnimation(node)) {
      node.remove();
      continue;
    }
    scrubElement(node);
  }
}
