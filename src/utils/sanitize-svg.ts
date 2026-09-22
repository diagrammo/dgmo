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
 * 🔴 **Parse into a DETACHED holder, take the `<svg>`, sanitize, insert.** All
 * four steps, in that order:
 *
 * ```ts
 * const holder = document.createElement('div');
 * holder.innerHTML = svg;          // inert: nothing here is connected yet
 * const svgEl = holder.querySelector('svg');
 * if (svgEl) {
 *   sanitizeSvgInPlace(svgEl);
 *   container.replaceChildren(svgEl);
 * }
 * ```
 *
 * Sanitizing *after* assigning into a live container is too late: connecting
 * the subtree is what creates a nested browsing context for an `<iframe>` and
 * runs a custom element's `connectedCallback`, both synchronously inside the
 * assignment. And taking only the `<svg>` is half the safety — moving every
 * child of the holder across would connect whatever a hostile document put
 * *beside* the diagram. `auto/index.ts` and `element/index.ts` have always done
 * both; `mount.ts` learned them on diagrammo/diagrammo#884.
 *
 * 🔴 **What this does NOT do**, so a caller is not misled about the contract:
 *
 * - It does not parse CSS. An `@import` or a `url()` inside a `<style>`
 *   element passes through untouched.
 * - It removes the elements listed in `REMOVED_TAGS` and nothing else. That
 *   set is the script-execution and remote-content surface as of
 *   diagrammo/diagrammo#884; an element neither it nor the attribute scrub
 *   below names survives, so a caller sanitizing *arbitrary* HTML rather than
 *   dgmo renderer output needs its own allowlist on top.
 * - It does not stop a resource load that an attribute alone starts —
 *   `<img src>` fetches whether or not the node is connected. What protects
 *   that case is the `on*` strip, not the detached holder.
 * - It is no substitute for escaping where a renderer interpolates author
 *   text (see `src/embed/escape.ts`).
 *
 * Browser-only — it needs a live DOM. There is nothing to sanitize on the
 * rasterising path, which never builds a document.
 */

import { safeHref } from './safe-href';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Elements removed outright, payload and all.
 *
 * `script` and `foreignObject` were the original pair. The embedding four —
 * `iframe`, `object`, `embed`, `frame` — execute on connection exactly as a
 * script does: `<iframe srcdoc="<script>…">` and `<iframe src="javascript:…">`
 * need no handler attribute and no `href` for the allowlist to inspect, so
 * neither of the checks below sees them. `base` rewrites every relative URL in
 * the document that receives it, `link` loads remote CSS, and `meta
 * http-equiv="refresh"` navigates. None of the dgmo renderers emits any of the
 * eight — verified across `src/` on 2026-09-21 — so removing them costs no
 * chart type anything.
 *
 * 🔴 This is a REMOVAL set, not an allowlist, and the module comment says so
 * to the caller. Anything invented after this list was written survives it.
 */
const REMOVED_TAGS =
  'script, foreignObject, iframe, object, embed, frame, base, link, meta';

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
 * Removes every element in `REMOVED_TAGS`, any SMIL element animating an
 * `href`, any `on*` event-handler attribute, and any `href`/`xlink:href`
 * failing the `safeHref` allowlist.
 *
 * Mutates `root` and returns nothing. Call it on a detached holder — see the
 * module comment above for why the order matters, and for what this does not
 * cover.
 */
export function sanitizeSvgInPlace(root: Element): void {
  const dangerous = root.querySelectorAll(REMOVED_TAGS);
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
