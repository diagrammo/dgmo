// ============================================================
// @diagrammo/dgmo — Public API
// ============================================================
//
// This is the frozen public surface. Everything else lives in
// `@diagrammo/dgmo/advanced` (unstable, no semver), `@diagrammo/dgmo/editor`,
// `@diagrammo/dgmo/highlight`, or `@diagrammo/dgmo/auto`.
//
// If you need something not exported here, import from `/advanced` and
// accept the no-semver contract. (The legacy `/internal` alias was removed at 1.0.)

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
import { renderErrorCard } from './error-card';

export type { CompactViewState } from './sharing';

// ============================================================
// render(text, options?)
// ============================================================

export interface RenderOptions {
  theme?: Theme;
  /**
   * A `PaletteConfig` (e.g. `palettes.catppuccin`) or a palette id string
   * (e.g. `'catppuccin'`). Unknown ids fall back to the default palette.
   */
  palette?: PaletteConfig | string;
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
  // Accept either a PaletteConfig object or a palette-id string. The embed
  // block and other callers pass the id by name; normalizing here means the
  // resolved config flows to BOTH renderInternal and the error card (which
  // indexes palette.light/.dark — a bare string id crashed it).
  const palette =
    typeof options?.palette === 'string'
      ? getPalette(options.palette)
      : (options?.palette ?? palettes.slate);
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

  // 'svg' (default): render an inline error card so the author sees what
  // broke, on which line, and the offending source — see error-card.ts.
  // We show the card whenever there are error-severity diagnostics, even if a
  // parser produced a partial SVG: a misleading half-diagram is worse than a
  // clear "here's what's wrong" for an embedded host (remark/astro/obsidian).
  return {
    svg: renderErrorCard(errors, text, palette, options?.theme),
    diagnostics: result.diagnostics,
  };
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
export {
  normalizeSvgForEmbed,
  getEmbedSvgViewBox,
  defaultEmbedBackground,
} from './utils/svg-embed';
export type { NormalizeSvgForEmbedOptions } from './utils/svg-embed';

// ============================================================
// Map chart-type completion (gazetteer-fed; §24B.5/.8)
// ============================================================
// Pure + dependency-injected: the caller supplies the `Gazetteer` asset. Safe
// to export from the main index — no d3-geo/topojson runtime imports.
export {
  completeMapPlaces,
  completeMapRegions,
  searchMapLocations,
} from './map/completion';
export type {
  MapPlaceCompletion,
  MapRegionCompletion,
  MapCompletionOptions,
  MapLocationMatch,
} from './map/completion';
export type {
  Gazetteer,
  GazetteerEntry,
  RegionName,
  RegionNames,
} from './map/data/types';

// ============================================================
// Chart-type registry (stable; cross-consumer essential — promoted to
// root at 1.0 so consumers needn't reach into the no-semver `/advanced`)
// ============================================================
export { chartTypes } from './chart-types';
export type { ChartTypeMeta } from './chart-types';

// ============================================================
// Map data (DI asset shape; stable — promoted to root at 1.0 for the
// obsidian/app browser-render path that injects bundled map JSON)
// ============================================================
export type { MapData } from './map/resolved-types';

// ============================================================
// SPIKE: hand-built D3 data-chart engine — interactive mount + adapter
// (browser-runtime; lets hosts replace the ECharts live-preview path)
// ============================================================
export { mountD3DataChart } from './charts-d3/mount';
export type { MountedD3Chart, MountD3Opts } from './charts-d3/mount';
export {
  attachDataChartInteractions,
  type DataChartInteractionOpts,
} from './charts-d3/interactions';
export { supportsD3DataChart, D3_DATA_CHART_TYPES } from './charts-d3';

// ============================================================
// Public types
// ============================================================

export type { PaletteConfig, PaletteColors } from './palettes/types';
export type { DgmoError, DgmoSeverity } from './diagnostics';
export { emit } from './diagnostics';
export type {
  DiagnosticSpec,
  DiagnosticParams,
  EmitOptions,
} from './diagnostics';
export { listDiagnosticCodes, getDiagnosticSpec } from './diagnostics-registry';
