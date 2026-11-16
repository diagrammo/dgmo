// ============================================================
// Goal chart — D3 SVG Renderer
// ============================================================
//
// Three faces off the same `actual`/`target` pair:
//   - bar         : horizontal rounded fill (default)
//   - thermometer : vertical rounded tube + bulb
//   - gauge       : semicircular dial with needle + value arc
// Over-target clamps the fill at the scale's end; the % label stays truthful.
//
// Bands (#1973): the fill takes the colour of the band the actual sits in,
// and a 5px ribbon maps the zones beside the track — below the bar, left of
// the tube, outside the arc. Several `[Measure]` rows (#1851) draw as a
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
import { measureText } from '../utils/text-measure';
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
      : renderCells(host, parsed, views)
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

/** Title placed immediately above a face's element (not the top-center slot). */
function faceTitle(
  svg: Svg,
  parsed: ParsedGoal,
  paint: GoalPaint,
  x: number,
  y: number,
  anchor = 'middle',
  size = GOAL_TITLE_SIZE
): void {
  if (!parsed.title || parsed.options.noTitle) return;
  svg
    .append('text')
    .attr('class', 'chart-title')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('fill', paint.text)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', size)
    .attr('font-weight', TITLE_FONT_WEIGHT)
    .attr('data-line-number', parsed.titleLineNumber)
    .text(parsed.title);
}

/** The band name after the percent (`64% · OK`) — null when there is none. */
function statusSuffix(v: GoalView): string | null {
  return v.status?.label ? ` · ${v.status.label}` : null;
}

/** Text width of the readout, for column sizing. */
function readoutWidth(v: GoalView, size: number): number {
  return measureText(`${v.metrics.pctLabel}${statusSuffix(v) ?? ''}`, size, {
    bold: true,
  });
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
  pctFill: string
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
  const suffix = statusSuffix(v);
  if (!suffix) {
    t.text(v.metrics.pctLabel);
    return;
  }
  t.append('tspan').text(v.metrics.pctLabel);
  t.append('tspan').attr('fill', v.paint.ink(v.status!.color)).text(suffix);
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
 * Horizontal ribbon under a bar track: one 5px strip per zone in its solid
 * colour, labels centred under their zone. Returns the y past the last mark.
 */
function drawBarRibbon(
  g: Svg,
  v: GoalView,
  x: number,
  top: number,
  width: number,
  showLabels: boolean,
  labelSize: number
): number {
  const rg = g.append('g').attr('class', 'goal-ribbon');
  const at = (val: number): number => x + width * (val / v.scaleEnd);
  for (const z of v.zones) {
    rg.append('rect')
      .attr('x', at(z.start))
      .attr('y', top)
      .attr('width', Math.max(0, at(z.end) - at(z.start)))
      .attr('height', RIBBON_W)
      .attr('fill', z.color);
  }
  if (!showLabels) return top + RIBBON_W;
  for (const z of v.zones) {
    if (!z.label) continue;
    rg.append('text')
      .attr('x', (at(z.start) + at(z.end)) / 2)
      .attr('y', top + RIBBON_W + labelSize + 2)
      .attr('text-anchor', 'middle')
      .attr('fill', v.paint.ink(z.color))
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', labelSize)
      .attr('font-weight', 600)
      .text(z.label);
  }
  return top + RIBBON_W + labelSize + 6;
}

/**
 * One bar track: the rounded track, the clipped fill, the level edge, the
 * target tick when the scale runs past target, and the value inside the fill.
 */
function drawBarTrack(
  g: Svg,
  parsed: ParsedGoal,
  v: GoalView,
  x: number,
  y: number,
  trackW: number,
  trackH: number,
  valueSize: number
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

  const fillW = trackW * metrics.fillFrac;
  if (fillW > 0.5) {
    const clipped = g.append('g').attr('clip-path', `url(#${v.clipId})`);
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
  if (!parsed.options.noValue) {
    const valueText = compactNumber(v.m.actual);
    const valuePad = Math.round(valueSize * 0.66);
    const insideFits =
      fillW >= measureText(valueText, valueSize, { bold: true }) + valuePad * 2;
    const valX = insideFits ? x + fillW - valuePad : x + fillW + valuePad;
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

  // Top row above the bar: title on the left, readout on the right.
  if (hasTitle) faceTitle(svg, parsed, paint, x, titleSize - 2, 'start');
  const barRight = x + trackW;
  if (showPct) {
    drawReadout(svg, v, barRight, titleSize - 2, 'end', titleSize, paint.muted);
  }
  const y = hasTitle || showPct ? titleSize + 14 : 0;
  const barCy = y + trackH / 2;

  const g = svg.append('g').attr('class', 'goal-bar');
  drawBarTrack(g, parsed, v, x, y, trackW, trackH, 24);

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
  if (v.ribbon) {
    bottom = drawBarRibbon(
      g,
      v,
      x,
      bottom + RIBBON_GAP,
      trackW,
      v.ribbonLabels,
      15
    );
  }

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
  const readW = showPct
    ? Math.max(
        0,
        ...views.map((v) => (v.m.hasTarget ? readoutWidth(v, valSize) : 0))
      )
    : 0;
  const barX = nameW + 20;
  const targetX = barX + trackW + 16;
  const readX = targetX + targetColW + 22;

  let y = 0;
  if (parsed.title && !parsed.options.noTitle) {
    faceTitle(svg, parsed, first.paint, 0, GOAL_TITLE_SIZE - 2, 'start');
    y = GOAL_TITLE_SIZE + 26;
  }

  // Band labels: on the first row that has a ribbon, and again on any row
  // with bands of its own (#1851 rule 4).
  const firstRibbon = views.findIndex((v) => v.ribbon);

  views.forEach((v, i) => {
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
    drawBarTrack(g, parsed, v, barX, y, trackW, trackH, 16);
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
          v.paint.text
        );
      }
    }
    y += trackH;
    if (v.ribbon) {
      const labels = v.ribbonLabels && (i === firstRibbon || v.m.ownBands);
      y = drawBarRibbon(g, v, barX, y + RIBBON_GAP, trackW, labels, labelSize);
    }
    y += rowGap;
  });
  y -= rowGap;

  const maxX = showPct ? readX + readW : targetX + targetColW;
  if (parsed.description && !parsed.options.noNote) {
    y = drawNote(svg, parsed.description, first.paint, 0, y + 36, maxX);
  }
  return { minX: 0, minY: 0, maxX, maxY: y };
}

