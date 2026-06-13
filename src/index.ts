// ============================================================
// @diagrammo/dgmo — Public API
// ============================================================
//
// This is the frozen public surface. ~12 exports. Everything else lives in
// `@diagrammo/dgmo/internal` (unstable, no semver), `@diagrammo/dgmo/editor`,
// `@diagrammo/dgmo/highlight`, or `@diagrammo/dgmo/auto`.
//
// If you need something not exported here, import from `/internal` and
// accept the no-semver contract.

import { render as renderInternal } from './render';
import {
  encodeDiagramUrl as encodeDiagramUrlInternal,
  decodeDiagramUrl as decodeDiagramUrlInternal,
  type CompactViewState,
} from './sharing';
import { parseDgmo as validate } from './dgmo-router';
import { palettes, getPalette } from './palettes';
import type { PaletteConfig } from './palettes/types';
import type { Theme } from './themes';
import { formatDgmoError, type DgmoError } from './diagnostics';

export type { CompactViewState } from './sharing';

// ============================================================
// render(text, options?)
// ============================================================

export interface RenderOptions {
  theme?: Theme;
  palette?: PaletteConfig;
  /**
   * How to handle parse errors:
   *   'svg'    — render an inline error SVG (default)
   *   'silent' — return empty svg + diagnostics; caller handles UI
   *   'throw'  — throw an Error with the diagnostics
   */
  onError?: 'svg' | 'silent' | 'throw';
  /**
   * Pre-applied interactive view state — collapsed sections/columns,
   * active swimlane tag-group, etc. Used to render a specific view
   * non-interactively (server-side render, share-link decode).
   */
  viewState?: CompactViewState;
}

export interface RenderResult {
  svg: string;
  diagnostics: DgmoError[];
}

/**
 * Render DGMO source to an SVG string.
 *
 * @example
 * ```ts
 * import { render, palettes, themes } from '@diagrammo/dgmo';
 *
 * const { svg } = await render(text, {
 *   palette: palettes.catppuccin,
 *   theme: themes.dark,
 * });
 * document.getElementById('chart').innerHTML = svg;
 * ```
 */
export async function render(
  text: string,
  options?: RenderOptions
): Promise<RenderResult> {
  const palette = options?.palette ?? palettes.slate;
  const onError = options?.onError ?? 'svg';

  const result = await renderInternal(text, {
    ...(options?.theme !== undefined && { theme: options.theme }),
    palette: palette.id,
    ...(options?.viewState !== undefined && { viewState: options.viewState }),
  });

  const errors = result.diagnostics.filter((d) => d.severity === 'error');

  if (errors.length === 0) {
    return result;
  }

  if (onError === 'throw') {
    throw new Error(
      `DGMO parse error: ${errors.map(formatDgmoError).join('; ')}`
    );
  }

  if (onError === 'silent') {
    return result;
  }

  // 'svg' (default): render an inline error SVG so the user sees the problem
  return {
    svg: result.svg || renderErrorSvg(errors, palette, options?.theme),
    diagnostics: result.diagnostics,
  };
}

function renderErrorSvg(
  errors: DgmoError[],
  palette: PaletteConfig,
  theme?: Theme
): string {
  const colors = palette[theme === 'dark' ? 'dark' : 'light'];
  const bg = theme === 'transparent' ? 'transparent' : colors.bg;
  const fg = colors.destructive ?? colors.text;
  const muted = colors.textMuted ?? colors.text;
  const lines = errors.slice(0, 5).map((e) => formatDgmoError(e));
  const height = 60 + lines.length * 20;
  const body = lines
    .map(
      (line, i) =>
        `<text x="20" y="${60 + i * 20}" fill="${fg}" font-family="ui-monospace, monospace" font-size="12">${escapeXml(line)}</text>`
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}"><rect width="100%" height="100%" fill="${bg}"/><text x="20" y="34" fill="${muted}" font-family="system-ui, sans-serif" font-size="13" font-weight="600">DGMO parse error</text>${body}</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// validate(text)
// ============================================================

export { validate };

// ============================================================
// formatDgmoError(err)
// ============================================================

export { formatDgmoError };

// ============================================================
// Sharing — encodeDiagramUrl / decodeDiagramUrl
// ============================================================

export interface EncodeDiagramUrlOptions {
  baseUrl?: string;
  palette?: PaletteConfig;
  theme?: Theme;
  filename?: string;
  /**
   * Initial view state to embed in the URL — re-applied when the link is
   * decoded so recipients open the diagram in the same configuration.
   */
  viewState?: CompactViewState;
}

/**
 * Encode DGMO text into a shareable URL. Returns null if the compressed
 * payload exceeds the 8 KB URL limit.
 */
export function encodeDiagramUrl(
  text: string,
  options?: EncodeDiagramUrlOptions
): string | null {
  const internalTheme =
    options?.theme === 'light' || options?.theme === 'dark'
      ? options.theme
      : undefined;
  const result = encodeDiagramUrlInternal(text, {
    ...(options?.baseUrl !== undefined && { baseUrl: options.baseUrl }),
    ...(options?.palette?.id !== undefined && { palette: options.palette.id }),
    ...(internalTheme !== undefined && { theme: internalTheme }),
    ...(options?.filename !== undefined && { filename: options.filename }),
    ...(options?.viewState !== undefined && { viewState: options.viewState }),
  });
  return 'error' in result && result.error ? null : (result.url ?? null);
}

export interface DecodedDiagramUrl {
  text: string;
  palette?: PaletteConfig;
  theme?: Theme;
  filename?: string;
}

/**
 * Decode a share URL back into DGMO text plus optional palette/theme/filename.
 * Returns null if the URL contains no valid DGMO payload.
 */
export function decodeDiagramUrl(url: string): DecodedDiagramUrl | null {
  const decoded = decodeDiagramUrlInternal(url);
  if (!decoded.dsl) return null;
  const palette = decoded.palette ? getPalette(decoded.palette) : undefined;
  const out: DecodedDiagramUrl = { text: decoded.dsl };
  if (palette) out.palette = palette;
  if (decoded.theme) out.theme = decoded.theme;
  if (decoded.filename) out.filename = decoded.filename;
  return out;
}

// ============================================================
// Palettes + themes (namespaces)
// ============================================================

export { palettes, getPalette, resolvePaletteOrFallback } from './palettes';
export { themes, type Theme } from './themes';

// ============================================================
// getMinDimensions(text)
// ============================================================

export { getMinDimensions } from './dimensions';

// ============================================================
// SVG embed normalization (responsive inline embedding)
// ============================================================
// Tightens a static render() SVG's viewBox to its content + strips fixed
// width/height so hosts (Obsidian, remark/markdown, web) can size it to its
// natural aspect ratio with no dead space. Pure string transform.
export { normalizeSvgForEmbed, getEmbedSvgViewBox } from './utils/svg-embed';

// ============================================================
// Map chart-type completion (gazetteer-fed; §24B.5/.8)
// ============================================================
// Pure + dependency-injected: the caller supplies the `Gazetteer` asset. Safe
// to export from the main index — no d3-geo/topojson runtime imports.
export { completeMapPlaces, completeMapRegions } from './map/completion';
export type {
  MapPlaceCompletion,
  MapRegionCompletion,
  MapCompletionOptions,
} from './map/completion';
export type {
  Gazetteer,
  GazetteerEntry,
  RegionName,
  RegionNames,
} from './map/data/types';

// ============================================================
// Public types
// ============================================================

export type { PaletteConfig, PaletteColors } from './palettes/types';
export type { DgmoError, DgmoSeverity } from './diagnostics';
