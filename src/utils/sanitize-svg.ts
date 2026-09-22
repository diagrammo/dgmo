/**
 * The supported sanitizing boundary for renderer output that is about to land
 * in a live document.
 *
 * Renderer output is trusted only as far as the renderer that produced it, and
 * every host — the desktop app, the web editor, Obsidian, the script-tag
 * drop-ins, this library's own `mountD3DataChart` — puts that output into the
 * DOM with `innerHTML` or `dangerouslySetInnerHTML`. This module is what they
 * call first. It lives here, beside `safe-href`, rather than inside
 * `src/auto/shared.ts` where it started: that module is the browser-embed
 * bundle's private toolbox, reachable only from the two IIFE script-tag
 * builds, so a host importing `@diagrammo/dgmo` could not call the sanitizer
 * at all however much it wanted to.
 *
 * Both entry points are **browser-only** — they need a live DOM. There is
 * nothing to sanitize on the rasterising path, which never builds a document.
 */

import { safeHref } from './safe-href';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

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
 * lands in the live DOM. This is the safety net that lets us use innerHTML
 * for SVG insertion without trusting renderer output to be fully sanitized.
 *
 * Removes `<script>`/`<foreignObject>`, any `on*` event-handler attribute,
 * and any `href`/`xlink:href` failing the `safeHref` allowlist.
 *
 * Mutates `root` and returns nothing — call it on the element you have just
 * inserted, or on the container you inserted into.
 */
export function sanitizeSvgInPlace(root: Element): void {
  const dangerous = root.querySelectorAll('script, foreignObject');
  dangerous.forEach((n) => n.remove());

  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const node of all) {
    scrubElement(node);
  }
}

/**
 * The string form, for a host that cannot reach the element it is about to
 * create — React's `dangerouslySetInnerHTML` takes markup, not a node, so
 * `sanitizeSvgInPlace` is unreachable there.
 *
 * Parses `markup` into an inert `<template>` (scripts do not run and
 * resources are not fetched in template content), applies exactly the same
 * scrub as `sanitizeSvgInPlace`, and serializes the result back.
 *
 * 🔴 The output is safe to assign; the input never is. Sanitizing and then
 * concatenating more markup onto the result puts you back where you started.
 */
export function sanitizeSvgMarkup(markup: string): string {
  if (typeof document === 'undefined') {
    throw new Error(
      'sanitizeSvgMarkup needs a DOM; it is a browser-only boundary'
    );
  }
  const tpl = document.createElement('template');
  // Inert by specification: template content belongs to a separate document
  // with no browsing context, so nothing here executes or loads.
  tpl.innerHTML = markup;

  const frag = tpl.content;
  frag
    .querySelectorAll('script, foreignObject')
    .forEach((n: Element) => n.remove());
  frag.querySelectorAll('*').forEach((node: Element) => scrubElement(node));

  return tpl.innerHTML;
}
