// Vertical band reserved at the top of a map canvas for the choropleth / tag
// legend, so the projected land starts BELOW the legend instead of being covered
// by it. The legend (§24B.11) is drawn as a top-center foreground overlay; on a
// world map that placement sits over land (e.g. Europe), hiding it. Reserving a
// band in the fit box pushes the map down so the legend clears the land.
//
// Shared by `layoutMap` (grows `topPad`) and `mapExportDimensions` is intentionally
// NOT a consumer — the canvas height is independent; the band only repositions the
// map WITHIN the canvas. The group builder + config are reused by the renderer so
// the measured band matches exactly what gets drawn.
import { computeLegendLayout } from '../utils/legend-layout';
import { TITLE_FONT_SIZE, TITLE_Y } from '../utils/title-constants';
import type {
  LegendConfig,
  LegendGroupData,
  LegendMode,
  LegendState,
} from '../utils/legend-types';
import type { MapLayoutLegend } from './types';

// Gap between the title/subtitle banner and the legend top — mirrors the `+ 8`
// in renderer.ts `legendY`.
const LEGEND_TOP_GAP = 8;
// Gap between the legend bottom and the start of the map content.
const LEGEND_BOTTOM_GAP = 10;

/** The legend's colouring groups (score ramp first, then non-empty tag groups) —
 *  the SAME array the renderer draws, so a measured layout matches the rendered
 *  one. Empty when the legend has neither a ramp nor any populated tag group. */
export function mapLegendGroups(legend: MapLayoutLegend): LegendGroupData[] {
  const ramp = legend.ramp;
  // Reserved name "Value" when no region-heat label is set — must match
  // VALUE_NAME in layout.ts so the resolved activeGroup selects it.
  const scoreGroup: LegendGroupData | null = ramp
    ? {
        name: ramp.metric?.trim() || 'Value',
        entries: [],
        gradient: {
          min: ramp.min,
          max: ramp.max,
          low: ramp.low,
          high: ramp.high,
        },
      }
    : null;
  const tagGroups: LegendGroupData[] = legend.tagGroups
    .filter((g) => g.entries.length > 0)
    .map((g) => ({ name: g.name, entries: [...g.entries] }));
  return [...(scoreGroup ? [scoreGroup] : []), ...tagGroups];
}

/** The shared map-legend config (top-center, below the title, inactive pills kept
 *  so the preview can flip the active colouring dimension). `mode` gates the
 *  export-only filtering (active group only). */
export function mapLegendConfig(
  groups: readonly LegendGroupData[],
  mode: LegendMode
): LegendConfig {
  return {
    groups,
    position: { placement: 'top-center', titleRelation: 'below-title' },
    mode,
    showEmptyGroups: false,
    showInactivePills: true,
  };
}

/** Y of the legend's top edge — mirrors `legendY` in renderer.ts. */
export function mapLegendTop(hasTitle: boolean, hasSubtitle: boolean): number {
  return (
    (hasTitle ? TITLE_Y + TITLE_FONT_SIZE : 0) +
    (hasSubtitle ? TITLE_FONT_SIZE : 0) +
    LEGEND_TOP_GAP
  );
}

/** Total vertical band (px from the canvas top) the legend occupies = its top Y +
 *  measured height + a bottom gap. Returns 0 when no legend is drawn, so callers
 *  can `Math.max` it into their existing top reserve without special-casing. */
export function mapLegendBand(
  legend: MapLayoutLegend | null,
  opts: {
    width: number;
    mode: LegendMode;
    hasTitle: boolean;
    hasSubtitle: boolean;
  }
): number {
  if (!legend) return 0;
  const groups = mapLegendGroups(legend);
  if (groups.length === 0) return 0;
  const config = mapLegendConfig(groups, opts.mode);
  const state: LegendState = { activeGroup: legend.activeGroup };
  const { height } = computeLegendLayout(config, state, opts.width);
  if (height <= 0) return 0;
  return (
    mapLegendTop(opts.hasTitle, opts.hasSubtitle) + height + LEGEND_BOTTOM_GAP
  );
}

/** The legend's actual centred bounding box (top-centre overlay), or null when no
 *  legend is drawn. Used to feed the legend into the on-map label collision set so
 *  a region / context name never lands under it. Mirrors `mapLegendBand` but keeps
 *  the width + x rather than collapsing to a band height. */
export function mapLegendBox(
  legend: MapLayoutLegend | null,
  opts: {
    width: number;
    mode: LegendMode;
    hasTitle: boolean;
    hasSubtitle: boolean;
  }
): { x: number; y: number; width: number; height: number } | null {
  if (!legend) return null;
  const groups = mapLegendGroups(legend);
  if (groups.length === 0) return null;
  const config = mapLegendConfig(groups, opts.mode);
  const state: LegendState = { activeGroup: legend.activeGroup };
  const { width, height } = computeLegendLayout(config, state, opts.width);
  if (height <= 0 || width <= 0) return null;
  return {
    x: (opts.width - width) / 2,
    y: mapLegendTop(opts.hasTitle, opts.hasSubtitle),
    width,
    height,
  };
}