// ── Thermometer and gauge faces, several measures (#1851 rule 7) ──
function renderCells(svg: Svg, parsed: ParsedGoal, views: GoalView[]): Box {
  const nameSize = 24;
  const readSize = 22;
  const cellGap = 64;
  const rowGap = 48;
  const first = views[0]!;
  const firstRibbon = views.findIndex((v) => v.ribbon);

  let y = 0;
  if (parsed.title && !parsed.options.noTitle) {
    faceTitle(svg, parsed, first.paint, 0, GOAL_TITLE_SIZE - 2, 'start');
    y = GOAL_TITLE_SIZE + 36;
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
          : renderGauge(g, parsed, cellView, true);
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
          v.paint.muted
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

/** A major label this close to a past-target mark would overprint it. */
function crowdsTarget(m: ScaleMark, targetFrac: number): boolean {
  return (
    m.kind !== 'target' &&
    targetFrac < 0.999 &&
    Math.abs(m.f - targetFrac) < 0.1
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
    .attr('fill', paint.fill)
    .attr('stroke', paint.base)
    .attr('stroke-width', parsed.options.fillMode === 'outline' ? 1.5 : 2)
    .attr('stroke-linejoin', 'round');

  // Band ribbon to the LEFT of the tube, labels right-aligned beside it.
  if (v.ribbon) {
    const rx = cx - r - RIBBON_GAP - RIBBON_W;
    const rg = g.append('g').attr('class', 'goal-ribbon');
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
  // with value labels just to the right.
  if (m.hasTarget) {
    const edgeX = cx + r; // right edge of the glass tube
    const tickLabelX = edgeX + 14;
    const tf = metrics.targetFrac;
    for (const mark of scaleMarks(tf)) {
      const isTarget = mark.kind === 'target';
      const major = mark.kind !== 'minor';
      const y = yForFrac(mark.f);
      if (isTarget && tf < 0.999) {
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
      if (isTarget) {
        // "TARGET" caption above the emphasized goal value.
        g.append('text')
          .attr('x', tickLabelX)
          .attr('y', y - 20)
          .attr('text-anchor', 'start')
          .attr('fill', paint.muted)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', 15)
          .attr('font-weight', 'bold')
          .attr('letter-spacing', 1)
          .text('TARGET');
      }
      if (major && !crowdsTarget(mark, tf)) {
        g.append('text')
          .attr('x', tickLabelX)
          .attr('y', y + (isTarget ? 30 * 0.35 : 19 * 0.35))
          .attr('text-anchor', 'start')
          .attr('fill', isTarget ? paint.text : paint.muted)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', isTarget ? 30 : 19)
          .attr('font-weight', isTarget ? 700 : 500)
          .text(compactNumber(isTarget ? m.target : v.scaleEnd * mark.f));
      }
    }

    // `actual` value at the mercury level — series color, bold, to the right.
    // Explicit baseline (not dominant-baseline) so WebKit doesn't clip it.
    {
      g.append('text')
        .attr('x', tickLabelX)
        .attr('y', fillTopY + 42 * 0.35)
        .attr('text-anchor', 'start')
        .attr('fill', paint.base)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 42)
        .attr('font-weight', 'bold')
        .text(compactNumber(m.actual));
    }
  }

  // Right extent: `actual`/tick labels sit just past the tube's right edge.
  const rightExtent = m.hasTarget ? cx + r + 14 + 76 : cx + r + 20;
  if (cell) {
    return { minX: 0, minY: 0, maxX: rightExtent, maxY: bulbCy + bulbR };
  }

  // Title + readout stacked in the left column, top-aligned to the tube apex,
  // left-aligned so the column reads as a block.
  const titleSize = GOAL_TITLE_SIZE;
  let cursorY = glassTop;
  if (parsed.title && !parsed.options.noTitle) {
    svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', colLeft)
      .attr('y', cursorY + titleSize)
      .attr('text-anchor', 'start')
      .attr('fill', paint.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', titleSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('data-line-number', parsed.titleLineNumber)
      .text(parsed.title);
    cursorY += titleSize + 16;
  }
  if (!parsed.options.noPercent) {
    drawReadout(svg, v, colLeft, cursorY + 52, 'start', 64, paint.muted);
    cursorY += 76;
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
    minY: 0,
    maxX: rightExtent,
    maxY: Math.max(bulbCy + bulbR, colBottom),
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
  cell: boolean
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
  const topTitleH = hasTopTitle ? GOAL_TITLE_SIZE + 6 + 16 : 0;

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
  const cy = r + stroke / 2 + topTitleH + topRoom; // band crest sits below the title

  const g = svg.append('g').attr('class', 'goal-gauge');

  // Top-align the left column with the arc's visual crest (band top edge).
  const crestTop = cy - r - stroke / 2;
  let colBottom = crestTop;
  if (hasNote) {
    const titleSize = GOAL_TITLE_SIZE;
    let top = crestTop;
    if (parsed.title && !parsed.options.noTitle) {
      svg
        .append('text')
        .attr('class', 'chart-title')
        .attr('x', colLeft)
        .attr('y', top + titleSize * 0.78) // cap-top ≈ crest
        .attr('text-anchor', 'start')
        .attr('fill', paint.text)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', titleSize)
        .attr('font-weight', TITLE_FONT_WEIGHT)
        .attr('data-line-number', parsed.titleLineNumber)
        .text(parsed.title);
      top += titleSize * 0.78 + 16;
    }
    colBottom = drawNote(svg, parsed.description, paint, colLeft, top, colW);
  } else if (hasTopTitle) {
    faceTitle(svg, parsed, paint, cx, GOAL_TITLE_SIZE);
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
      }
    }
  }

  // Needle at the fill angle.
  const a = Math.PI - metrics.fillFrac * Math.PI;
  const needleLen = r - stroke / 2 - 6;
  const nx = cx + needleLen * Math.cos(a);
  const ny = cy - needleLen * Math.sin(a);
  g.append('line')
    .attr('x1', cx)
    .attr('y1', cy)
    .attr('x2', nx)
    .attr('y2', ny)
    .attr('stroke', paint.text)
    .attr('stroke-width', 5)
    .attr('stroke-linecap', 'round');
  g.append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', 11)
    .attr('fill', paint.text);

  // `actual` value dominates the interior — big, gray, filling the arc's belly.
  const nowLabel = compactNumber(m.actual);
  const bandInner = r - stroke / 2;
  // Keep long values inside ~0.95·r of chord. That alone does NOT clear the
  // 25/75 shoulder labels: they are anchored inward from radius
  // `bandInner - 26`, so their text grows toward cx and ends well inside that
  // chord. With a target, measure those two labels and size the value to the
  // gap that is really left between their inner edges.
  let nowSize = Math.min(
    r * 0.62,
    140,
    (r * 0.95) / Math.max(1, nowLabel.length * 0.6)
  );
  if (m.hasTarget) {
    const shoulderX = (bandInner - 26) * Math.SQRT1_2;
    const shoulderW = Math.max(
      measureText(compactNumber(v.scaleEnd * 0.25), 18),
      measureText(compactNumber(v.scaleEnd * 0.75), 18)
    );
    const halfClear = shoulderX - shoulderW - 8;
    const widthPerPx = measureText(nowLabel, 100, { bold: true }) / 100;
    if (widthPerPx > 0 && halfClear > 0) {
      nowSize = Math.min(nowSize, (2 * halfClear) / widthPerPx);
    }
  }
  const nowY = cy - r * 0.42;
  {
    g.append('text')
      .attr('x', cx)
      .attr('y', nowY + nowSize * 0.35)
      .attr('text-anchor', 'middle')
      .attr('fill', paint.muted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', nowSize)
      .attr('font-weight', 'bold')
      .text(nowLabel);
  }

  // The band name under the hub (#1973 rule 9). The gauge shows no percent of
  // its own — the value carries it — so the readout here is the name alone.
  // A cell's readout sits under the cell instead.
  let hubBottom = cy + 34;
  if (!cell && !parsed.options.noPercent && v.status?.label) {
    g.append('text')
      .attr('class', 'goal-readout')
      .attr('x', cx)
      .attr('y', cy + 50)
      .attr('text-anchor', 'middle')
      .attr('fill', paint.ink(v.status.color))
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 24)
      .attr('font-weight', 'bold')
      .text(v.status.label);
    hubBottom = cy + 58;
  }

  // Scale ticks + value labels around the arc: 0 at the left end, the scale's
  // end at the right end, quarter steps between. The needle + the value read
  // the current position.
  if (m.hasTarget) {
    const tf = metrics.targetFrac;
    // Every quarter is labelled on the dial, drawn left to right.
    const marks = scaleMarks(tf).sort((p, q) => p.f - q.f);
    for (const mark of marks) {
      const isTarget = mark.kind === 'target';
      const f = mark.f;
      const ang = Math.PI - f * Math.PI;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      if (isTarget && tf < 0.999) {
        // Past target: a dark tick across the band, read through the fill.
        g.append('line')
          .attr('class', 'goal-target-tick')
          .attr('x1', cx + (bandInner - 20) * ca)
          .attr('y1', cy - (bandInner - 20) * sa)
          .attr('x2', cx + (r + stroke / 2) * ca)
          .attr('y2', cy - (r + stroke / 2) * sa)
          .attr('stroke', paint.text)
          .attr('stroke-width', 4);
      } else {
        // Ticks point INWARD from the inner edge of the band.
        g.append('line')
          .attr('x1', cx + bandInner * ca)
          .attr('y1', cy - bandInner * sa)
          .attr('x2', cx + (bandInner - (isTarget ? 20 : 12)) * ca)
          .attr('y2', cy - (bandInner - (isTarget ? 20 : 12)) * sa)
          .attr('stroke', isTarget ? paint.base : paint.muted)
          .attr('stroke-width', isTarget ? 4 : 2);
      }
      if (crowdsTarget(mark, tf)) continue;
      const lr = bandInner - (isTarget ? 40 : 26);
      // Anchor toward the centre so inside labels sit clear of the band.
      const anchor = ca > 0.2 ? 'end' : ca < -0.2 ? 'start' : 'middle';
      if (isTarget) {
        // "target" caption above the value so the goal reads at a glance.
        g.append('text')
          .attr('x', cx + lr * ca)
          .attr('y', cy - lr * sa - 20)
          .attr('text-anchor', anchor)
          .attr('dominant-baseline', 'middle')
          .attr('fill', paint.muted)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', 15)
          .attr('font-weight', 'bold')
          .attr('letter-spacing', 1)
          .text('TARGET');
      }
      g.append('text')
        .attr('x', cx + lr * ca)
        .attr('y', cy - lr * sa)
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', sa > 0.7 ? 'hanging' : 'middle')
        .attr('fill', isTarget ? paint.text : paint.muted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', isTarget ? 30 : 18)
        .attr('font-weight', isTarget ? 700 : 500)
        .text(compactNumber(isTarget ? m.target : v.scaleEnd * f));
    }
  }

  const rightLabel = m.hasTarget ? 74 : 20;
  return {
    minX: 0,
    minY: Math.min(0, crestTop - topRoom),
    maxX: cx + r + Math.max(rightLabel, sideRoom),
    maxY: Math.max(hubBottom, colBottom),
  };
}
