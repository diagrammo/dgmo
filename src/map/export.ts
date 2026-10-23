// ============================================================
// map/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { emit } from '../diagnostics';
import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext, MapDataSource } from '../utils/export-context';
import { MAP_DX } from './diagnostics';
import type { MapData } from './resolved-types';

/**
 * Normalize either form to the data, plus WHY there is none.
 *
 * 🔴 The `reason` is not decoration. This used to return a bare `undefined` for
 * both "the host supplied nothing" and "the host supplied a loader that threw",
 * which are opposite problems with opposite fixes — and it discarded the
 * loader's own message on the way. `loadMapData` throws
 * `map data assets not found near <dir> (looked in …)`, naming every directory
 * it tried; that sentence would have identified issue #121 (a CLI package
 * published with no map data) the moment anyone ran it, instead of surfacing as
 * a generic "the input may be invalid" and reading as a bad diagram.
 */
export async function resolveMapDataSource(
  source: MapDataSource | undefined
): Promise<{
  data?: MapData;
  reason?: string;
}> {
  if (source === undefined) return {};
  if (typeof source !== 'function') return { data: source };
  try {
    return { data: await source() };
  } catch (e) {
    return { reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function exportMap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, options } = ctx;
  const { parseMap } = await import('./parser');
  const { resolveMap } = await import('./resolver');
  const { renderMapForExport } = await import('./renderer');
  const { mapExportDimensions } = await import('./dimensions');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const mapParsed = parseMap(content, effectivePalette);
  // Always render — an empty or partially-resolved map still draws the
  // inferred base map (§24B.10 / layout AC23); diagnostics surface separately.
  //
  // The host supplies the basemap: bundled `MapData` (browser) or a loader
  // (Node hosts pass `loadMapData`). This function reaches for neither the disk
  // nor the network on its own, so a caller can tell from the signature that a
  // render cannot touch its environment. With nothing supplied — or a loader
  // that threw — degrade to '' like every other branch, but say why through the
  // diagnostics out-param rather than failing silently.
  const { data: mapData, reason } = await resolveMapDataSource(
    options?.mapData
  );
  if (!mapData) {
    options?.onMapResolverDiagnostics?.([
      emit(MAP_DX.DATA_NOT_SUPPLIED, 1, reason !== undefined ? { reason } : {}),
    ]);
    return '';
  }
  const mapResolved = resolveMap(mapParsed, mapData);
  // Hand the resolver diagnostics out to render() — resolveMap seeds them with
  // the parser's, so this is the full superset the editor needs.
  options?.onMapResolverDiagnostics?.(mapResolved.diagnostics);

  // Content-aware canvas: derive the height from the map's intrinsic projected
  // aspect (world ~2.3:1, a region taller, etc.) instead of the fixed 800, so the
  // export matches the content's natural shape — no vertical stretch, no
  // letterbox bands. `preferContain` rides along to the renderer.
  const dims = mapExportDimensions(
    mapResolved,
    mapData,
    ctx.width,
    options?.mapAspect
  );
  const container = createExportContainer(dims.width, dims.height);
  renderMapForExport(
    container,
    mapResolved,
    mapData,
    effectivePalette,
    ctx.isDark,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
