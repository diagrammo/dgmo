// ============================================================
// Goal chart — D3 SVG Renderer
// ============================================================
//
// Three faces off the same `actual`/`target` pair:
//   - bar         : horizontal rounded fill (default)
//   - thermometer : vertical rounded tube + bulb
//   - gauge       : semicircular dial, the fill arc is the reading (#2096)
// Over-target clamps the fill at the scale's end; the % label stays truthful.
//
// Bands (#1973): the fill takes the colour of the band the actual sits in.
// On the bar face the zones tint the track itself and the fill covers what
// has been reached, so the bands still ahead show past the level with their
// names inside (#2094). The tube and the arc keep a 5px ribbon beside them. Several `[Measure]` rows (#1851) draw as a
// bullet chart on the bar face, and as a grid of cells on the other two.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { TITLE_FONT_WEIGHT } from '../utils/title-constants';
import { growChartFrame } from '../utils/chart-frame';
import {
  mix,
  shapeFill,
  getSeriesColors,
  themeBaseBg,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { compactNumber } from '../treemap/treemap-shared';
import { parseInlineMarkdown } from '../utils/inline-markdown';
import {
  measureText,
  truncateText,
  MIN_READABLE_TYPE_PX,
} from '../utils/text-measure';
import { fitLabel, type FittedLabel } from '../utils/fit-label';
import { FULL_TEXT_ATTR } from '../utils/full-text';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { GoalMeasure, ParsedGoal } from './types';

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Goal titles run larger than the shared chart-title size. */
const GOAL_TITLE_SIZE = 30;
/** Band ribbon thickness and its gap from the track (#1973 rule 7). */
const RIBBON_W = 5;
const RIBBON_GAP = 6;
/** Least clear space between two value labels on a face, in px. */
const VALUE_LABEL_GAP = 8;
/** Bar face: how much band colour tints the track ground (#2094). */
const BAND_GROUND_PCT = 18;
/**
 * A goal title wider than its room wraps to at most this many lines, then the
 * last line is cut with `…` (#2443). Each line past the first moves the face
 * down by GOAL_TITLE_LINE_H × the title size.
 */
const GOAL_TITLE_MAX_LINES = 3;
const GOAL_TITLE_LINE_H = 1.2;
/** Least clear space between the title and the readout on one row (#2443). */
const TITLE_READOUT_GAP = 24;
const BOLD = { bold: true } as const;
/** Measures per row on the thermometer and gauge faces (#1851 rule 7). */
const CELLS_PER_ROW = 4;

/**
 * Where a face draws. A single goal draws straight onto the root `<svg>`; a
 * cell of a multi-measure chart draws into its own `<g>`. Faces only call
 * `append`, which both share, so the root is passed through this type too and
 * single-goal output stays byte-identical to before the cells existed.
 */
type Svg = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

/** One band, resolved to a drawable span and colour. */
interface Zone {
  start: number;
  end: number;
  color: string;
  label: string | null;
}

/** Displayed magnitudes derived from the measure. */
interface GoalMetrics {
  /** actual / target — the truthful percent. */
  pctFrac: number;
  /** actual / scale end, clamped — how far the fill reaches. */
  fillFrac: number;
  /** target / scale end — 1 unless a band or the actual runs past target. */
  targetFrac: number;
  pctLabel: string;
}

/** Content bounds returned by each face so renderGoal can fit the viewBox. */
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Resolved paint colors for one measure. */
interface GoalPaint {
  base: string;
  fill: string;
  track: string;
  text: string;
  muted: string;
  /** Band colour darkened toward the text so a yellow label still reads. */
  ink: (bandColor: string) => string;
  /** The theme's ground, for the hairlines between band zones on the track. */
  bg: string;
}

/** Everything a face needs to draw one measure. */
interface GoalView {
  m: GoalMeasure;
  /** The drawn scale's end: the measure's own, or the shared one. */
  scaleEnd: number;
  metrics: GoalMetrics;
  paint: GoalPaint;
  zones: Zone[];
  /** The band the actual sits in; null below the first edge or with no target. */
  status: Zone | null;
  ribbon: boolean;
  ribbonLabels: boolean;
  clipId: string;
}

/**
 * Default band colours by position, worst first (#1973 rule 8): a traffic
 * light for up to four bands; from five, the first n-1 interpolate along
 * red → orange → yellow → green and the last is blue.
 */
export function bandRamp(n: number, palette: PaletteColors): string[] {
  const c = (name: string): string => resolveColor(name, palette) ?? name;
  if (n <= 0) return [];
  if (n === 1) return [c('green')];
  if (n === 2) return [c('red'), c('green')];
  if (n === 3) return [c('red'), c('yellow'), c('green')];
  const stops = [c('red'), c('orange'), c('yellow'), c('green')];
  if (n === 4) return stops;
  const out: string[] = [];
  const k = n - 1;
  for (let i = 0; i < k; i++) {
    const p = (i / (k - 1)) * (stops.length - 1);
    const lo = Math.floor(p);
    const hi = Math.min(stops.length - 1, lo + 1);
    const t = p - lo;
    out.push(
      t === 0 ? stops[lo]! : mix(stops[hi]!, stops[lo]!, Math.round(t * 100))
    );
  }
  out.push(c('blue'));
  return out;
}

/**
 * Index of the band the value sits in: the last band whose start is at or
 * below it. -1 below the first edge.
 */
export function statusIndex(
  bands: readonly { start: number }[],
  value: number
): number {
  let idx = -1;
  for (let i = 0; i < bands.length; i++) {
    if (bands[i]!.start <= value) idx = i;
  }
  return idx;
}

function buildView(
  parsed: ParsedGoal,
  m: GoalMeasure,
  index: number,
  palette: PaletteColors,
  isDark: boolean,
  sharedEnd: number | null
): GoalView {
  const scaleEnd = Math.max(sharedEnd ?? 0, m.scaleEnd);
  const ramp = bandRamp(m.bands.length, palette);
  const colorAt = (i: number): string => m.bands[i]!.color ?? ramp[i]!;

  const zones: Zone[] = [];
  m.bands.forEach((b, i) => {
    const end = i + 1 < m.bands.length ? m.bands[i + 1]!.start : m.scaleEnd;
    const start = Math.max(0, b.start);
    if (end > start && start < m.scaleEnd) {
      zones.push({ start, end, color: colorAt(i), label: b.label });
    }
  });

  let status: Zone | null = null;
  if (m.hasTarget) {
    let idx = statusIndex(m.bands, m.actual);
    // The hidden default reaches down to 0: a negative actual is still red.
    if (idx < 0 && !m.explicitBands && m.bands.length > 0) idx = 0;
    if (idx >= 0) {
      const b = m.bands[idx]!;
      status = {
        start: b.start,
        end: m.bands[idx + 1]?.start ?? m.scaleEnd,
        color: colorAt(idx),
        label: b.label,
      };
    }
  }

  const pctFrac = m.hasTarget ? m.actual / m.target : 0;
  const metrics: GoalMetrics = {
    pctFrac,
    fillFrac: scaleEnd > 0 ? clamp(m.actual / scaleEnd, 0, 1) : 0,
    targetFrac: m.hasTarget && scaleEnd > 0 ? m.target / scaleEnd : 1,
    pctLabel: `${Math.round(pctFrac * 100)}%`,
  };

  // Precedence: header / title colour → status colour (needs a target; the
  // neutral below the first edge) → palette colour (`no-auto-color`).
  const neutral = resolveColor('gray', palette) ?? palette.border;
  const autoColor =
    !parsed.options.noAutoColor && m.hasTarget
      ? (status?.color ?? neutral)
      : null;
  const base =
    (m.color && resolveColor(m.color, palette)) ??
    m.color ??
    autoColor ??
    getSeriesColors(palette)[0]!;
  const paint: GoalPaint = {
    base,
    // §1.9 fill family: tint (default) / solid / outline. In outline mode the
    // progress region renders hollow (theme base bg) and the status /
    // override color moves to the border — advancement still reads from the
    // outlined region's extent against the gray track.
    fill: shapeFill(palette, base, isDark, { mode: parsed.options.fillMode }),
    track: mix(palette.border, themeBaseBg(palette, isDark), 45),
    text: palette.text,
    muted: mix(palette.text, themeBaseBg(palette, isDark), 55),
    ink: (c) => mix(c, palette.text, 80),
    bg: themeBaseBg(palette, isDark),
  };

  const ribbon =
    m.explicitBands && !parsed.options.noRibbon && zones.length > 0;
  return {
    m,
    scaleEnd,
    metrics,
    paint,
    zones,
    status,
    ribbon,
    ribbonLabels:
      ribbon && !parsed.options.noRibbonLabels && zones.some((z) => !!z.label),
    clipId:
      index === 0 ? 'dgmo-goal-track-clip' : `dgmo-goal-track-clip-${index}`,
  };
}

function ariaFor(parsed: ParsedGoal): string {
  const one = (m: GoalMeasure): string =>
    `${m.actual} of ${m.hasTarget ? m.target : '?'} (${Math.round(
      (m.hasTarget ? m.actual / m.target : 0) * 100
    )}%)`;
  if (!parsed.multi)
    return `${parsed.title ?? 'Goal'}: ${one(parsed.measures[0]!)}`;
  const rows = parsed.measures.map((m) => `${m.name}: ${one(m)}`).join('; ');
  return `${parsed.title ?? 'Goal'} — ${rows}`;
}

export function renderGoal(
  container: HTMLDivElement,
  parsed: ParsedGoal,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const cw = exportDims?.width ?? container.clientWidth;
  const ch = exportDims?.height ?? container.clientHeight;
  if (cw <= 0 || ch <= 0) return;
  if (parsed.measures.length === 0) return;

  const sharedEnd =
    parsed.multi && parsed.options.sharedScale
      ? Math.max(...parsed.measures.map((m) => m.scaleEnd))
      : null;
  const views = parsed.measures.map((m, i) =>
    buildView(parsed, m, i, palette, isDark, sharedEnd)
  );

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', cw)
    .attr('height', ch)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('role', 'img')
    .attr('aria-label', ariaFor(parsed))
    .style('font-family', FONT_FAMILY);
  const host = svg as unknown as Svg;

  // Each face lays out in its own natural coordinate space (top-left anchored)
  // and returns its content bounds. The viewBox is fitted to those bounds with
  // preserveAspectRatio="meet", so the whole diagram scales up/down and stays
  // centered at any canvas size instead of being clipped.
  const box = parsed.multi
    ? parsed.mode === 'bar'
      ? renderBarRows(host, parsed, views)
      : renderCells(host, parsed, views, cw)
    : parsed.mode === 'thermometer'
      ? renderThermometer(host, parsed, views[0]!, false)
      : parsed.mode === 'gauge'
        ? renderGauge(host, parsed, views[0]!, false)
        : renderBar(host, parsed, views[0]!);

  const pad = 30;
  const vx = box.minX - pad;
  const vy = box.minY - pad;
  const vw = box.maxX - box.minX + pad * 2;
  const vh = box.maxY - box.minY + pad * 2;
  svg.attr('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  // Match the viewport to the fitted content, so `meet` has nothing to letterbox.
  // The canvas was left at the caller's height (1200x800 on the export path)
  // while the content is a ~5:1 strip, so a goal PNG came out ~70% empty and
  // the background rect covered only the middle band.
  if (vw > 0 && vh > 0) svg.attr('height', Math.round((cw * vh) / vw));
  svg
    .insert('rect', ':first-child')
    .attr('x', vx)
    .attr('y', vy)
    .attr('width', vw)
    .attr('height', vh)
    .attr('fill', palette.bg);

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: 'grow',
    keepTitle: true,
  });
}

