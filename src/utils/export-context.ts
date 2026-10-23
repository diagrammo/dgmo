// ============================================================
// utils/export-context.ts — what every chart's export handler is handed, and
// the small helpers they share (#1362). The handlers live beside their charts
// (src/<chart>/export.ts); d3.ts keeps only the dispatch.
// ============================================================

import type { DgmoError } from '../diagnostics';
import type { MapData } from '../map/resolved-types';
import type { CompactViewState } from '../sharing';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from './d3-types';
import { createExportContainer } from './d3-helpers';

/**
 * How a host supplies map basemap assets: the data itself, or a loader that
 * returns it. Declared here (rather than accepting only `MapData`) so a Node
 * host can hand over `loadMapData` without paying to read eleven JSON files on
 * a render that turns out not to be a map — the loader is called only inside
 * the map branch.
 */
export type MapDataSource = MapData | (() => Promise<MapData>);

export type RenderForExportOptions = {
  c4Level?: 'context' | 'containers' | 'components' | 'deployment';
  c4System?: string;
  c4Container?: string;
  tagGroup?: string;
  exportMode?: boolean;
  // Map basemap assets, supplied by the host — either the data itself (browser
  // callers bundle the JSON) or a loader that returns it (Node hosts pass
  // `loadMapData`). There is no fallback: this module reads nothing from disk
  // or the network on its own, so omitting it degrades a map to '' plus an
  // `E_MAP_DATA_NOT_SUPPLIED` diagnostic.
  mapData?: MapDataSource;
  // WYSIWYG map export: the live preview pane's displayed aspect (w/h). When
  // set, the map canvas adopts it + stretch-fills so the PNG matches the
  // on-screen map. The app passes this; headless consumers omit it.
  mapAspect?: number;
  // Out-param (map only): exportMap deposits the ResolvedMap's diagnostics here
  // so render() can surface resolver errors (unknown place/subdivision) without
  // re-running parseMap+resolveMap purely for diagnostics. Not called when the
  // map assets fail to load (exportMap degrades to '' before resolving).
  onMapResolverDiagnostics?: (diagnostics: readonly DgmoError[]) => void;
  /**
   * Canvas to draw onto, in px. Defaults to EXPORT_WIDTH x EXPORT_HEIGHT.
   *
   * Every chart used to render onto a fixed 1200x800 sheet, so a caller who
   * fitted the result to a narrow column got its ASPECT too — a one-line goal
   * meter arrived 800px tall with the bar as a sliver in the middle. Callers
   * that know the shape they need can now say so; omitting these keeps the
   * previous canvas exactly.
   */
  width?: number;
  height?: number;
  /**
   * Whiteboard images: turn a ref (relative path or https URL) into an href.
   * Supplied → its answer is final, `undefined` draws the placeholder box.
   * Omitted → https refs pass through and the rest are placeholders.
   */
  resolveImage?: (ref: string) => string | undefined;
  /**
   * Whiteboard sticky notes: `true` draws them and `false` hides them,
   * whatever the board's `no-notes` says. Omitted → the directive decides.
   */
  showNotes?: boolean;
};

/** Everything an export handler needs — one bundle threaded through dispatch. */
export interface ExportContext {
  content: string;
  theme: 'light' | 'dark' | 'transparent';
  palette: PaletteColors | undefined;
  viewState: CompactViewState | undefined;
  options: RenderForExportOptions | undefined;
  exportMode: boolean;
  /** Whether the theme is dark, resolved once in renderForExport (Story 111.2). */
  isDark: boolean;
  /** The canvas every handler draws onto — the caller's, or the default sheet. */
  width: number;
  height: number;
  /** The caller's raw request, `undefined` when they made none. */
  requestedWidth: number | undefined;
  requestedHeight: number | undefined;
}

export type DiagramExportHandler = (ctx: ExportContext) => Promise<string>;

/**
 * The tag-group override threaded into every handler: an explicit viewState tag
 * (app toggle / share link) wins, else the options.tagGroup fallback. Resolved
 * from ctx so handlers stop repeating the viewState/options fallback
 * shape (Story 111.2).
 */
export function ctxTagOverride(ctx: ExportContext): string | undefined {
  return ctx.viewState?.tag ?? ctx.options?.tagGroup;
}

/**
 * Merge the source `hide` directive (comma-separated attribute keys) with any
 * interactive `viewState.ha`, lowercasing both so they match the parser's
 * lowercased metadata keys. Returns `undefined` when nothing is hidden.
 */
export function unionHiddenAttributes(
  hideOption: string | undefined,
  ha: readonly string[] | undefined
): Set<string> | undefined {
  const sourceHidden = hideOption
    ? hideOption
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const union = new Set([...sourceHidden, ...(ha ?? [])]);
  return union.size > 0 ? union : undefined;
}

/**
 * Shared export prelude for the D3 visualizations: offscreen container + the
 * canonical export dimensions. Each per-viz handler renders into the container
 * then finalizes it.
 */
export function beginVizExport(ctx: ExportContext): {
  container: HTMLDivElement;
  dims: D3ExportDimensions;
} {
  const container = createExportContainer(ctx.width, ctx.height);
  const dims: D3ExportDimensions = {
    width: ctx.width,
    height: ctx.height,
  };
  return { container, dims };
}
