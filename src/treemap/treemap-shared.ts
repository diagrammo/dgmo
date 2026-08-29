// ============================================================
// Treemap — Geometry-independent shared helpers
// ============================================================
//
// Color resolution, the depth-tint ramp, value/percent compaction, and legend
// assembly are geometry-neutral: the rectangular renderer (`renderer.ts`) and
// the radial/sunburst renderer (`renderer-radial.ts`) both consume them so the
// two modes share ONE color engine and ONE tint ramp (no drift — the outer-ring
// wash-out the tint floor guards against can only be fixed in one place).

import { scaleLinear } from 'd3-scale';
import { resolveColor } from '../colors';
import { mix } from '../palettes/color-utils';
import { resolveTagColor, tagAttrKey } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type { LegendGroupData } from '../utils/legend-types';
import type { PaletteColors } from '../palettes';
import type { ParsedTreemap, TreemapColorMode, TreemapNode } from './types';

/**
 * Fill for cells with no resolvable colour (missing heat / tag / node).
 *
 * A fixed `'#cbd5e1'` until 2026-08-28 — a light slate that sat on a dark
 * canvas as a bright slab and never matched a non-default palette. Derived
 * from the live palette now: the neutral hue pulled most of the way toward
 * the background, so it reads as "nothing here" in either theme.
 */
export function mutedFill(palette: PaletteColors): string {
  return mix(palette.colors.gray, palette.bg, 35);
}

// ============================================================
// Depth-tint ramp (branch mode) — with a FLOORED lightness
// ============================================================

/**
 * Branch-mode depth tint: the top-level hue, progressively lightened toward the
 * background the deeper a cell sits. `mix` keeps a PERCENTAGE of the first color
 * (0–100), so deeper cells retain less hue. The keep-percent is FLOORED at 55 so
 * the outermost ring/leaf stays clearly saturated instead of washing out into
 * the background (protects legibility of deep radial trees + deep rect trees).
 */
export function depthTint(hue: string, depth: number, bg: string): string {
  if (depth <= 1) return hue;
  const keepPct = Math.max(55, 100 - (depth - 1) * 18);
  return mix(hue, bg, keepPct);
}

// ============================================================
// Color mode resolution
// ============================================================

export function resolveColorMode(
  parsed: ParsedTreemap,
  override?: TreemapColorMode
): TreemapColorMode {
  let mode = override ?? parsed.defaultColorMode;
  // Inapplicable-mode fallbacks follow the universal heat → tag → branch
  // precedence (decision #48).
  if (mode === 'heat' && !parsed.hasHeat) {
    mode = parsed.tagGroups.length > 0 ? 'tag' : 'branch';
  }
  if (mode === 'tag' && parsed.tagGroups.length === 0) {
    mode = parsed.hasHeat ? 'heat' : 'branch';
  }
  return mode;
}

/**
 * The tag group that drives categorical fill when the active mode is `tag`:
 * the group the `active-tag` directive names (§24C.6), else the first declared
 * group (the no-directive default). `null` when no groups are declared.
 */
export function activeTagGroupOf(parsed: ParsedTreemap): TagGroup | null {
  if (parsed.tagGroups.length === 0) return null;
  const at = parsed.activeTag?.trim().toLowerCase();
  if (at) {
    const g = parsed.tagGroups.find((x) => x.name.toLowerCase() === at);
    if (g) return g;
  }
  return parsed.tagGroups[0]!;
}

// ============================================================
// Per-cell color resolution (was the `colorOf` closure in renderer.ts)
// ============================================================

/** Geometry-neutral subset of a cell needed to resolve its color. Both
 *  `TreemapCell` (rect) and `RadialCell` (sunburst) are structurally assignable. */
export interface ColorCell {
  readonly node: TreemapNode | null;
  readonly label: string;
  readonly depth: number;
  readonly heat?: number;
  readonly topIndex: number;
  readonly path: readonly string[];
}

