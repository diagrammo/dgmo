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
  return svgEl.outerHTML;
}
