// ============================================================
// Goal chart — D3 SVG Renderer
// ============================================================
//
// Three faces off the same `now`/`target` pair:
//   - bar         : horizontal rounded fill (default)
//   - thermometer : vertical rounded tube + bulb
//   - gauge       : semicircular dial with needle + value arc
// Over-target clamps the fill at 100%; the % label stays truthful (§3).

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';
import {
  mix,
  shapeFill,
  getSeriesColors,
  themeBaseBg,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { compactNumber } from '../treemap/treemap-shared';
import { parseInlineMarkdown } from '../utils/inline-markdown';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedGoal } from './types';

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Displayed magnitudes derived from the parsed value pair. */
interface GoalMetrics {
  pctFrac: number;
  fillFrac: number;
  pctLabel: string;
  valueLabel: string;
  ariaLabel: string;
}

function computeMetrics(parsed: ParsedGoal): GoalMetrics {
  const pctFrac = parsed.hasTarget ? parsed.now / parsed.target : 0;
  const fillFrac = clamp(pctFrac, 0, 1);
  const pctLabel = `${Math.round(pctFrac * 100)}%`;
  const targetLabel = parsed.hasTarget ? compactNumber(parsed.target) : '?';
  const valueLabel = `${compactNumber(parsed.now)} / ${targetLabel}`;
  const ariaTarget = parsed.hasTarget ? parsed.target : '?';
  const ariaLabel = `${parsed.title ?? 'Goal'}: ${parsed.now} of ${ariaTarget} (${Math.round(
    pctFrac * 100
  )}%)`;
  return { pctFrac, fillFrac, pctLabel, valueLabel, ariaLabel };
}

type Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

/** Content bounds returned by each face so renderGoal can fit the viewBox. */
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Resolved paint colors for a goal render. */
interface GoalPaint {
  base: string;
  fill: string;
  track: string;
  text: string;
  muted: string;
}