export function renderGoalForExport(
  container: HTMLDivElement,
  parsed: ParsedGoal,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderGoal(container, parsed, palette, isDark, exportDims);
}

// ── Shared label helpers ─────────────────────────────────────
/** Display length of a token, ignoring inline-markdown markers. */
function displayLen(token: string): number {
  return (
    token
      // parseInlineMarkdown's link shape; lazy `.+?` was cubic (#1557).
      .replace(/\[([^[\]\n\r]+)\]\((?:[^()\n\r]|\([^()\n\r]*\))+\)/g, '$1')
      .replace(/\*\*|__|\*|_|`/g, '').length
  );
}

/** Greedy word-wrap into lines of at most `maxChars` display characters. */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (displayLen(next) > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

interface DescLine {
  text: string;
  /** Left x for the (wrapped) content of this line. */
  x: number;
  /** When set, draw a bullet glyph at this x; content still starts at `x`. */
  bulletX?: number;
}

/**
 * Lay a multi-line markdown description out into wrapped visual lines. Supports
 * `- `/`* ` bullets (bullet glyph + hanging indent) and blank-line gaps.
 */
function layoutDescription(
  description: string,
  colLeft: number,
  maxChars: number
): DescLine[] {
  const out: DescLine[] = [];
  const indent = 18; // content x-offset for bullet lines (bullet sits at colLeft)
  const contentX = colLeft + indent;
  for (const raw of description.split('\n')) {
    const t = raw.trim();
    if (t === '') {
      out.push({ text: '', x: colLeft }); // blank spacer line
      continue;
    }
    const bullet = /^[-*]\s+/.test(t);
    if (bullet) {
      const content = t.replace(/^[-*]\s+/, '');
      const wrapped = wrapText(content, Math.max(6, maxChars - 3));
      // First line: bullet glyph at colLeft, content at contentX. Wrapped
      // continuation lines hang under the content (contentX), not the bullet.
      wrapped.forEach((wl, k) => {
        out.push(
          k === 0
            ? { text: wl, x: contentX, bulletX: colLeft }
            : { text: wl, x: contentX }
        );
      });
    } else {
      for (const wl of wrapText(t, maxChars))
        out.push({ text: wl, x: colLeft });
    }
  }
  return out;
}

/**
 * Render pre-laid description lines with simple inline markdown (**bold** /
 * *italic* / `code`). Each line's first span carries x + dy so it breaks;
 * remaining spans flow inline.
 */
function renderWrappedMarkdown(
  textEl: d3Selection.Selection<SVGTextElement, unknown, null, undefined>,
  lines: DescLine[],
  lineH: number
): void {
  lines.forEach((line, li) => {
    const dy = li === 0 ? 0 : lineH;
    if (line.text === '' && line.bulletX === undefined) {
      textEl.append('tspan').attr('x', line.x).attr('dy', dy).text(' ');
      return;
    }
    // Bullet glyph carries the line break (dy); content starts at line.x.
    if (line.bulletX !== undefined) {
      textEl.append('tspan').attr('x', line.bulletX).attr('dy', dy).text('•');
    }
    let first = true;
    for (const span of parseInlineMarkdown(line.text)) {
      const tspan = textEl.append('tspan').text(span.text);
      if (first) {
        tspan.attr('x', line.x);
        if (line.bulletX === undefined) tspan.attr('dy', dy);
        first = false;
      }
      if (span.bold) tspan.attr('font-weight', 'bold');
      if (span.italic) tspan.attr('font-style', 'italic');
      if (span.code) tspan.attr('font-family', 'monospace');
    }
  });
}

/**
 * Draw a `note` description block: the wrapped markdown body, left-aligned.
 * Shared by every goal face so the caption reads the same everywhere; each face
 * picks a sensible box. Returns the y just past the last line.
 */
function drawNote(
  svg: Svg,
  description: string,
  paint: GoalPaint,
  left: number,
  top: number,
  width: number
): number {
  const descSize = 15;
  const lineH = descSize * 1.4;
  // Avg Inter advance ≈ 0.46em — fills the box up to the target width.
  const maxChars = Math.max(8, Math.floor(width / (descSize * 0.46)));
  const firstY = top + descSize;
  const lines = layoutDescription(description, left, maxChars);
  const desc = svg
    .append('text')
    .attr('x', left)
    .attr('y', firstY)
    .attr('text-anchor', 'start')
    .attr('fill', paint.muted)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', descSize)
    .attr('font-weight', 'normal');
  renderWrappedMarkdown(desc, lines, lineH);
  return firstY + lines.length * lineH;
}

/**
 * The title fitted to `maxW` (#2443): wrapped, then cut with `…` on the last
 * line. A title that fits comes back as one line, as typed. Null when hidden.
 */
function fitTitle(
  parsed: ParsedGoal,
  maxW: number,
  size = GOAL_TITLE_SIZE
): FittedLabel | null {
  if (!parsed.title || parsed.options.noTitle) return null;
  return fitLabel(
    parsed.title,
    size,
    Math.max(1, maxW),
    GOAL_TITLE_MAX_LINES,
    BOLD
  );
}

/** Height the fitted title takes past its first line (0 for one line). */
function titleExtra(fit: FittedLabel | null, size = GOAL_TITLE_SIZE): number {
  return fit ? (fit.lines.length - 1) * size * GOAL_TITLE_LINE_H : 0;
}

/**
 * Title placed immediately above a face's element (not the top-center slot).
 * `y` is the first line's baseline; further lines of `fit` run below it.
 */
function faceTitle(
  svg: Svg,
  parsed: ParsedGoal,
  paint: GoalPaint,
  x: number,
  y: number,
  anchor = 'middle',
  size = GOAL_TITLE_SIZE,
  fit: FittedLabel | null = null
): void {
  if (!parsed.title || parsed.options.noTitle) return;
  const t = svg
    .append('text')
    .attr('class', 'chart-title')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('fill', paint.text)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', size)
    .attr('font-weight', TITLE_FONT_WEIGHT)
    .attr('data-line-number', parsed.titleLineNumber);
  if (!fit || fit.lines.length === 1) t.text(fit?.lines[0] ?? parsed.title);
  else
    fit.lines.forEach((line, i) =>
      t
        .append('tspan')
        .attr('x', x)
        .attr('dy', i === 0 ? 0 : size * GOAL_TITLE_LINE_H)
        .text(line)
    );
  if (fit?.truncated) t.attr(FULL_TEXT_ATTR, parsed.title);
}

/** The band name after the percent (`64% · OK`) — null when there is none. */
function statusSuffix(v: GoalView): string | null {
  return v.status?.label ? ` · ${v.status.label}` : null;
}

/** The readout as drawn: the band name cut with `…` to fit (#2443). */
interface FittedReadout {
  /** The band name to draw, or null when there is none. */
  label: string | null;
  width: number;
  /** True when the band name was cut. */
  cut: boolean;
}

/** The readout at `size`, its band name cut so the whole stays within `maxW`. */
function fitReadout(v: GoalView, size: number, maxW = Infinity): FittedReadout {
  const pct = v.metrics.pctLabel;
  const full = v.status?.label ?? null;
  const whole = measureText(`${pct}${statusSuffix(v) ?? ''}`, size, BOLD);
  if (!full || whole <= maxW) return { label: full, width: whole, cut: false };
  const room = maxW - measureText(`${pct} · `, size, BOLD);
  const label = truncateText(full, size, Math.max(0, room), BOLD);
  return {
    label,
    width: measureText(`${pct} · ${label}`, size, BOLD),
    cut: label !== full,
  };
}

/** Text width of the readout, for column sizing. */
function readoutWidth(v: GoalView, size: number, maxW = Infinity): number {
  return fitReadout(v, size, maxW).width;
}

/**
 * The readout: the percent in `pctFill`, then ` · OK` in the band's colour
 * (#1973 rule 9). `no-percent` hides both — callers check it.
 */
function drawReadout(
  host: Svg,
  v: GoalView,
  x: number,
  y: number,
  anchor: string,
  size: number,
  pctFill: string,
  maxW = Infinity
): void {
  const t = host
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('fill', pctFill)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', size)
    .attr('font-weight', 'bold');
  const fit = fitReadout(v, size, maxW);
  if (!fit.label) {
    t.text(v.metrics.pctLabel);
    return;
  }
  t.append('tspan').text(v.metrics.pctLabel);
  t.append('tspan')
    .attr('fill', v.paint.ink(v.status!.color))
    .text(` · ${fit.label}`);
  if (fit.cut)
    t.attr(FULL_TEXT_ATTR, `${v.metrics.pctLabel}${statusSuffix(v)}`);
}

/** The largest size up to `size` at which `text` (bold) fits `maxW`. */
function fitSize(text: string, size: number, maxW: number): number {
  const w = measureText(text, size, { bold: true });
  return w > maxW && w > 0 ? Math.max(12, (size * maxW) / w) : size;
}

/** Widest zone label at `size`, 0 when labels are off. */
function zoneLabelWidth(v: GoalView, size: number): number {
  if (!v.ribbonLabels) return 0;
  return Math.max(
    0,
    ...v.zones.map((z) =>
      z.label ? measureText(z.label, size, { bold: true }) : 0
    )
  );
}

/**
 * One bar track: the rounded track, the band ground, the clipped fill, the
 * level edge, the target tick when the scale runs past target, the value
 * inside the fill, and the names of the bands still ahead.
 */
function drawBarTrack(
  g: Svg,
  parsed: ParsedGoal,
  v: GoalView,
  x: number,
  y: number,
  trackW: number,
  trackH: number,
  valueSize: number,
  labelSize: number
): void {
  const { metrics, paint } = v;
  const r = trackH / 2;
  g.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', trackW)
    .attr('height', trackH)
    .attr('rx', r)
    .attr('fill', paint.track);

  // The fill is CLIPPED to the track rather than carrying a radius of its own.
  //
  // 🔴 It used to be a second rounded rect asking for the track's `rx` at
  // whatever width it happened to be, and SVG will not draw that: `rx` is
  // clamped to half the width while `ry`, unspecified and inheriting `rx`,
  // clamps to half the HEIGHT. A 7px-wide fill asking for `rx 26` came out as a
  // 7 × 52 lens — a bubble floating at the left of the track instead of 1% of a
  // distance — and anything under `2r` (8.4% of target here) did the same. Above
  // that it was a both-ends-rounded pill sitting inside the track, which reads
  // as a capsule rather than a level.
  //
  // Clipping removes the whole class rather than the reported value: the shape
  // stops being a function of its own width, so there is no threshold left to
  // fall below at any track size or radius. The left end takes the track's
  // rounding, the right end is flat, and at 100% the clip restores the right
  // rounding for nothing. Same construction as the collapse bar in
  // `boxes-and-lines`.
  g.append('clipPath')
    .attr('id', v.clipId)
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', trackW)
    .attr('height', trackH)
    .attr('rx', r);

  // Band ground (#2094): the zones tint the track itself, under the fill, so
  // the bands are part of the bar rather than a strip beside it. Hairlines in
  // the theme ground mark each threshold. The fill then covers what has been
  // reached, and the bands still ahead stay visible past the level.
  const at = (val: number): number => x + trackW * (val / v.scaleEnd);
  const ribbon = v.ribbon ? g.append('g').attr('class', 'goal-ribbon') : null;
  if (ribbon) {
    const ground = ribbon.append('g').attr('clip-path', `url(#${v.clipId})`);
    for (const z of v.zones) {
      ground
        .append('rect')
        .attr('x', at(z.start))
        .attr('y', y)
        .attr('width', Math.max(0, at(z.end) - at(z.start)))
        .attr('height', trackH)
        .attr('fill', mix(z.color, paint.track, BAND_GROUND_PCT));
    }
    for (const z of v.zones) {
      if (z.start <= 0) continue;
      ground
        .append('line')
        .attr('x1', at(z.start))
        .attr('x2', at(z.start))
        .attr('y1', y)
        .attr('y2', y + trackH)
        .attr('stroke', paint.bg)
        .attr('stroke-width', 1.5);
    }
  }

  const fillW = trackW * metrics.fillFrac;
  if (fillW > 0.5) {
    const clipped = g
      .append('g')
      .attr('class', 'goal-fill')
      .attr('clip-path', `url(#${v.clipId})`);
    // No stroke on the fill itself: a clipped stroke loses the left arc and
    // halves along the track edge, which is worse than none. What the outline
    // was carrying is the LEVEL, so the level is what gets drawn.
    clipped
      .append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', fillW)
      .attr('height', trackH)
      .attr('fill', paint.fill);

    // The level edge — the one line that says how far the fill has come. Inset
    // by half its width so it sits wholly inside the fill, and skipped at 100%,
    // where the level IS the track's own end and a line there would ride the
    // rounding.
    const levelW = parsed.options.fillMode === 'outline' ? 1.5 : 2;
    if (fillW < trackW - 0.5) {
      clipped
        .append('rect')
        .attr('x', x + fillW - levelW)
        .attr('y', y)
        .attr('width', levelW)
        .attr('height', trackH)
        .attr('fill', paint.base);
    }
  }

  // Past target (#1973 rule 5): the target is a dark tick inside the scale.
  if (v.m.hasTarget && metrics.targetFrac < 0.999) {
    g.append('rect')
      .attr('class', 'goal-target-tick')
      .attr('x', x + trackW * metrics.targetFrac - 1.5)
      .attr('y', y - 4)
      .attr('width', 3)
      .attr('height', trackH + 8)
      .attr('fill', paint.text);
  }

  // Current value rides INSIDE the fill, tracking its right end — for as long
  // as the fill is wide enough to hold the glyphs. Below that it moves to the
  // OUTSIDE of the level and changes colour with the surface it lands on:
  // `paint.base` is the fill's own accent, picked to be read against the fill,
  // and the same glyphs sitting on the bare grey track is the one place it was
  // never chosen for. The switch is measured rather than a fixed floor, so a
  // five-digit value asks for more room than a single digit (#280).
  // Past the level, nothing may be drawn left of `clearX`.
  let clearX = x + fillW;
  if (!parsed.options.noValue) {
    const valueText = compactNumber(v.m.actual);
    const valuePad = Math.round(valueSize * 0.66);
    const valueW = measureText(valueText, valueSize, { bold: true });
    const insideFits = fillW >= valueW + valuePad * 2;
    const valX = insideFits ? x + fillW - valuePad : x + fillW + valuePad;
    if (!insideFits) clearX = valX + valueW;
    g.append('text')
      .attr('x', valX)
      .attr('y', y + trackH / 2 + valueSize * 0.35)
      .attr('text-anchor', insideFits ? 'end' : 'start')
      .attr('fill', insideFits ? paint.base : paint.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', valueSize)
      .attr('font-weight', 'bold')
      .text(valueText);
  }

  // Names of the bands wholly ahead of the actual, right-aligned inside
  // their zone. A band the fill has reached shows no name — the readout
  // carries the current one — and a name that would not fit is left out.
  if (ribbon && v.ribbonLabels) {
    const pad = Math.round(labelSize * 0.7);
    for (const z of v.zones) {
      if (!z.label || z.start < v.m.actual) continue;
      const right = at(z.end) - pad;
      const left = Math.max(at(z.start), clearX) + pad;
      if (right - left < measureText(z.label, labelSize, { bold: true })) {
        continue;
      }
      ribbon
        .append('text')
        .attr('x', right)
        .attr('y', y + trackH / 2 + labelSize * 0.35)
        .attr('text-anchor', 'end')
        .attr('fill', paint.ink(z.color))
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', labelSize)
        .attr('font-weight', 600)
        .text(z.label);
    }
  }
}

// ── Bar face ─────────────────────────────────────────────────
function renderBar(svg: Svg, parsed: ParsedGoal, v: GoalView): Box {
  const { m, paint } = v;
  const trackH = 52;
  const trackW = 620;
  const gap = m.hasTarget ? 18 : 0;
  const targetLabelW = m.hasTarget ? 80 : 0;
  const x = 0;
  const hasTitle = !!parsed.title && !parsed.options.noTitle;
  const showPct = !parsed.options.noPercent && m.hasTarget;
  const titleSize = GOAL_TITLE_SIZE;

  // Top row above the bar: title on the left, readout on the right (#2443).
  // The readout is measured first and its band name cut to half the row; the
  // title wraps in what is left. When both are long, the readout takes its
  // own line under the title instead.
  let readMax = hasTitle ? trackW / 2 : trackW;
  const read = showPct ? fitReadout(v, titleSize, readMax) : null;
  let fit = fitTitle(
    parsed,
    read ? trackW - read.width - TITLE_READOUT_GAP : trackW,
    titleSize
  );
  const ownLine = !!fit && !!read && read.cut && fit.lines.length > 1;
  if (ownLine) {
    readMax = trackW;
    fit = fitTitle(parsed, trackW, titleSize);
  }
  const extra = titleExtra(fit, titleSize);
  const readDrop = ownLine ? extra + titleSize * GOAL_TITLE_LINE_H : 0;
  if (hasTitle)
    faceTitle(svg, parsed, paint, x, titleSize - 2, 'start', titleSize, fit);
  const barRight = x + trackW;
  if (showPct) {
    drawReadout(
      svg,
      v,
      barRight,
      titleSize - 2 + readDrop,
      'end',
      titleSize,
      paint.muted,
      readMax
    );
  }
  const y =
    hasTitle || showPct ? titleSize + 14 + Math.max(extra, readDrop) : 0;
  const barCy = y + trackH / 2;

  const g = svg.append('g').attr('class', 'goal-bar');
  drawBarTrack(g, parsed, v, x, y, trackW, trackH, 24, 15);

  // Goal (target) to the RIGHT of the bar.
  if (m.hasTarget) {
    g.append('text')
      .attr('x', barRight + gap)
      .attr('y', barCy + 26 * 0.35)
      .attr('text-anchor', 'start')
      .attr('fill', paint.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 26)
      .attr('font-weight', 'bold')
      .text(compactNumber(m.target));
  }

  let bottom = y + trackH;

  // Optional `note` description below the bar, spanning the bar width.
  if (parsed.description && !parsed.options.noNote) {
    bottom = drawNote(svg, parsed.description, paint, x, bottom + 40, trackW);
  }

  return {
    minX: 0,
    minY: 0,
    maxX: barRight + gap + targetLabelW,
    maxY: bottom,
  };
}

// ── Bar face, several measures: the bullet chart (#1851) ─────
function renderBarRows(svg: Svg, parsed: ParsedGoal, views: GoalView[]): Box {
  const nameSize = 20;
  const valSize = 18;
  const trackH = 32;
  const trackW = 520;
  const labelSize = 13;
  const rowGap = 26;
  const first = views[0]!;

  const nameW = Math.max(
    ...views.map((v) => measureText(v.m.name ?? '', nameSize, { bold: true }))
  );
  const targetText = (v: GoalView): string =>
    v.m.hasTarget ? `/ ${compactNumber(v.m.target)}` : '';
  const targetColW = Math.max(
    0,
    ...views.map((v) => measureText(targetText(v), valSize, { bold: true }))
  );
  const showPct = !parsed.options.noPercent;
  // A row's band name is cut so its readout stays within half a track (#2443).
  const readMax = trackW / 2;
  const readW = showPct
    ? Math.max(
        0,
        ...views.map((v) =>
          v.m.hasTarget ? readoutWidth(v, valSize, readMax) : 0
        )
      )
    : 0;
  const barX = nameW + 20;
  const targetX = barX + trackW + 16;
  const readX = targetX + targetColW + 22;
  const maxX = showPct ? readX + readW : targetX + targetColW;

  let y = 0;
  if (parsed.title && !parsed.options.noTitle) {
    const fit = fitTitle(parsed, maxX);
    faceTitle(
      svg,
      parsed,
      first.paint,
      0,
      GOAL_TITLE_SIZE - 2,
      'start',
      GOAL_TITLE_SIZE,
      fit
    );
    y = GOAL_TITLE_SIZE + 26 + titleExtra(fit);
  }

  views.forEach((v) => {
    const g = svg
      .append('g')
      .attr('class', 'goal-row')
      .attr('data-line-number', v.m.lineNumber);
    const barCy = y + trackH / 2;
    g.append('text')
      .attr('x', nameW)
      .attr('y', barCy + nameSize * 0.35)
      .attr('text-anchor', 'end')
      .attr('fill', v.paint.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', nameSize)
      .attr('font-weight', 600)
      .text(v.m.name ?? '');
    drawBarTrack(g, parsed, v, barX, y, trackW, trackH, 16, labelSize);
    if (v.m.hasTarget) {
      g.append('text')
        .attr('x', targetX)
        .attr('y', barCy + valSize * 0.35)
        .attr('text-anchor', 'start')
        .attr('fill', v.paint.muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', valSize)
        .attr('font-weight', 'bold')
        .text(targetText(v));
      if (showPct) {
        drawReadout(
          g,
          v,
          readX,
          barCy + valSize * 0.35,
          'start',
          valSize,
          v.paint.text,
          readMax
        );
      }
    }
    y += trackH + rowGap;
  });
  y -= rowGap;

  if (parsed.description && !parsed.options.noNote) {
    y = drawNote(svg, parsed.description, first.paint, 0, y + 36, maxX);
  }
  return { minX: 0, minY: 0, maxX, maxY: y };
}

// ── Thermometer and gauge faces, several measures (#1851 rule 7) ──
function renderCells(
  svg: Svg,
  parsed: ParsedGoal,
  views: GoalView[],
  canvasW: number
): Box {
  // A cell is drawn small. Learn the scale the grid will be shown at from a
  // dry run, then size the gauge labels so they stay at or above the minimum
  // type size there (#2096). A second dry run settles the wider layout.
  let floor = 0;
  if (parsed.mode === 'gauge') {
    for (let pass = 0; pass < 2; pass++) {
      const b = layoutCells(
        d3Selection.create('svg') as unknown as Svg,
        parsed,
        views,
        floor
      );
      const scale = canvasW / (b.maxX - b.minX + 60);
      floor = (MIN_READABLE_TYPE_PX * 1.1) / Math.min(1, scale);
    }
  }
  // The title wraps to the grid's width, learnt from a dry run (#2443).
  const titleW =
    parsed.title && !parsed.options.noTitle
      ? layoutCells(
          d3Selection.create('svg') as unknown as Svg,
          parsed,
          views,
          floor
        ).maxX
      : Infinity;
  return layoutCells(svg, parsed, views, floor, Math.max(400, titleW));
}

function layoutCells(
  svg: Svg,
  parsed: ParsedGoal,
  views: GoalView[],
  textFloor: number,
  titleW = Infinity
): Box {
  const nameSize = 24;
  const readSize = 22;
  const cellGap = 64;
  const rowGap = 48;
  const first = views[0]!;
  const firstRibbon = views.findIndex((v) => v.ribbon);

  let y = 0;
  if (parsed.title && !parsed.options.noTitle) {
    const fit = fitTitle(parsed, titleW);
    faceTitle(
      svg,
      parsed,
      first.paint,
      0,
      GOAL_TITLE_SIZE - 2,
      'start',
      GOAL_TITLE_SIZE,
      fit
    );
    y = GOAL_TITLE_SIZE + 36 + titleExtra(fit);
  }

  let maxX = 0;
  for (let start = 0; start < views.length; start += CELLS_PER_ROW) {
    const row = views.slice(start, start + CELLS_PER_ROW);
    // Draw each cell at its own origin, then place it from its bounds.
    const placed = row.map((v, k) => {
      const i = start + k;
      const g = svg
        .append('g')
        .attr('class', 'goal-cell')
        .attr('data-line-number', v.m.lineNumber);
      const showLabels = i === firstRibbon || v.m.ownBands;
      const cellView: GoalView = {
        ...v,
        ribbonLabels: v.ribbonLabels && showLabels,
      };
      const box =
        parsed.mode === 'thermometer'
          ? renderThermometer(g, parsed, cellView, true)
          : renderGauge(g, parsed, cellView, true, textFloor);
      return { v, g, box };
    });
    const rowH = Math.max(...placed.map((p) => p.box.maxY - p.box.minY));
    let x = 0;
    for (const { v, g, box } of placed) {
      const w = box.maxX - box.minX;
      g.attr('transform', `translate(${x - box.minX},${y - box.minY})`);
      const mid = x + w / 2;
      const nameY = y + rowH + 20 + nameSize;
      svg
        .append('text')
        .attr('x', mid)
        .attr('y', nameY)
        .attr('text-anchor', 'middle')
        .attr('fill', v.paint.text)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', nameSize)
        .attr('font-weight', 600)
        .attr('data-line-number', v.m.lineNumber)
        .text(v.m.name ?? '');
      if (!parsed.options.noPercent && v.m.hasTarget) {
        drawReadout(
          svg,
          v,
          mid,
          nameY + readSize + 10,
          'middle',
          readSize,
          v.paint.muted,
          // Neighbouring readouts sit w + cellGap apart, centre to centre.
          w + cellGap
        );
      }
      x += w + cellGap;
    }
    maxX = Math.max(maxX, x - cellGap);
    y += rowH + 20 + nameSize + 10 + readSize + rowGap;
  }
  y -= rowGap;

  if (parsed.description && !parsed.options.noNote) {
    y = drawNote(
      svg,
      parsed.description,
      first.paint,
      0,
      y + 36,
      Math.max(400, maxX)
    );
  }
  return { minX: 0, minY: 0, maxX, maxY: y };
}

/** Tick marks on a target-scaled face: 0/½/1 major, ¼/¾ minor, plus the target. */
interface ScaleMark {
  f: number;
  kind: 'minor' | 'major' | 'target';
}

/**
 * The marks along the scale. When the scale ends at the target, the end IS
 * the target, as before bands. When it runs past, the target is its own mark
 * and a major label too close to it gives way.
 */
function scaleMarks(targetFrac: number): ScaleMark[] {
  const past = targetFrac < 0.999;
  const marks: ScaleMark[] = [
    { f: 0.25, kind: 'minor' },
    { f: 0.75, kind: 'minor' },
  ];
  for (const f of [0, 0.5, 1]) {
    marks.push({ f, kind: !past && f === 1 ? 'target' : 'major' });
  }
  if (past) marks.push({ f: targetFrac, kind: 'target' });
  return marks;
}

/** Estimated ink box of one text run, for overlap checks between labels. */
interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Cap height as a fraction of the font size (digits and capitals). */
const CAP_HEIGHT = 0.73;

function labelBox(
  text: string,
  x: number,
  baseline: number,
  size: number,
  anchor: 'start' | 'middle' | 'end',
  bold: boolean
): LabelBox {
  const w = measureText(text, size, { bold });
  const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  return { x0, y0: baseline - size * CAP_HEIGHT, x1: x0 + w, y1: baseline };
}

function boxesHit(a: LabelBox, b: LabelBox, pad = 0): boolean {
  return (
    a.x0 < b.x1 + pad &&
    a.x1 + pad > b.x0 &&
    a.y0 < b.y1 + pad &&
    a.y1 + pad > b.y0
  );
}

// ── Thermometer face ─────────────────────────────────────────
function renderThermometer(
  svg: Svg,
  parsed: ParsedGoal,
  v: GoalView,
  cell: boolean
): Box {
  const { m, metrics, paint } = v;
  const tubeW = 68;
  const r = tubeW / 2;
  const bulbR = 52;
  const inset = 8; // mercury sits inside the glass
  const totalH = 440;
  const glassTop = 0; // apex of the rounded cap at the top of the coord space
  const bulbCy = totalH - bulbR;

  // Layout: [ left text column | gap | ribbon labels | ribbon | tube (+ right labels) ].
  // A cell of a multi-measure chart has no text column: its name and readout
  // sit under it.
  const zoneLabelSize = 15;
  const zoneLabelW = zoneLabelWidth(v, zoneLabelSize);
  const ribbonRoom = v.ribbon
    ? RIBBON_GAP + RIBBON_W + (zoneLabelW > 0 ? 10 + zoneLabelW : 0)
    : 0;
  const textColW = cell ? 0 : 440;
  const gap = cell ? 0 : 56;
  const colLeft = 0;
  const cx = colLeft + textColW + gap + ribbonRoom + r;

  // One unified thermometer silhouette (flat top for the mercury, rounded cap
  // for the glass) — a single path so bulb + column read as ONE shape with a
  // single clean outline, never two overlapping strokes.
  const bodyPath = (
    topY: number,
    halfW: number,
    br: number,
    roundedCap: boolean
  ): string => {
    const yJoin = bulbCy - Math.sqrt(br * br - halfW * halfW);
    const bulb = `L ${cx + halfW} ${yJoin} A ${br} ${br} 0 1 1 ${cx - halfW} ${yJoin} Z`;
    return roundedCap
      ? `M ${cx - halfW} ${topY + halfW} A ${halfW} ${halfW} 0 0 1 ${cx + halfW} ${topY + halfW} ${bulb}`
      : `M ${cx - halfW} ${topY} L ${cx + halfW} ${topY} ${bulb}`;
  };

  const g = svg.append('g').attr('class', 'goal-thermometer');

  // Glass track: rounded-cap tube + bulb, one shape.
  g.append('path')
    .attr('d', bodyPath(glassTop, r, bulbR, true))
    .attr('fill', paint.track);

  // Mercury scale: the scale's end at yTop (just below the cap), 0 at the
  // mercury bulb join. `actual` maps linearly; the fill's flat top sits there.
  const mHalf = r - inset;
  const mBulb = bulbR - inset;
  const yTop = glassTop + r;
  const yBase = bulbCy - Math.sqrt(mBulb * mBulb - mHalf * mHalf);
  const yForFrac = (f: number): number => yTop + (1 - f) * (yBase - yTop);
  const fillTopY = clamp(yForFrac(metrics.fillFrac), yTop, yBase);

  // Mercury: bulb reservoir always full; the column rises to `fillTopY` with a
  // FLAT top. Single path, single stroke.
  g.append('path')
    .attr('d', bodyPath(fillTopY, mHalf, mBulb, false))
    // Solid band colour: the tint read as empty glass (#2095). Outline mode
    // keeps its hollow mercury.
    .attr(
      'fill',
      parsed.options.fillMode === 'outline' ? paint.fill : paint.base
    )
    .attr('stroke', paint.base)
    .attr('stroke-width', parsed.options.fillMode === 'outline' ? 1.5 : 2)
    .attr('stroke-linejoin', 'round');

  // Band ribbon to the LEFT of the tube, labels right-aligned beside it.
  if (v.ribbon) {
    const rx = cx - r - RIBBON_GAP - RIBBON_W;
    const rg = g.append('g').attr('class', 'goal-ribbon');
    const first = v.zones[0]!;
    if (first.start > 0) {
      // Below the first edge: a neutral segment in the glass colour, so the
      // strip runs unbroken from 0 (#2095).
      const yEdge = yForFrac(first.start / v.scaleEnd);
      rg.append('rect')
        .attr('x', rx)
        .attr('y', yEdge)
        .attr('width', RIBBON_W)
        .attr('height', Math.max(0, yForFrac(0) - yEdge))
        .attr('fill', paint.track);
    }
    for (const z of v.zones) {
      const y1 = yForFrac(z.end / v.scaleEnd);
      const y2 = yForFrac(z.start / v.scaleEnd);
      rg.append('rect')
        .attr('x', rx)
        .attr('y', y1)
        .attr('width', RIBBON_W)
        .attr('height', Math.max(0, y2 - y1))
        .attr('fill', z.color);
      if (v.ribbonLabels && z.label) {
        rg.append('text')
          .attr('x', rx - 10)
          .attr('y', (y1 + y2) / 2 + zoneLabelSize * 0.35)
          .attr('text-anchor', 'end')
          .attr('fill', paint.ink(z.color))
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', zoneLabelSize)
          .attr('font-weight', 600)
          .text(z.label);
      }
    }
  }

  // Graduation ticks etched ON the glass (from the right inner edge inward),
  // with value labels just to the right. Every label is placed against the
  // ones already down, so none overprints another (#2095).
  const placed: LabelBox[] = [];
  let rightMost = cx + r + 20;
  const note = (b: LabelBox): void => {
    placed.push(b);
    rightMost = Math.max(rightMost, b.x1);
  };
  let topMost = 0;
  if (m.hasTarget) {
    const edgeX = cx + r; // right edge of the glass tube
    const tickLabelX = edgeX + 14;
    const tf = metrics.targetFrac;
    const past = tf < 0.999;

    // With bands: 0, every band edge, the target and the scale end. Without:
    // the quarter steps, as before.
    let marks: ScaleMark[];
    if (v.ribbon) {
      marks = [];
      const vals = [0, v.scaleEnd, ...v.zones.flatMap((z) => [z.start, z.end])];
      for (const val of vals) {
        const f = clamp(val / v.scaleEnd, 0, 1);
        if (Math.abs(f - tf) < 1e-6) continue;
        if (marks.some((k) => Math.abs(k.f - f) < 1e-6)) continue;
        marks.push({ f, kind: 'major' });
      }
      marks.push({ f: tf, kind: 'target' });
    } else {
      marks = scaleMarks(tf);
    }

    for (const mark of marks) {
      const isTarget = mark.kind === 'target';
      const major = mark.kind !== 'minor';
      const y = yForFrac(mark.f);
      if (isTarget && past) {
        // Past target: a dark tick across the whole tube, read through the fill.
        g.append('line')
          .attr('class', 'goal-target-tick')
          .attr('x1', cx - r)
          .attr('y1', y)
          .attr('x2', edgeX)
          .attr('y2', y)
          .attr('stroke', paint.text)
          .attr('stroke-width', 4);
      } else {
        g.append('line')
          .attr('x1', edgeX)
          .attr('y1', y)
          .attr('x2', edgeX - (isTarget ? 26 : major ? 18 : 10))
          .attr('y2', y)
          .attr('stroke', isTarget ? paint.base : paint.muted)
          .attr('stroke-width', isTarget ? 4 : major ? 2 : 1.5);
      }
    }

    // The target (`TARGET 100` on one line) and the actual value come first;
    // when they sit closer than their heights, the higher one moves up and
    // the lower one down, an even split.
    const targetSize = 30;
    const actualSize = 42;
    const capSize = 15;
    const capText = 'TARGET';
    const capW = measureText(capText, capSize, { bold: true }) + capText.length;
    const targetText = compactNumber(m.target);
    const actualText = compactNumber(m.actual);
    let cT = yForFrac(tf);
    let cA = fillTopY;
    const need = ((targetSize + actualSize) * CAP_HEIGHT) / 2 + VALUE_LABEL_GAP;
    if (Math.abs(cA - cT) < need) {
      const mid = (cA + cT) / 2;
      const up = cA <= cT ? 1 : -1; // +1: the actual is the higher label
      cA = mid - (up * need) / 2;
      cT = mid + (up * need) / 2;
    }
    const baseT = cT + targetSize * 0.35;
    const baseA = cA + actualSize * 0.35;
    g.append('text')
      .attr('x', tickLabelX)
      .attr('y', baseT)
      .attr('text-anchor', 'start')
      .attr('fill', paint.muted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', capSize)
      .attr('font-weight', 'bold')
      .attr('letter-spacing', 1)
      .text(capText);
    note(labelBox(capText, tickLabelX, baseT, capSize, 'start', true));
    const targetX = tickLabelX + capW + 10;
    g.append('text')
      .attr('x', targetX)
      .attr('y', baseT)
      .attr('text-anchor', 'start')
      .attr('fill', paint.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', targetSize)
      .attr('font-weight', 700)
      .text(targetText);
    note(labelBox(targetText, targetX, baseT, targetSize, 'start', true));

    // `actual` value at the mercury level — series color, bold, to the right.
    // Explicit baseline (not dominant-baseline) so WebKit doesn't clip it.
    g.append('text')
      .attr('x', tickLabelX)
      .attr('y', baseA)
      .attr('text-anchor', 'start')
      .attr('fill', paint.base)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', actualSize)
      .attr('font-weight', 'bold')
      .text(actualText);
    note(labelBox(actualText, tickLabelX, baseA, actualSize, 'start', true));

    // The other scale labels: the ends first, then the rest; one that would
    // overprint a label already down gives way.
    const rest = marks
      .filter((k) => k.kind === 'major')
      .sort((p, q) => {
        const end = (k: ScaleMark): number => (k.f === 0 || k.f === 1 ? 0 : 1);
        return end(p) - end(q) || p.f - q.f;
      });
    for (const mark of rest) {
      const base = yForFrac(mark.f) + 19 * 0.35;
      const text = compactNumber(v.scaleEnd * mark.f);
      const box = labelBox(text, tickLabelX, base, 19, 'start', false);
      if (placed.some((o) => boxesHit(box, o, 3))) continue;
      g.append('text')
        .attr('x', tickLabelX)
        .attr('y', base)
        .attr('text-anchor', 'start')
        .attr('fill', paint.muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 19)
        .attr('font-weight', 500)
        .text(text);
      note(box);
    }
    topMost = Math.min(0, ...placed.map((b) => b.y0));
  }

  // Right extent: the labels sit just past the tube's right edge.
  const rightExtent = rightMost;
  const bottomMost = Math.max(bulbCy + bulbR, ...placed.map((b) => b.y1));
  if (cell) {
    return { minX: 0, minY: topMost, maxX: rightExtent, maxY: bottomMost };
  }

  // Title + readout stacked in the left column, top-aligned to the tube apex,
  // left-aligned so the column reads as a block.
  const titleSize = GOAL_TITLE_SIZE;
  let cursorY = glassTop;
  if (parsed.title && !parsed.options.noTitle) {
    const fit = fitTitle(parsed, textColW, titleSize);
    faceTitle(
      svg,
      parsed,
      paint,
      colLeft,
      cursorY + titleSize,
      'start',
      titleSize,
      fit
    );
    cursorY += titleSize + 16 + titleExtra(fit, titleSize);
  }
  if (!parsed.options.noPercent) {
    const suffix = v.status?.label ?? null;
    if (suffix && readoutWidth(v, 64) > textColW) {
      // `112% · Target met` does not fit the column: the band name goes on
      // its own line under the percent (#2095).
      const pctSize = fitSize(metrics.pctLabel, 64, textColW);
      svg
        .append('text')
        .attr('x', colLeft)
        .attr('y', cursorY + 52)
        .attr('text-anchor', 'start')
        .attr('fill', paint.muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', pctSize)
        .attr('font-weight', 'bold')
        .text(metrics.pctLabel);
      const nameSize = fitSize(suffix, 32, textColW);
      // Past the smallest size, the band name is cut with `…` (#2443).
      const shown = truncateText(suffix, nameSize, textColW, BOLD);
      const nameText = svg
        .append('text')
        .attr('class', 'goal-readout')
        .attr('x', colLeft)
        .attr('y', cursorY + 52 + 8 + nameSize)
        .attr('text-anchor', 'start')
        .attr('fill', paint.ink(v.status!.color))
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', nameSize)
        .attr('font-weight', 'bold')
        .text(shown);
      if (shown !== suffix) nameText.attr(FULL_TEXT_ATTR, suffix);
      cursorY += 76 + 8 + nameSize;
    } else {
      drawReadout(svg, v, colLeft, cursorY + 52, 'start', 64, paint.muted);
      cursorY += 76;
    }
  }

  // Optional `note` description in the left column, under the percentage.
  let colBottom = cursorY;
  if (parsed.description && !parsed.options.noNote) {
    colBottom = drawNote(
      svg,
      parsed.description,
      paint,
      colLeft,
      cursorY + 8,
      textColW
    );
  }

  return {
    minX: 0,
    minY: topMost,
    maxX: rightExtent,
    maxY: Math.max(bottomMost, colBottom),
  };
}

// ── Gauge face ───────────────────────────────────────────────
/** Semicircle arc path from fraction t0 to t1 (0 = left, 1 = right, over the top). */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  t0: number,
  t1: number
): string {
  const a0 = Math.PI - t0 * Math.PI;
  const a1 = Math.PI - t1 * Math.PI;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy - r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy - r * Math.sin(a1);
  // t is a fraction of the 180° semicircle, so the sweep |t1-t0|·π never
  // exceeds π — the large-arc flag is always 0. (Using a >0.5 test here drew
  // the reflex major arc for any fill above 50%.)
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}

function renderGauge(
  svg: Svg,
  parsed: ParsedGoal,
  v: GoalView,
  cell: boolean,
  /** Smallest label size the face may use, from a cell's rendered scale. */
  textFloor = 0
): Box {
  const { m, metrics, paint } = v;
  const stroke = 36;
  const r = 210; // fixed logical radius; the viewBox scales it to the canvas
  // With a `note`, mirror the thermometer: a left text column (title, rule,
  // note) beside the arc. Without one, the arc is centered with a title above.
  // A cell of a multi-measure chart has neither.
  const hasNote = !cell && !!parsed.description && !parsed.options.noNote;
  const colW = hasNote ? 400 : 0;
  const colGap = hasNote ? 56 : 0;
  const colLeft = 0;
  // No-note gauge: a centered title above the arc. Reserve the full title
  // height + a gap so the arc's stroked crest never rides up into it.
  const hasTopTitle =
    !cell && !hasNote && !!parsed.title && !parsed.options.noTitle;

  // Band ribbon OUTSIDE the arc, labels beyond it (#1973 rule 7).
  const zoneLabelSize = 15;
  const zoneLabelW = zoneLabelWidth(v, zoneLabelSize);
  const ribbonOut = v.ribbon ? RIBBON_GAP + RIBBON_W : 0;
  const labelOut = zoneLabelW > 0 ? 10 : 0;
  const sideRoom = v.ribbon
    ? stroke / 2 + ribbonOut + labelOut + zoneLabelW
    : 0;
  const topRoom = v.ribbon
    ? ribbonOut + (zoneLabelW > 0 ? labelOut + zoneLabelSize + 4 : 0)
    : 0;

  const cx = colLeft + colW + colGap + sideRoom + r;
  // A long title wraps (#2443): to the column beside a note, or over the
  // dial's width when centred above it; extra lines move the arc down.
  const titleFit = cell
    ? null
    : fitTitle(parsed, hasNote ? colW : 2 * (sideRoom + r));
  const topTitleH = hasTopTitle
    ? GOAL_TITLE_SIZE + 6 + 16 + titleExtra(titleFit)
    : 0;
  const cy = r + stroke / 2 + topTitleH + topRoom; // band crest sits below the title

  const g = svg.append('g').attr('class', 'goal-gauge');
  // Every label drawn on the face, for the overlap checks.
  const boxes: LabelBox[] = [];

  // Top-align the left column with the arc's visual crest (band top edge).
  const crestTop = cy - r - stroke / 2;
  let colBottom = crestTop;
  if (hasNote) {
    const titleSize = GOAL_TITLE_SIZE;
    let top = crestTop;
    if (parsed.title && !parsed.options.noTitle) {
      // cap-top ≈ crest
      faceTitle(
        svg,
        parsed,
        paint,
        colLeft,
        top + titleSize * 0.78,
        'start',
        titleSize,
        titleFit
      );
      top += titleSize * 0.78 + 16 + titleExtra(titleFit, titleSize);
    }
    colBottom = drawNote(svg, parsed.description, paint, colLeft, top, colW);
  } else if (hasTopTitle) {
    faceTitle(
      svg,
      parsed,
      paint,
      cx,
      GOAL_TITLE_SIZE,
      'middle',
      GOAL_TITLE_SIZE,
      titleFit
    );
  }

  g.append('path')
    .attr('d', arcPath(cx, cy, r, 0, 1))
    .attr('fill', 'none')
    .attr('stroke', paint.track)
    .attr('stroke-width', stroke)
    .attr('stroke-linecap', 'round');

  if (metrics.fillFrac > 0.001) {
    const valueArc = arcPath(cx, cy, r, 0, metrics.fillFrac);
    if (parsed.options.fillMode === 'outline') {
      // Hollow band: a full-width band in the border color, then the same
      // path re-stroked 3px narrower in the theme base bg (paint.fill in
      // outline mode) — concentric round caps leave a uniform ~1.5px rim, so
      // the outlined region's extent still reads against the gray track.
      g.append('path')
        .attr('d', valueArc)
        .attr('fill', 'none')
        .attr('stroke', paint.base)
        .attr('stroke-width', stroke)
        .attr('stroke-linecap', 'round');
      g.append('path')
        .attr('d', valueArc)
        .attr('fill', 'none')
        .attr('stroke', paint.fill)
        .attr('stroke-width', stroke - 3)
        .attr('stroke-linecap', 'round');
    } else {
      g.append('path')
        .attr('d', valueArc)
        .attr('fill', 'none')
        .attr('stroke', paint.fill)
        .attr('stroke-width', stroke)
        .attr('stroke-linecap', 'round');
    }
  }

  if (v.ribbon) {
    const rg = g.append('g').attr('class', 'goal-ribbon');
    const ribbonR = r + stroke / 2 + RIBBON_GAP + RIBBON_W / 2;
    const labelR = r + stroke / 2 + ribbonOut + labelOut;
    for (const z of v.zones) {
      const t0 = z.start / v.scaleEnd;
      const t1 = z.end / v.scaleEnd;
      rg.append('path')
        .attr('d', arcPath(cx, cy, ribbonR, t0, t1))
        .attr('fill', 'none')
        .attr('stroke', z.color)
        .attr('stroke-width', RIBBON_W)
        .attr('stroke-linecap', 'butt');
      if (v.ribbonLabels && z.label) {
        const ang = Math.PI - ((t0 + t1) / 2) * Math.PI;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        // Anchored AWAY from the centre on the sides; centred over the crest.
        const anchor = ca > 0.2 ? 'start' : ca < -0.2 ? 'end' : 'middle';
        const lx = cx + labelR * ca;
        const ly = cy - labelR * sa;
        rg.append('text')
          .attr('x', lx)
          .attr(
            'y',
            anchor === 'middle' ? ly - 2 : ly + zoneLabelSize * 0.35 * (1 - sa)
          )
          .attr('text-anchor', anchor)
          .attr('fill', paint.ink(z.color))
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', zoneLabelSize)
          .attr('font-weight', 600)
          .text(z.label);
        boxes.push(
          labelBox(
            z.label,
            lx,
            anchor === 'middle' ? ly - 2 : ly + zoneLabelSize * 0.35 * (1 - sa),
            zoneLabelSize,
            anchor,
            true
          )
        );
      }
    }
  }

  // No needle: the fill arc is the reading (#2096). Every label below is
  // measured and placed against the ones already down.
  const bandInner = r - stroke / 2;
  const bandOuter = r + stroke / 2;
  const footSize = Math.max(20, textFloor);
  const targetSize = Math.max(30, textFloor);
  const put = (
    text: string,
    x: number,
    y: number,
    size: number,
    anchor: 'start' | 'middle' | 'end',
    fill: string,
    weight: number | string,
    cls?: string
  ): LabelBox => {
    const t = g
      .append('text')
      .attr('x', x)
      .attr('y', y)
      .attr('text-anchor', anchor)
      .attr('fill', fill)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', size)
      .attr('font-weight', weight);
    if (cls) t.attr('class', cls);
    t.text(text);
    const box = labelBox(
      text,
      x,
      y,
      size,
      anchor,
      weight === 'bold' || Number(weight) >= 600
    );
    boxes.push(box);
    return box;
  };
  const tickAt = (
    f: number,
    from: number,
    to: number,
    w: number,
    color: string,
    cls?: string
  ) => {
    const ang = Math.PI - f * Math.PI;
    g.append('line')
      .attr('class', cls ?? null)
      .attr('x1', cx + from * Math.cos(ang))
      .attr('y1', cy - from * Math.sin(ang))
      .attr('x2', cx + to * Math.cos(ang))
      .attr('y2', cy - to * Math.sin(ang))
      .attr('stroke', color)
      .attr('stroke-width', w);
  };

  // The band name under the dial's centre (#1973 rule 9). The gauge shows no
  // percent of its own — the value carries it — so the readout here is the
  // name alone. A cell's readout sits under the cell instead.
  let hubBottom = cy + stroke / 2;
  if (!cell && !parsed.options.noPercent && v.status?.label) {
    // Cut with `…` to the dial's width (#2443).
    const shown = truncateText(v.status.label, 24, 2 * r, BOLD);
    put(
      shown,
      cx,
      cy + 50,
      24,
      'middle',
      paint.ink(v.status.color),
      'bold',
      'goal-readout'
    );
    if (shown !== v.status.label)
      g.select('text.goal-readout').attr(FULL_TEXT_ATTR, v.status.label);
    hubBottom = cy + 58;
  }

  if (m.hasTarget) {
    const tf = metrics.targetFrac;
    const targetAtEnd = tf >= 0.999;

    // 0 and the scale end at the arc feet, below the band ends; a ticked
    // halfway mark on a single gauge only. The end label gives way to the
    // target number when the target IS the end.
    const footY = cy + stroke / 2 + 6 + footSize * CAP_HEIGHT;
    put(compactNumber(0), cx - r, footY, footSize, 'middle', paint.muted, 500);
    if (!targetAtEnd) {
      put(
        compactNumber(v.scaleEnd),
        cx + r,
        footY,
        footSize,
        'middle',
        paint.muted,
        500
      );
    }
    if (!cell) {
      tickAt(0.5, bandInner, bandInner - 12, 2, paint.muted);
      const halfSize = 18;
      const halfBox = labelBox(
        compactNumber(v.scaleEnd * 0.5),
        cx,
        cy - bandInner + 12 + 6 + halfSize * CAP_HEIGHT,
        halfSize,
        'middle',
        false
      );
      if (!boxes.some((o) => boxesHit(halfBox, o, 3))) {
        put(
          compactNumber(v.scaleEnd * 0.5),
          cx,
          halfBox.y1,
          halfSize,
          'middle',
          paint.muted,
          500
        );
      }
    }

    // The target: a notch across the band, and its number OUTSIDE the
    // outermost ring drawn, pushed outward until it clears every other label.
    tickAt(tf, bandInner - 6, bandOuter + 3, 4, paint.text, 'goal-target-tick');
    const ang = Math.PI - tf * Math.PI;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const anchor = ca > 0.2 ? 'start' : ca < -0.2 ? 'end' : 'middle';
    const tText = compactNumber(m.target);
    const h = targetSize * CAP_HEIGHT;
    const ringOut = v.ribbon
      ? bandOuter + ribbonOut + (zoneLabelW > 0 ? labelOut + zoneLabelW : 0)
      : bandOuter;
    for (let k = 0; k < 16; k++) {
      const rr = ringOut + 10 + k * 6;
      const x = cx + rr * ca;
      // Centred beside the ring on the sides, sitting on it over the crest.
      const base = cy - rr * sa + (1 - sa) * (h / 2) - sa * 2;
      const box = labelBox(tText, x, base, targetSize, anchor, true);
      if (k < 15 && boxes.some((o) => boxesHit(box, o, 4))) continue;
      put(tText, x, base, targetSize, anchor, paint.text, 700);
      break;
    }
  }

  // `actual` value dominates the interior: bold, in the arc's belly with its
  // baseline just above the hub line. Shrunk until its box sits inside the
  // arc and meets no label.
  const nowLabel = compactNumber(m.actual);
  const nowBase = cy - 14;
  let nowSize = Math.min(
    r * 0.62,
    140,
    (r * 0.95) / Math.max(1, nowLabel.length * 0.6)
  );
  const inside = bandInner - 12;
  for (; nowSize > 10; nowSize *= 0.97) {
    const b = labelBox(nowLabel, cx, nowBase, nowSize, 'middle', true);
    const corner = Math.hypot((b.x1 - b.x0) / 2, cy - b.y0);
    if (corner <= inside && !boxes.some((o) => boxesHit(b, o, 6))) break;
  }
  put(nowLabel, cx, nowBase, nowSize, 'middle', paint.muted, 'bold');

  return {
    minX: Math.min(0, ...boxes.map((b) => b.x0)),
    minY: Math.min(0, crestTop - topRoom, ...boxes.map((b) => b.y0)),
    maxX: Math.max(cx + r + Math.max(20, sideRoom), ...boxes.map((b) => b.x1)),
    maxY: Math.max(hubBottom, colBottom, ...boxes.map((b) => b.y1)),
  };
}
