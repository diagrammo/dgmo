// ============================================================
// Bracket chart — D3 SVG Renderer
// ============================================================
//
// Draws the positioned tree from layout.ts. Two visual channels:
//   - FILL intensity = advancement (winner = 25% faded tint, loser = empty,
//     TBD = dashed) — structural, never authored.
//   - OUTLINE color = an author attribute (tag group), so you can read who
//     advanced AND, say, which ticketing system a team is on, at once.
// Plus: round labels, side banners, a tag legend, seed badges + home glyph +
// upset flag (seeded), a champion star, and prose commentary under a match.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import {
  mix,
  shapeFill,
  getSeriesColors,
  themeBaseBg,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { measureText } from '../utils/text-measure';
import { renderInlineText } from '../utils/inline-markdown';
import { resolveTagColor, tagAttrKey } from '../utils/tag-groups';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { LEGEND_GROUP_GAP } from '../utils/legend-constants';
import type { LegendGroupData, LegendPosition } from '../utils/legend-types';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedBracket } from './types';
import {
  layoutBracket,
  wrapText,
  BOX_W,
  BOX_H,
  PAIR_GAP,
  COMMENT_W,
  type LaidMatch,
  type ConnectorPoint,
} from './layout';

const PADDING = 16;
const TITLE_BAND = 40;
const HALF_SPAN = (BOX_H + PAIR_GAP) / 2;
const COMMENT_LH = 15;
const LEGEND_POSITION: LegendPosition = {
  placement: 'top-center',
  titleRelation: 'below-title',
};

type GSel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