/** Everything the cell-color resolver needs that is NOT on the cell itself. */
export interface CellColorContext {
  readonly mode: TreemapColorMode;
  readonly heat: HeatScale | null;
  readonly tagGroups: readonly TagGroup[];
  readonly activeGroup: string | null;
  /** Top-level label → source-order index (drives the branch hue). */
  readonly rootIndexByLabel: Map<string, number>;
  readonly seriesColors: string[];
  readonly colorOffset: number;
  /** Palette background, for the depth-tint mix. */
  readonly bg: string;
  /** Fill for a cell whose colour cannot be resolved. */
  readonly muted: string;
}

/**
 * Resolve a cell's base color for the active mode:
 *  - heat: the data-aware ramp keyed off `cell.heat`.
 *  - tag:  the cell's tagged ancestor color.
 *  - branch: the top-level hue (source order), tinted lighter with depth.
 * Only the branch tail touches `cell.depth`; nothing here touches geometry.
 */
export function resolveCellColor(
  cell: ColorCell,
  ctx: CellColorContext
): string {
  if (ctx.mode === 'heat') {
    return cell.heat !== undefined && ctx.heat
      ? ctx.heat.scale(cell.heat)
      : ctx.muted;
  }
  if (ctx.mode === 'tag') {
    if (!cell.node) return ctx.muted;
    return (
      resolveTagColor(
        cell.node.metadata,
        ctx.tagGroups as TagGroup[],
        ctx.activeGroup
      ) ?? ctx.muted
    );
  }
  // branch: top-level hue, lightened slightly with depth (floored).
  const topLabel = cell.path[0] ?? cell.label;
  const idx =
    (ctx.rootIndexByLabel.get(topLabel) ?? cell.topIndex) + ctx.colorOffset;
  const hue = ctx.seriesColors[idx % ctx.seriesColors.length]!;
  return depthTint(hue, cell.depth, ctx.bg);
}

// ============================================================
// Heat scale (data-aware color-by-value ramp)
// ============================================================

export interface HeatScale {
  scale: (v: number) => string;
  min: number;
  max: number;
  stops: string[];
  signed: boolean;
}

export function buildHeatScale(
  parsed: ParsedTreemap,
  palette: PaletteColors
): HeatScale | null {
  if (!parsed.hasHeat) return null;
  const values: number[] = [];
  const collect = (nodes: readonly TreemapNode[]): void => {
    for (const n of nodes) {
      if (typeof n.heat === 'number') values.push(n.heat);
      collect(n.children);
    }
  };
  collect(parsed.roots);
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const signed = min < 0 && max > 0;

  const neutral = palette.surface;
  const explicit = parsed.options.heatColors
    .map((c) => resolveColor(c, palette) ?? c)
    .filter((c): c is string => !!c);

  let stops: string[];
  let domain: number[];

  if (explicit.length >= 2) {
    // Two endpoints → low · neutral · high (wide-hue auto-midpoint).
    stops = [explicit[0]!, neutral, explicit[1]!];
    const mid = signed ? 0 : (min + max) / 2;
    domain = [min, mid, max];
  } else if (explicit.length === 1) {
    stops = [neutral, explicit[0]!];
    domain = [min, max];
  } else if (signed) {
    // Data-aware default: diverging, midpoint pinned at 0.
    stops = [palette.colors.red, neutral, palette.colors.green];
    domain = [min, 0, max];
  } else {
    // Data-aware default: sequential neutral → accent.
    stops = [neutral, palette.primary];
    domain = [min, max];
  }

  // Guard against a degenerate (single-value) domain.
  if (domain[0] === domain[domain.length - 1]) {
    const last = stops[stops.length - 1]!;
    return { scale: () => last, min, max, stops, signed };
  }

  const linear = scaleLinear<string, string>()
    .domain(domain)
    .range(stops)
    .clamp(true);
  // d3 interpolates to `rgb(...)` strings; normalize to hex so downstream
  // helpers (mix/contrastText) that expect hex work on heat fills too.
  return { scale: (v: number) => toHex(linear(v)), min, max, stops, signed };
}

