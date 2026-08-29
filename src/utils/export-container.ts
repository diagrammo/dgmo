import { serializeSvg } from './svg-serialize';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';

/**
 * Creates an offscreen DOM container at the given dimensions, runs `fn` inside it,
 * then removes it (try/finally). Returns whatever `fn` returns.
 */
export function runInExportContainer<T>(
  width: number,
  height: number,
  fn: (container: HTMLDivElement) => T
): T {
  const container = document.createElement('div');
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);
  try {
    return fn(container);
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Extracts the SVG element from an export container, applies required export attributes
 * (xmlns, fontFamily, background), and returns its outerHTML.
 * Returns '' if no SVG element is found.
 *
 * Background rule (kept in lockstep with `finalizeSvgExport`): a `transparent`
 * theme forces `background: none`; light/dark get the opaque `palette.bg` unless
 * the renderer already painted its own root background. Pass `palette` so every
 * export path yields an opaque diagram; omit it only for transparent-only calls.
 */
/**
 * Paint the diagram background as a real `<rect>` covering the viewBox.
 *
 * Every export used to declare its background with `svgEl.style.background`
 * alone. CSS on an `<svg>` root is honoured by browsers and ignored by every
 * standalone SVG consumer — librsvg, Inkscape, Illustrator, `<img src>`. So an
 * exported `.svg` came out with a background for the six chart types that
 * happened to paint their own rect (cycle, map, pyramid, ring, treemap, goal)
 * and transparent for the other forty-odd. The CSS declaration stays for
 * browsers; this adds the rect the rest of the world needs.
 *
 * Idempotent: any existing full-canvas rect already filled with `palette.bg`
 * is removed first, so the renderers that paint their own do not double up.
 * A `transparent` theme paints nothing.
 */
export function paintRootBackground(
  svgEl: SVGSVGElement,
  theme: string,
  bg: string
): void {
  if (theme === 'transparent') return;
  const vb = (svgEl.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/);
  if (vb.length !== 4) return;
  const [x, y, w, h] = vb.map(Number) as [number, number, number, number];
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  const want = bg.trim().toLowerCase();
  for (const rect of Array.from(svgEl.querySelectorAll(':scope > rect'))) {
    const fill = (rect.getAttribute('fill') ?? '').trim().toLowerCase();
    if (fill !== want) continue;
    if (Number(rect.getAttribute('width')) !== w) continue;
    if (Number(rect.getAttribute('height')) !== h) continue;
    rect.remove();
  }
  const rect = svgEl.ownerDocument.createElementNS(
    'http://www.w3.org/2000/svg',
    'rect'
  );
  rect.setAttribute('class', 'dgmo-canvas-bg');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('fill', bg);
  svgEl.insertBefore(rect, svgEl.firstChild);
}

export function extractExportSvg(
  container: HTMLElement,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors
): string {
  const svgEl = container.querySelector('svg');
  if (!svgEl) return '';
  if (theme === 'transparent') {
    svgEl.style.background = 'none';
  } else if (palette && !svgEl.style.background) {
    svgEl.style.background = palette.bg;
  }
  svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgEl.style.fontFamily = FONT_FAMILY;
  svgEl.querySelectorAll('[data-export-ignore]').forEach((el) => el.remove());
  if (palette) paintRootBackground(svgEl, theme, palette.bg);
  return serializeSvg(svgEl);
}