function clip(s: string, maxW: number, fs: number): string {
  if (measureText(s, fs) <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(s.slice(0, mid) + '…', fs) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '' : s.slice(0, lo) + '…';
}

interface Paint {
  accent: string;
  ink: string;
  muted: string;
  hair: string;
  /** Connector/wire color — darker than box hairlines. */
  wire: string;
  track: string;
  tint: string;
}

function paintForAccent(
  palette: PaletteColors,
  isDark: boolean,
  accent: string
): Paint {
  const base = themeBaseBg(palette, isDark);
  return {
    accent,
    ink: palette.text,
    muted: mix(palette.text, base, 52),
    // Loser / TBD outlines + connectors are ink-based (not the pale border) so
    // they stay legible on top of a colored, shaded column band.
    hair: mix(palette.text, base, 34),
    wire: mix(palette.text, base, 30),
    track: mix(palette.border, base, 55),
    tint: shapeFill(palette, accent, isDark),
  };
}

function paintFor(
  palette: PaletteColors,
  isDark: boolean,
  sideColor?: string
): Paint {
  const accent =
    (sideColor && resolveColor(sideColor, palette)) ||
    sideColor ||
    getSeriesColors(palette)[0]!;
  return paintForAccent(palette, isDark, accent);
}

/** Per-box facts the renderer resolves from `parsed` + the competitor name. */
interface BoxInfo {
  isWinner: boolean;
  isLoser: boolean;
  pending: boolean;
  isChampion: boolean;
  score: string;
  seed: number | null;
  tagColor: string | null;
  tagValue: string | null;
  isHome: boolean;
}

export function renderBracket(
  container: HTMLDivElement,
  parsed: ParsedBracket,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  if (parsed.error) return;

  const layout = layoutBracket(parsed);
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const showTitle = !!parsed.title;
  const titleH = showTitle ? TITLE_BAND : 0;
  const exportMode = exportDims !== undefined;

  // ── Competitor lookups (tag color + seed) ──
  const seedByName = new Map<string, number>();
  for (const s of parsed.seeds)
    if (!seedByName.has(s.name)) seedByName.set(s.name, s.seed);
  const activeTag = parsed.activeTag;
  const activeKey = activeTag ? tagAttrKey(activeTag) : null;
  const tagValueOf = (name: string | null): string | null => {
    if (!name || !activeKey) return null;
    const meta = parsed.competitorMeta.get(name);
    return meta?.[activeKey] ?? null;
  };
  const tagColorOf = (name: string | null): string | null => {
    if (!name || !activeTag) return null;
    const meta = parsed.competitorMeta.get(name);
    if (!meta || !activeKey || !meta[activeKey]) return null;
    const c = resolveTagColor(meta, [...parsed.tagGroups], activeTag);
    return c ? (resolveColor(c, palette) ?? c) : null;
  };

  // ── Tag legend ──
  const activeGroup = activeTag
    ? parsed.tagGroups.find((g) => tagAttrKey(g.name) === tagAttrKey(activeTag))
    : undefined;
  const legendGroups: LegendGroupData[] =
    activeGroup && !parsed.noLegend
      ? [
          {
            name: activeGroup.name,
            entries: activeGroup.entries.map((e) => ({
              value: e.value,
              color: resolveColor(e.color, palette) ?? e.color,
            })),
          },
        ]
      : [];
  const legendReserve =
    legendGroups.length > 0
      ? getMaxLegendReservedHeight(
          { groups: legendGroups, position: LEGEND_POSITION, mode: 'preview' },
          width
        ) + LEGEND_GROUP_GAP
      : 0;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('class', 'dgmo-bracket')
    .attr('role', 'img')
    .attr(
      'aria-label',
      `Tournament bracket${parsed.title ? ` — ${parsed.title}` : ''}${
        layout.champion ? `, champion ${layout.champion}` : ''
      }`
    )
    .style('font-family', FONT_FAMILY);

  if (showTitle) {
    const t = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .text(parsed.title!);
    if (parsed.titleLineNumber !== null)
      t.attr('data-line-number', parsed.titleLineNumber);
  }

  const areaY = titleH + legendReserve + PADDING;
  const areaX = PADDING;
  const areaW = Math.max(1, width - PADDING * 2);
  const areaH = Math.max(1, height - areaY - PADDING);
  const scale = Math.min(1, areaW / layout.width, areaH / layout.height);
  const offsetX = areaX + (areaW - layout.width * scale) / 2;
  const offsetY = areaY;

  const root = svg
    .append('g')
    .attr('class', 'dgmo-bracket-body')
    .attr('transform', `translate(${offsetX},${offsetY}) scale(${scale})`);

  if (legendGroups.length > 0) {
    const legendG = svg
      .append('g')
      .attr('class', 'dgmo-bracket-legend')
      .attr('transform', `translate(0, ${titleH})`);
    renderIntegratedLegend(legendG, {
      groups: legendGroups,
      palette: {
        bg: palette.bg,
        surface: palette.surface,
        text: palette.text,
        textMuted: palette.textMuted,
        primary: palette.primary,
      },
      isDark,
      width,
      mode: exportMode ? 'export' : 'preview',
      position: LEGEND_POSITION,
      activeGroup: activeGroup?.name ?? null,
    });
  }

  // Default winner accent is blue (overridable with `accent <color>`); a side or
  // tag color still wins per-box.
  const baseAccent =
    parsed.accentColor ??
    resolveColor('blue', palette) ??
    getSeriesColors(palette)[0]!;
  const basePaint = paintForAccent(palette, isDark, baseAccent);
  const sideColorByLabel = new Map<string, string | undefined>();
  for (const s of parsed.sides) sideColorByLabel.set(s.label, s.color);

  const sideBarH = layout.sideLabels.length ? 30 : 0;
  const bandTop = sideBarH + 2;
  const roundY = sideBarH + 24;

  // ── Column shade bands (behind everything) for colored rounds ──
  // A column under a side bar starts below it; a groupless column (no side bar
  // above) runs to the very top so its band top-aligns with the side bars.
  for (const col of layout.columns) {
    if (!col.color) continue;
    const covered = layout.sideLabels.some(
      (s) => col.x >= s.x0 && col.x <= s.x1
    );
    const top = covered ? bandTop : 2;
    const c = resolveColor(col.color, palette) ?? col.color;
    root
      .append('rect')
      .attr('x', col.x - BOX_W / 2 - 10)
      .attr('y', top)
      .attr('width', BOX_W + 20)
      .attr('height', Math.max(0, layout.height - top))
      .attr('rx', 10)
      .attr('fill', mix(c, palette.bg, isDark ? 12 : 8));
  }

  // ── Side bars: a colored, shaded header spanning each side's columns ──
  for (const s of layout.sideLabels) {
    const c = s.color
      ? (resolveColor(s.color, palette) ?? s.color)
      : basePaint.accent;
    root
      .append('rect')
      .attr('x', s.x0 - 8)
      .attr('y', 2)
      .attr('width', s.x1 - s.x0 + 16)
      .attr('height', 24)
      .attr('rx', 8)
      .attr('fill', mix(c, palette.bg, isDark ? 20 : 14))
      .attr('stroke', mix(c, palette.bg, 55))
      .attr('stroke-width', 1);
    root
      .append('text')
      .attr('x', (s.x0 + s.x1) / 2)
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('font-size', 13)
      .attr('font-weight', 800)
      .attr('letter-spacing', 0.3)
      .attr('fill', c)
      .text(clip(s.label, s.x1 - s.x0, 13));
  }

  // ── Round labels ──
  // A groupless column (no side bar above it) puts its label in the top header
  // row, aligned with the side-bar labels; a grouped column's round label sits
  // in the lower band under its side bar.
  for (const col of layout.columns) {
    const c = col.color
      ? (resolveColor(col.color, palette) ?? col.color)
      : basePaint.muted;
    const covered = layout.sideLabels.some(
      (s) => col.x >= s.x0 && col.x <= s.x1
    );
    root
      .append('text')
      .attr('x', col.x)
      .attr('y', covered ? roundY : 22)
      .attr('text-anchor', 'middle')
      .attr('font-size', covered ? 14 : 15)
      .attr('font-weight', covered ? 700 : 800)
      .attr('fill', c)
      .attr('letter-spacing', 0.4)
      .text(clip(col.label, BOX_W + 20, covered ? 14 : 15));
  }

  // ── Connectors (behind boxes) ──
  for (const m of layout.matches) {
    drawConnector(root, m, m.topFrom, m.y - HALF_SPAN, basePaint);
    drawConnector(root, m, m.botFrom, m.y + HALF_SPAN, basePaint);
  }

  // ── Matches: boxes + badges + commentary ──
  for (const m of layout.matches) {
    const sidePaint =
      m.side && sideColorByLabel.get(m.side)
        ? paintFor(palette, isDark, sideColorByLabel.get(m.side))
        : basePaint;

    // Home: explicit `@ Name`, else higher seed (lower number) is home.
    const topSeed = seedByName.get(m.top ?? '') ?? null;
    const botSeed = seedByName.get(m.bot ?? '') ?? null;
    let homeName = m.home;
    if (!homeName && topSeed !== null && botSeed !== null) {
      homeName = topSeed <= botSeed ? m.top : m.bot;
    }

    const [wSeed, lSeed] =
      m.winner === 'top'
        ? [topSeed, botSeed]
        : m.winner === 'bot'
          ? [botSeed, topSeed]
          : [null, null];
    const isUpset =
      wSeed !== null && lSeed !== null && wSeed > lSeed && !m.isChampionship;

    const scoreParts = m.score
      ? m.score.split(/[-–]/).map((p) => p.trim())
      : null;
    const winScore = scoreParts?.length === 2 ? scoreParts[0]! : '';
    const loseScore = scoreParts?.length === 2 ? scoreParts[1]! : '';
    const champWinner = m.isChampionship ? layout.champion : null;

    const mkInfo = (side: 'top' | 'bot', name: string | null): BoxInfo => {
      const isWinner = m.winner === side;
      const isLoser = m.winner !== null && m.winner !== side;
      return {
        isWinner,
        isLoser,
        pending: m.pending,
        isChampion: champWinner !== null && isWinner,
        score: isWinner ? winScore : isLoser ? loseScore : '',
        seed: seedByName.get(name ?? '') ?? null,
        tagColor: tagColorOf(name),
        tagValue: tagValueOf(name),
        isHome: homeName !== null && homeName === name,
      };
    };

    drawBox(
      root,
      m.x,
      m.y - HALF_SPAN,
      m.top,
      mkInfo('top', m.top),
      sidePaint,
      palette,
      isDark,
      m,
      activeKey
    );
    drawBox(
      root,
      m.x,
      m.y + HALF_SPAN,
      m.bot,
      mkInfo('bot', m.bot),
      sidePaint,
      palette,
      isDark,
      m,
      activeKey
    );

    if (isUpset) drawUpset(root, m, sidePaint);
    if (m.commentary.length) drawCommentary(root, m, palette);
  }
}

function drawConnector(
  g: GSel,
  m: LaidMatch,
  from: ConnectorPoint | null,
  toCy: number,
  paint: Paint
): void {
  if (!from) return;
  const parentLeft = m.x - BOX_W / 2;
  const parentRight = m.x + BOX_W / 2;
  const childIsLeft = from.x < m.x;
  const childEdge = childIsLeft ? from.x + BOX_W / 2 : from.x - BOX_W / 2;
  const parentEdge = childIsLeft ? parentLeft : parentRight;
  const midX = (childEdge + parentEdge) / 2;
  // Undecided child (yA ≠ yB): a `]` merge — a stub from EACH contestant box to
  // a shared vertical, then out to the parent box. The vertical must also reach
  // `toCy` (the parent box), which usually sits OUTSIDE the child's own span, or
  // the parent stub floats disconnected.
  const vLo = Math.min(from.yA, from.yB, toCy);
  const vHi = Math.max(from.yA, from.yB, toCy);
  const d =
    from.yA !== from.yB
      ? `M ${childEdge} ${from.yA} H ${midX} M ${childEdge} ${from.yB} H ${midX} M ${midX} ${vLo} V ${vHi} M ${midX} ${toCy} H ${parentEdge}`
      : `M ${childEdge} ${from.y} H ${midX} V ${toCy} H ${parentEdge}`;
  g.append('path')
    .attr('d', d)
    .attr('fill', 'none')
    .attr('stroke', paint.wire)
    .attr('stroke-width', 1.5);
}

function drawBox(
  g: GSel,
  cx: number,
  cy: number,
  name: string | null,
  info: BoxInfo,
  sidePaint: Paint,
  palette: PaletteColors,
  isDark: boolean,
  m: LaidMatch,
  activeKey: string | null
): void {
  const x = cx - BOX_W / 2;
  const y = cy - BOX_H / 2;
  // A tagged competitor recolors the box accent (outline + tint); otherwise the
  // side/default accent. Fill intensity still encodes win/loss.
  const paint = info.tagColor
    ? paintForAccent(palette, isDark, info.tagColor)
    : sidePaint;

  const cell = g.append('g').attr('class', 'dgmo-bracket-box');
  if (m.lineNumber !== null) cell.attr('data-line-number', m.lineNumber);
  if (activeKey && info.tagValue)
    cell.attr(`data-tag-${activeKey}`, info.tagValue.toLowerCase());

  const isTBD = name === null;
  let fill = 'none';
  let stroke = paint.hair;
  let sw = 1.25;
  let dash: string | null = null;
  let textColor = paint.ink;
  let weight = 600;

  if (info.isChampion) {
    fill = paint.tint;
    stroke = paint.accent;
    sw = 3;
    weight = 800;
  } else if (isTBD) {
    fill = paint.track;
    dash = '4 4';
    textColor = paint.muted;
    weight = 500;
  } else if (info.isWinner) {
    fill = paint.tint;
    stroke = paint.accent;
    sw = 2;
    weight = 700;
  } else if (info.isLoser) {
    stroke = paint.hair;
    textColor = paint.muted;
    weight = 500;
  } else if (info.pending) {
    stroke = mix(paint.accent, paint.hair, 50);
  }

  const rect = cell
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', BOX_W)
    .attr('height', BOX_H)
    .attr('rx', 6)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', sw);
  if (dash) rect.attr('stroke-dasharray', dash);

  // Left gutter: seed badge (seeded mode).
  let leftPad = 11;
  if (info.seed !== null) {
    cell
      .append('text')
      .attr('x', x + 9)
      .attr('y', cy + 4)
      .attr('text-anchor', 'start')
      .attr('font-size', 10)
      .attr('font-weight', 700)
      .attr('fill', paint.muted)
      .text(info.seed);
    leftPad = 9 + Math.max(12, measureText(String(info.seed), 10)) + 6;
  }

  // Right gutter: home glyph then the score.
  let rightPad = 11;
  if (info.score) rightPad += 20;
  if (info.isHome) {
    drawHome(cell, x + BOX_W - rightPad - 6, cy, paint.muted);
    rightPad += 16;
  }

  cell
    .append('text')
    .attr('x', x + leftPad)
    .attr('y', cy + 4)
    .attr('text-anchor', 'start')
    .attr('font-size', 12.5)
    .attr('font-weight', weight)
    .attr('fill', textColor)
    .text(clip(isTBD ? 'TBD' : name!, BOX_W - leftPad - rightPad, 12.5));

  if (info.score) {
    cell
      .append('text')
      .attr('x', x + BOX_W - 11)
      .attr('y', cy + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', 12)
      .attr('font-weight', info.isWinner ? 700 : 500)
      .attr('fill', info.isWinner ? textColor : paint.muted)
      .text(info.score);
  }
}

/** A small house glyph centered at (hx, cy). */
function drawHome(cell: GSel, hx: number, cy: number, color: string): void {
  const s = 5;
  const yTop = cy - s - 1;
  const d = `M ${hx - s} ${cy - 1} L ${hx} ${yTop} L ${hx + s} ${cy - 1} L ${hx + s} ${cy + s} L ${hx - s} ${cy + s} Z`;
  cell
    .append('path')
    .attr('d', d)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 1.2)
    .attr('stroke-linejoin', 'round');
}

/** Small "UPSET" flag above the match's top box. */
function drawUpset(g: GSel, m: LaidMatch, paint: Paint): void {
  g.append('text')
    .attr('x', m.x + BOX_W / 2)
    .attr('y', m.y - HALF_SPAN - BOX_H / 2 - 4)
    .attr('text-anchor', 'end')
    .attr('font-size', 9)
    .attr('font-weight', 800)
    .attr('letter-spacing', 0.6)
    .attr('fill', paint.accent)
    .text('UPSET');
}

/** Prose commentary under the match's bottom box, word-wrapped to the column.
 *  Bullet lines get a hanging indent so wrapped continuations align with the
 *  text after the bullet, not under the bullet itself. */
function drawCommentary(g: GSel, m: LaidMatch, palette: PaletteColors): void {
  const x = m.x - BOX_W / 2 + 2;
  let y = m.y + HALF_SPAN + BOX_H / 2 + 13;
  const muted = mix(palette.text, palette.bg, 45);
  const bulletW = measureText('• ', 11);

  const emit = (line: string, lx: number): void => {
    const t = g
      .append('text')
      .attr('x', lx)
      .attr('y', y)
      .attr('text-anchor', 'start')
      .attr('font-size', 11)
      .attr('font-style', 'italic')
      .attr('fill', muted);
    renderInlineText(t, line, palette, 11);
    y += COMMENT_LH;
  };

  for (const raw of m.commentary) {
    const isBullet = raw.startsWith('• ');
    if (isBullet) {
      const body = raw.slice(2);
      wrapText(body, COMMENT_W - bulletW, 11).forEach((line, i) =>
        i === 0 ? emit(`• ${line}`, x) : emit(line, x + bulletW)
      );
    } else {
      for (const line of wrapText(raw, COMMENT_W, 11)) emit(line, x);
    }
  }
}

export function renderBracketForExport(
  container: HTMLDivElement,
  parsed: ParsedBracket,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderBracket(container, parsed, palette, isDark, exportDims);
}
