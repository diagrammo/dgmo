// ============================================================
// Countdown chart — redraw a baked SVG whose band has gone stale
// ============================================================
//
// The ticker rewrites text every second but never the band (the calendar under
// the hero): that needs the renderer, which is too heavy for the ticker. A
// static page baked yesterday keeps yesterday's "today" chip, and a recurring
// countdown that rolled forward keeps a calendar that no longer holds its day.
// The ticker loads this module only when it sees that, so a page whose
// countdowns are current never downloads it.
//
// Everything the redraw needs rides the SVG itself in
// `data-dgmo-countdown-redraw`, stamped by the renderer: a static page has no
// source or palette to go back to.

import type { PaletteColors } from '../palettes';
import { normalizeSvgForEmbed } from '../utils/svg-embed';
import { renderCountdown } from './renderer';
import type { ParsedCountdown } from './types';

interface RedrawPayload {
  parsed: ParsedCountdown;
  palette: PaletteColors;
  isDark: boolean;
  width: number;
  height: number;
}

/**
 * Draw `svg` again for `resolvedMs` (the occurrence the ticker resolved for
 * now) and swap the new drawing into the same element, so the host's wrapper,
 * classes and accessible description stay put. Fires `dgmo:countdown-redrawn`
 * on the element afterwards, for hosts that adjust a drawing once it is in the
 * page (remark-dgmo tightens the viewBox).
 */
export function redrawCountdown(svg: SVGSVGElement, resolvedMs: number): void {
  const raw = svg.getAttribute('data-dgmo-countdown-redraw');
  if (!raw) return;
  let p: RedrawPayload;
  try {
    p = JSON.parse(raw) as RedrawPayload;
  } catch {
    return;
  }

  const doc = svg.ownerDocument;
  const container = doc.createElement('div');
  renderCountdown(container, { ...p.parsed, resolvedMs }, p.palette, p.isDark, {
    width: p.width,
    height: p.height,
  });
  let fresh = container.querySelector('svg');
  if (!fresh) return;

  // An embed (remark-dgmo, the block API) went through normalizeSvgForEmbed:
  // root size stripped, viewBox tightened, and the root background removed
  // unless the embed kept it. Put the new drawing through the same step.
  if (!svg.hasAttribute('width')) {
    const bg = p.palette.bg.trim().toLowerCase();
    const keptBackground =
      /background/i.test(svg.getAttribute('style') ?? '') ||
      Array.from(svg.children).some(
        (c) =>
          c.tagName.toLowerCase() === 'rect' &&
          (c.getAttribute('fill') ?? '').trim().toLowerCase() === bg
      );
    // The root background the build's export step paints; the embed step
    // keys its stripping off it, exactly as it did at build time.
    fresh.style.background = p.palette.bg;
    const holder = doc.createElement('div');
    holder.innerHTML = normalizeSvgForEmbed(fresh.outerHTML, {
      background: keptBackground ? 'opaque' : 'transparent',
    });
    fresh = holder.querySelector('svg');
    if (!fresh) return;
  }

  // Keep the host's <desc> (an embed points aria-describedby at it); take
  // every other child from the new drawing.
  Array.from(svg.childNodes).forEach((c) => {
    if (
      !(c.nodeType === 1 && (c as Element).tagName.toLowerCase() === 'desc')
    ) {
      svg.removeChild(c);
    }
  });
  Array.from(fresh.childNodes).forEach((c) => {
    const isDesc =
      c.nodeType === 1 && (c as Element).tagName.toLowerCase() === 'desc';
    if (!isDesc) svg.appendChild(doc.importNode(c, true));
  });
  for (const name of ['viewBox', 'width', 'height', 'aria-label']) {
    const v = fresh.getAttribute(name);
    if (v !== null) svg.setAttribute(name, v);
  }
  const payload = fresh.getAttribute('data-dgmo-countdown-redraw');
  if (payload !== null) svg.setAttribute('data-dgmo-countdown-redraw', payload);
  else svg.removeAttribute('data-dgmo-countdown-redraw');

  // The page's own CustomEvent, so a test DOM or an iframe gets its own kind.
  const view = doc.defaultView;
  if (view && typeof view.CustomEvent === 'function') {
    svg.dispatchEvent(
      new view.CustomEvent('dgmo:countdown-redrawn', { bubbles: true })
    );
  }
}