/** Normalize a CSS color (`rgb(...)` or hex) to a `#rrggbb` hex string. */
function toHex(c: string): string {
  if (c.startsWith('#')) return c;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return c;
  const parts = m[1]!.split(',').map((s) => Math.round(parseFloat(s)));
  const h = (n: number): string =>
    Math.max(0, Math.min(255, n || 0))
      .toString(16)
      .padStart(2, '0');
  return `#${h(parts[0] ?? 0)}${h(parts[1] ?? 0)}${h(parts[2] ?? 0)}`;
}

// ============================================================
// Value / percent formatting
// ============================================================

/** Auto-compact like the map (1.2M, 940k); plain for small numbers. */
export function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return strip(v / 1e9) + 'B';
  if (abs >= 1e6) return strip(v / 1e6) + 'M';
  if (abs >= 1e3) return strip(v / 1e3) + 'k';
  return strip(Math.round(v * 100) / 100);
}

export function strip(n: number): string {
  return parseFloat(
    n.toFixed(n < 10 && !Number.isInteger(n) ? 1 : 0)
  ).toString();
}

export function formatPct(frac: number): string {
  const pct = frac * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

// ============================================================
// Legend assembly — one group per applicable color mode.
// ============================================================

export interface TreemapLegend {
  groups: LegendGroupData[];
  activeGroup: string | null;
  /** Legend group name → the color mode it selects (for the click callback). */
  modeByName: Map<string, TreemapColorMode>;
}

/**
 * Build one legend group per APPLICABLE color mode (tag if tags exist, heat if
 * heat data exists, branch always). The active mode's group renders as the open
 * capsule; the others render as clickable pills that switch mode — i.e. the
 * mode switcher IS the legend (the active-group pattern used elsewhere).
 */
export function buildLegend(
  activeMode: TreemapColorMode,
  parsed: ParsedTreemap,
  heat: HeatScale | null,
  seriesColors: string[],
  colorOffset: number
): TreemapLegend {
  const groups: LegendGroupData[] = [];
  const modeByName = new Map<string, TreemapColorMode>();
  let activeGroup: string | null = null;

  // ── Tag ──────────────────────────────────────────────────
  if (parsed.tagGroups.length > 0) {
    const tg = activeTagGroupOf(parsed)!;
    const used = new Set<string>();
    const collect = (nodes: readonly TreemapNode[]): void => {
      for (const n of nodes) {
        const v = n.metadata[tagAttrKey(tg.name)];
        if (v) used.add(v.toLowerCase());
        collect(n.children);
      }
    };
    collect(parsed.roots);
    groups.push({
      name: tg.name,
      entries: tg.entries
        .filter((e) => used.has(e.value.toLowerCase()))
        .map((e) => ({ value: e.value, color: e.color })),
    });
    modeByName.set(tg.name, 'tag');
    if (activeMode === 'tag') activeGroup = tg.name;
  }

  // ── Heat ─────────────────────────────────────────────────
  if (heat) {
    const name = parsed.options.heatLabel ?? 'Value';
    groups.push({
      name,
      entries: [],
      gradient: {
        min: heat.min,
        max: heat.max,
        low: heat.stops[0]!,
        high: heat.stops[heat.stops.length - 1]!,
      },
    });
    modeByName.set(name, 'heat');
    if (activeMode === 'heat') activeGroup = name;
  }

  // ── Branch (always) ──────────────────────────────────────
  groups.push({
    name: 'Branch',
    entries: parsed.roots.map((r, i) => ({
      value: r.label,
      color: seriesColors[(i + colorOffset) % seriesColors.length]!,
    })),
  });
  modeByName.set('Branch', 'branch');
  if (activeMode === 'branch' || activeGroup === null) activeGroup = 'Branch';

  return { groups, activeGroup, modeByName };
}