function resolvePaint(
  parsed: ParsedGoal,
  palette: PaletteColors,
  isDark: boolean
): GoalPaint {
  const base =
    (parsed.color && resolveColor(parsed.color, palette)) ||
    parsed.color ||
    getSeriesColors(palette)[0]!;
  return {
    base,
    fill: shapeFill(palette, base, isDark, { solid: parsed.options.solidFill }),
    track: mix(palette.border, themeBaseBg(palette, isDark), 45),
    text: palette.text,
    muted: mix(palette.text, themeBaseBg(palette, isDark), 55),
  };
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

  const metrics = computeMetrics(parsed);
  const paint = resolvePaint(parsed, palette, isDark);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', cw)
    .attr('height', ch)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('role', 'img')
    .attr('aria-label', metrics.ariaLabel)
    .style('font-family', FONT_FAMILY);

  // Each face lays out in its own natural coordinate space (top-left anchored)
  // and returns its content bounds. The viewBox is fitted to those bounds with
  // preserveAspectRatio="meet", so the whole diagram scales up/down and stays
  // centered at any canvas size instead of being clipped.
  const box =
    parsed.mode === 'thermometer'
      ? renderThermometer(svg, parsed, metrics, paint)
      : parsed.mode === 'gauge'
        ? renderGauge(svg, parsed, metrics, paint)
        : renderBar(svg, parsed, metrics, paint);

  const pad = 30;
  const vx = box.minX - pad;
  const vy = box.minY - pad;
  const vw = box.maxX - box.minX + pad * 2;
  const vh = box.maxY - box.minY + pad * 2;
  svg.attr('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  svg
    .insert('rect', ':first-child')
    .attr('x', vx)
    .attr('y', vy)
    .attr('width', vw)
    .attr('height', vh)
    .attr('fill', palette.bg);
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
  return token
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .replace(/\*\*|__|\*|_|`/g, '').length;
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
 * Draw a `note` description block: a horizontal rule spanning `width`, then the
 * wrapped markdown body left-aligned beneath it. Shared by every goal face so
 * the caption reads the same everywhere; each face picks a sensible box.
 * Returns the y just past the last line.
 */
function drawNote(
  svg: Svg,
  description: string,
  paint: GoalPaint,
  left: number,
  top: number,
  width: number
): number {
  svg
    .append('line')
    .attr('x1', left)
    .attr('y1', top)
    .attr('x2', left + width)
    .attr('y2', top)
    .attr('stroke', paint.track)
    .attr('stroke-width', 1.5);

  const descSize = 15;
  const lineH = descSize * 1.4;
  // Avg Inter advance ≈ 0.46em — fills the box up to the rule width.
  const maxChars = Math.max(8, Math.floor(width / (descSize * 0.46)));
  const firstY = top + 24;
  const lines = layoutDescription(description, left, maxChars);
  const desc = svg
    .append('text')
    .attr('x', left)
    .attr('y', firstY)
    .attr('text-anchor', 'start')
    .attr('fill', paint.muted)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', descSize)
    .attr('font-weight', 500);
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
  anchor = 'middle'
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
    .attr('font-size', TITLE_FONT_SIZE)
    .attr('font-weight', TITLE_FONT_WEIGHT)
    .attr('data-line-number', parsed.titleLineNumber)
    .text(parsed.title);
}

// ── Bar face ─────────────────────────────────────────────────
function renderBar(
  svg: Svg,
  parsed: ParsedGoal,
  metrics: GoalMetrics,
  paint: GoalPaint
): Box {
  const trackH = 52;
  const r = trackH / 2;
  const trackW = 620;
  const gap = parsed.hasTarget ? 18 : 0;
  const targetLabelW = parsed.hasTarget ? 80 : 0;
  const x = 0;
  const hasTitle = !!parsed.title && !parsed.options.noTitle;
  const titleSize = TITLE_FONT_SIZE;

  // Title sits above the bar, left-aligned.
  if (hasTitle) faceTitle(svg, parsed, paint, x, titleSize - 2, 'start');
  const y = hasTitle ? titleSize + 14 : 0;
  const barCy = y + trackH / 2;
  const barRight = x + trackW;

  const g = svg.append('g').attr('class', 'goal-bar');
  g.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', trackW)
    .attr('height', trackH)
    .attr('rx', r)
    .attr('fill', paint.track);

  const fillW = trackW * metrics.fillFrac;
  if (fillW > 0.5) {
    g.append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', fillW)
      .attr('height', trackH)
      .attr('rx', r)
      .attr('fill', paint.fill)
      .attr('stroke', paint.base)
      .attr('stroke-width', 2);
  }

  // Current value rides INSIDE the fill, tracking its right end.
  if (!parsed.options.noValue) {
    const valX = Math.max(x + fillW - 16, x + 52);
    g.append('text')
      .attr('x', valX)
      .attr('y', barCy)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'central')
      .attr('fill', paint.base)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 24)
      .attr('font-weight', 700)
      .text(compactNumber(parsed.now));
  }

  // Goal (target) to the RIGHT of the bar.
  if (parsed.hasTarget) {
    g.append('text')
      .attr('x', barRight + gap)
      .attr('y', barCy)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'central')
      .attr('fill', paint.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 26)
      .attr('font-weight', 700)
      .text(compactNumber(parsed.target));
  }

  // Optional `note` description below the bar, spanning the bar width.
  let bottom = y + trackH;
  if (parsed.description) {
    bottom = drawNote(svg, parsed.description, paint, x, bottom + 40, trackW);
  }

  return {
    minX: 0,
    minY: 0,
    maxX: barRight + gap + targetLabelW,
    maxY: bottom,
  };
}

// ── Thermometer face ─────────────────────────────────────────
function renderThermometer(
  svg: Svg,
  parsed: ParsedGoal,
  metrics: GoalMetrics,
  paint: GoalPaint
): Box {
  const tubeW = 68;
  const r = tubeW / 2;
  const bulbR = 52;
  const inset = 8; // mercury sits inside the glass
  const totalH = 440;
  const glassTop = 0; // apex of the rounded cap at the top of the coord space
  const bulbCy = totalH - bulbR;

  // Layout: [ left text column | gap | tube (+ right labels) ].
  const textColW = 440;
  const gap = 56;
  const colLeft = 0;
  const cx = colLeft + textColW + gap + r;

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

  // Mercury scale: v=target at yTop (just below the cap), v=0 at the mercury
  // bulb join. `now` maps linearly; the fill's flat top sits at that level.
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
    .attr('stroke-width', 2)
    .attr('stroke-linejoin', 'round');

  // Graduation ticks etched ON the glass (from the right inner edge inward),
  // with value labels just to the right.
  if (parsed.hasTarget) {
    const edgeX = cx + r; // right edge of the glass tube
    const tickLabelX = edgeX + 14;
    const drawTick = (f: number, major: boolean): void => {
      const y = yForFrac(f);
      g.append('line')
        .attr('x1', edgeX)
        .attr('y1', y)
        .attr('x2', edgeX - (major ? 18 : 10))
        .attr('y2', y)
        .attr('stroke', paint.muted)
        .attr('stroke-width', major ? 2 : 1.5);
      if (major) {
        g.append('text')
          .attr('x', tickLabelX)
          .attr('y', y)
          .attr('text-anchor', 'start')
          .attr('dominant-baseline', 'middle')
          .attr('fill', paint.muted)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', 19)
          .attr('font-weight', 500)
          .text(compactNumber(parsed.target * f));
      }
    };
    for (const f of [0.25, 0.75]) drawTick(f, false);
    for (const f of [0, 0.5, 1]) drawTick(f, true);

    // `now` value at the mercury level — series color, bold, to the right.
    g.append('text')
      .attr('x', tickLabelX)
      .attr('y', fillTopY)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'middle')
      .attr('fill', paint.base)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 42)
      .attr('font-weight', 700)
      .text(compactNumber(parsed.now));
  }

  // Title + percentage stacked in the left column, top-aligned to the tube apex,
  // left-aligned so the column reads as a block.
  const titleSize = TITLE_FONT_SIZE + 8;
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
    svg
      .append('text')
      .attr('x', colLeft)
      .attr('y', cursorY + 52)
      .attr('text-anchor', 'start')
      .attr('fill', paint.muted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 64)
      .attr('font-weight', 700)
      .text(metrics.pctLabel);
    cursorY += 76;
  }

  // Optional `note` description in the left column, under the percentage.
  let colBottom = cursorY;
  if (parsed.description) {
    colBottom = drawNote(
      svg,
      parsed.description,
      paint,
      colLeft,
      cursorY + 8,
      textColW
    );
  }

  // Right extent: `now`/tick labels sit just past the tube's right edge.
  const rightExtent = parsed.hasTarget ? cx + r + 14 + 76 : cx + r + 20;
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
  metrics: GoalMetrics,
  paint: GoalPaint
): Box {
  const stroke = 36;
  const r = 210; // fixed logical radius; the viewBox scales it to the canvas
  // With a `note`, mirror the thermometer: a left text column (title, rule,
  // note) beside the arc. Without one, the arc is centered with a title above.
  const hasNote = !!parsed.description;
  const colW = hasNote ? 400 : 0;
  const colGap = hasNote ? 56 : 0;
  const colLeft = 0;
  const titleH = !hasNote && parsed.title && !parsed.options.noTitle ? 34 : 0;
  const cx = colLeft + colW + colGap + r;
  const cy = r + titleH; // apex of the arc at y = titleH

  const g = svg.append('g').attr('class', 'goal-gauge');

  let colBottom = 0;
  if (hasNote) {
    const titleSize = TITLE_FONT_SIZE + 4;
    let top = 0; // top-align the column with the arc's apex
    if (parsed.title && !parsed.options.noTitle) {
      svg
        .append('text')
        .attr('class', 'chart-title')
        .attr('x', colLeft)
        .attr('y', top + titleSize)
        .attr('text-anchor', 'start')
        .attr('fill', paint.text)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', titleSize)
        .attr('font-weight', TITLE_FONT_WEIGHT)
        .attr('data-line-number', parsed.titleLineNumber)
        .text(parsed.title);
      top += titleSize + 14;
    }
    colBottom = drawNote(svg, parsed.description!, paint, colLeft, top, colW);
  } else {
    faceTitle(svg, parsed, paint, cx, titleH - 8);
  }

  g.append('path')
    .attr('d', arcPath(cx, cy, r, 0, 1))
    .attr('fill', 'none')
    .attr('stroke', paint.track)
    .attr('stroke-width', stroke)
    .attr('stroke-linecap', 'round');

  if (metrics.fillFrac > 0.001) {
    g.append('path')
      .attr('d', arcPath(cx, cy, r, 0, metrics.fillFrac))
      .attr('fill', 'none')
      .attr('stroke', paint.fill)
      .attr('stroke-width', stroke)
      .attr('stroke-linecap', 'round');
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

  // `now` value dominates the interior — big, gray, filling the arc's belly.
  const nowSize = Math.min(r * 0.62, 140);
  const nowY = cy - r * 0.42;
  g.append('text')
    .attr('x', cx)
    .attr('y', nowY)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', paint.muted)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', nowSize)
    .attr('font-weight', 700)
    .text(compactNumber(parsed.now));

  // Scale ticks + value labels around the arc: 0 at the left end, `target` at
  // the right end, quarter steps between. The needle + the NOW value read the
  // current position (no center % — the raw value carries the story).
  if (parsed.hasTarget) {
    const bandInner = r - stroke / 2;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const isTarget = f === 1;
      const ang = Math.PI - f * Math.PI;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Ticks point INWARD from the inner edge of the band.
      g.append('line')
        .attr('x1', cx + bandInner * ca)
        .attr('y1', cy - bandInner * sa)
        .attr('x2', cx + (bandInner - (isTarget ? 20 : 12)) * ca)
        .attr('y2', cy - (bandInner - (isTarget ? 20 : 12)) * sa)
        .attr('stroke', isTarget ? paint.base : paint.muted)
        .attr('stroke-width', isTarget ? 4 : 2);
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
          .attr('font-weight', 600)
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
        .text(compactNumber(parsed.target * f));
    }
  }

  const rightLabel = parsed.hasTarget ? 74 : 20;
  return {
    minX: 0,
    minY: 0,
    maxX: cx + r + rightLabel,
    maxY: Math.max(cy + 34, colBottom),
  };
}
