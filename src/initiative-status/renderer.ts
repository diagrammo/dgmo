// ============================================================
// Initiative Status Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import { runInExportContainer, extractExportSvg } from '../utils/export-container';
import {
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_PILL_FONT_W,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_FONT_W,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
} from '../utils/legend-constants';
import { contrastText, mix } from '../palettes/color-utils';
import type { TagGroup } from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import type { ParsedInitiativeStatus, InitiativeStatus } from './types';
import type { ParticipantType } from '../sequence/parser';
import type { ISLayoutResult } from './layout';
import { parseInitiativeStatus } from './parser';
import { layoutInitiativeStatus } from './layout';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const NODE_FONT_SIZE = 13;
const MIN_NODE_FONT_SIZE = 9;
const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 2;
const NODE_STROKE_WIDTH = 2;
const NODE_RX = 8;
const ARROWHEAD_W = 5;
const ARROWHEAD_H = 4;
const CHAR_WIDTH_RATIO = 0.6; // approx char width / font size for Helvetica
const NODE_TEXT_PADDING = 12; // horizontal padding inside node for text
const SERVICE_RX = 10;
const GROUP_EXTRA_PADDING = 8;
const GROUP_LABEL_FONT_SIZE = 11;
const COLLAPSE_BAR_HEIGHT = 6;

// ============================================================
// Color helpers
// ============================================================

function statusColor(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  switch (status) {
    case 'done': return palette.colors.green;
    case 'wip':  return palette.colors.yellow;
    case 'todo': return palette.colors.red;
    case 'na':   return isDark ? palette.colors.gray : '#2e3440';
    default:     return palette.textMuted;
  }
}

function nodeFill(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  const color = statusColor(status, palette, isDark);
  return mix(color, isDark ? palette.surface : palette.bg, 30);
}

function nodeStroke(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  return statusColor(status, palette, isDark);
}

function nodeTextColor(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  const fill = nodeFill(status, palette, isDark);
  return contrastText(fill, '#eceff4', '#2e3440');
}

function edgeStrokeColor(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  return statusColor(status, palette, isDark);
}

// ============================================================
// Legend helpers
// ============================================================

interface ISLegendEntry {
  label: string;
  statusKey: InitiativeStatus;
}

const IS_STATUS_LABELS: Record<string, string> = {
  done: 'Done',
  wip:  'In Progress',
  todo: 'To Do',
  na:   'N/A',
};

const IS_STATUS_ORDER: InitiativeStatus[] = ['todo', 'wip', 'done', 'na'];

function collectStatuses(parsed: ParsedInitiativeStatus): ISLegendEntry[] {
  const present = new Set<string>();
  for (const n of parsed.nodes) {
    if (n.status) present.add(n.status);
  }
  return IS_STATUS_ORDER
    .filter((s) => s !== null && present.has(s))
    .map((s) => ({ label: IS_STATUS_LABELS[s!], statusKey: s }));
}

const LEGEND_GROUP_NAME = 'Status';

function legendEntriesWidth(entries: ISLegendEntry[]): number {
  let w = 0;
  for (const e of entries) {
    w += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + e.label.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
  }
  return w;
}

// ============================================================
// Edge path generator
// ============================================================

// curveMonotoneX: interpolates through all control points and guarantees no
// Y-overshoot between consecutive points.  Works for both our 4-point elbows
// (adjacent-rank) and dagre's fixed waypoints (multi-rank).
const lineGenerator = d3Shape.line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveMonotoneX);

// ============================================================
// Text fitting — wrap or shrink to fit fixed-size nodes
// ============================================================

/**
 * Splits a word at camelCase boundaries.
 * "MyProVenue" → ["MyPro", "Venue"]
 * "HTMLParser" → ["HTML", "Parser"]
 * "getUserID" → ["get", "User", "ID"]
 */
function splitCamelCase(word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    const prev = word[i - 1];
    const curr = word[i];
    const next = i + 1 < word.length ? word[i + 1] : '';
    // aB → split before B (lowercase → uppercase)
    const lowerToUpper = prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z';
    // ABc → split before B when followed by lowercase (end of uppercase run)
    const upperRunEnd =
      prev >= 'A' && prev <= 'Z' && curr >= 'A' && curr <= 'Z' && next >= 'a' && next <= 'z';
    if (lowerToUpper || upperRunEnd) {
      parts.push(word.slice(start, i));
      start = i;
    }
  }
  parts.push(word.slice(start));
  return parts.length > 1 ? parts : [word];
}

interface FittedText {
  lines: string[];
  fontSize: number;
}

function fitTextToNode(label: string, nodeWidth: number, nodeHeight: number): FittedText {
  const maxTextWidth = nodeWidth - NODE_TEXT_PADDING * 2;
  const lineHeight = 1.3;

  // Try at full font size first, then shrink
  for (let fontSize = NODE_FONT_SIZE; fontSize >= MIN_NODE_FONT_SIZE; fontSize--) {
    const charWidth = fontSize * CHAR_WIDTH_RATIO;
    const maxCharsPerLine = Math.floor(maxTextWidth / charWidth);
    const maxLines = Math.floor((nodeHeight - 8) / (fontSize * lineHeight));

    if (maxCharsPerLine < 2 || maxLines < 1) continue;

    // If it fits on one line, done
    if (label.length <= maxCharsPerLine) {
      return { lines: [label], fontSize };
    }

    // Try word-wrapping
    const words = label.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (test.length <= maxCharsPerLine) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    // If all lines fit, check each line width
    if (lines.length <= maxLines && lines.every((l) => l.length <= maxCharsPerLine)) {
      return { lines, fontSize };
    }

    // Try splitting long words on camelCase boundaries and re-wrapping
    const camelWords: string[] = [];
    for (const word of words) {
      if (word.length > maxCharsPerLine) {
        camelWords.push(...splitCamelCase(word));
      } else {
        camelWords.push(word);
      }
    }

    const camelLines: string[] = [];
    let camelCurrent = '';
    for (const word of camelWords) {
      const test = camelCurrent ? `${camelCurrent} ${word}` : word;
      if (test.length <= maxCharsPerLine) {
        camelCurrent = test;
      } else {
        if (camelCurrent) camelLines.push(camelCurrent);
        camelCurrent = word;
      }
    }
    if (camelCurrent) camelLines.push(camelCurrent);

    if (camelLines.length <= maxLines && camelLines.every((l) => l.length <= maxCharsPerLine)) {
      return { lines: camelLines, fontSize };
    }

    // If not at minimum font size yet, try shrinking before hard-breaking
    if (fontSize > MIN_NODE_FONT_SIZE) continue;

    // At minimum font size — hard-break as last resort
    const hardLines: string[] = [];
    for (const line of camelLines) {
      if (line.length <= maxCharsPerLine) {
        hardLines.push(line);
      } else {
        for (let i = 0; i < line.length; i += maxCharsPerLine) {
          hardLines.push(line.slice(i, i + maxCharsPerLine));
        }
      }
    }

    if (hardLines.length <= maxLines) {
      return { lines: hardLines, fontSize };
    }
  }

  // Last resort: smallest font, truncate with ellipsis
  const charWidth = MIN_NODE_FONT_SIZE * CHAR_WIDTH_RATIO;
  const maxChars = Math.floor((nodeWidth - NODE_TEXT_PADDING * 2) / charWidth);
  const truncated = label.length > maxChars ? label.slice(0, maxChars - 1) + '\u2026' : label;
  return { lines: [truncated], fontSize: MIN_NODE_FONT_SIZE };
}

// ============================================================
// Shape renderers — each draws within a centered (0,0) coordinate system
// ============================================================

type D3G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

/** Default rectangle */
function renderShapeRect(g: D3G, w: number, h: number, f: string, s: string): void {
  g.append('rect')
    .attr('x', -w / 2).attr('y', -h / 2)
    .attr('width', w).attr('height', h)
    .attr('rx', NODE_RX).attr('ry', NODE_RX)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
}

/** Service — more rounded rectangle */
function renderShapeService(g: D3G, w: number, h: number, f: string, s: string): void {
  g.append('rect')
    .attr('x', -w / 2).attr('y', -h / 2)
    .attr('width', w).attr('height', h)
    .attr('rx', SERVICE_RX).attr('ry', SERVICE_RX)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
}

/** Actor — stick figure (no fill box) */
function renderShapeActor(g: D3G, w: number, h: number, s: string): void {
  // Stick figure centered in top ~70% of the box, label goes below
  const figH = h * 0.65;
  const topY = -h / 2;
  const headR = Math.min(figH * 0.22, w * 0.12);
  const headY = topY + headR + 2;
  const bodyTopY = headY + headR + 1;
  const bodyBottomY = topY + figH * 0.75;
  const legY = topY + figH;
  const armSpan = Math.min(16, w * 0.18);
  const legSpan = Math.min(12, w * 0.14);
  const sw = 2.5;

  g.append('circle')
    .attr('cx', 0).attr('cy', headY).attr('r', headR)
    .attr('fill', 'none').attr('stroke', s).attr('stroke-width', sw);
  g.append('line')
    .attr('x1', 0).attr('y1', bodyTopY).attr('x2', 0).attr('y2', bodyBottomY)
    .attr('stroke', s).attr('stroke-width', sw);
  g.append('line')
    .attr('x1', -armSpan).attr('y1', bodyTopY + 4).attr('x2', armSpan).attr('y2', bodyTopY + 4)
    .attr('stroke', s).attr('stroke-width', sw);
  g.append('line')
    .attr('x1', 0).attr('y1', bodyBottomY).attr('x2', -legSpan).attr('y2', legY)
    .attr('stroke', s).attr('stroke-width', sw);
  g.append('line')
    .attr('x1', 0).attr('y1', bodyBottomY).attr('x2', legSpan).attr('y2', legY)
    .attr('stroke', s).attr('stroke-width', sw);
}

/** Database — vertical cylinder */
function renderShapeDatabase(g: D3G, w: number, h: number, f: string, s: string): void {
  const ry = 7;
  const topY = -h / 2 + ry;
  const bodyH = h - ry * 2;

  // Bottom ellipse
  g.append('ellipse')
    .attr('cx', 0).attr('cy', topY + bodyH).attr('rx', w / 2).attr('ry', ry)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
  // Body (covers bottom ellipse top arc)
  g.append('rect')
    .attr('x', -w / 2).attr('y', topY).attr('width', w).attr('height', bodyH)
    .attr('fill', f).attr('stroke', 'none');
  // Side lines
  g.append('line')
    .attr('x1', -w / 2).attr('y1', topY).attr('x2', -w / 2).attr('y2', topY + bodyH)
    .attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('line')
    .attr('x1', w / 2).attr('y1', topY).attr('x2', w / 2).attr('y2', topY + bodyH)
    .attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
  // Top ellipse cap
  g.append('ellipse')
    .attr('cx', 0).attr('cy', topY).attr('rx', w / 2).attr('ry', ry)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
}

/** Queue — horizontal cylinder (pipe) */
function renderShapeQueue(g: D3G, w: number, h: number, f: string, s: string): void {
  const rx = 10;
  const leftX = -w / 2 + rx;
  const bodyW = w - rx * 2;

  // Right ellipse (back)
  g.append('ellipse')
    .attr('cx', leftX + bodyW).attr('cy', 0).attr('rx', rx).attr('ry', h / 2)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
  // Body
  g.append('rect')
    .attr('x', leftX).attr('y', -h / 2).attr('width', bodyW).attr('height', h)
    .attr('fill', f).attr('stroke', 'none');
  // Top and bottom lines
  g.append('line')
    .attr('x1', leftX).attr('y1', -h / 2).attr('x2', leftX + bodyW).attr('y2', -h / 2)
    .attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('line')
    .attr('x1', leftX).attr('y1', h / 2).attr('x2', leftX + bodyW).attr('y2', h / 2)
    .attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
  // Left ellipse (front)
  g.append('ellipse')
    .attr('cx', leftX).attr('cy', 0).attr('rx', rx).attr('ry', h / 2)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
}

/** Cache — dashed cylinder */
function renderShapeCache(g: D3G, w: number, h: number, f: string, s: string): void {
  const ry = 7;
  const topY = -h / 2 + ry;
  const bodyH = h - ry * 2;
  const dash = '4 3';

  g.append('ellipse')
    .attr('cx', 0).attr('cy', topY + bodyH).attr('rx', w / 2).attr('ry', ry)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH).attr('stroke-dasharray', dash);
  g.append('rect')
    .attr('x', -w / 2).attr('y', topY).attr('width', w).attr('height', bodyH)
    .attr('fill', f).attr('stroke', 'none');
  g.append('line')
    .attr('x1', -w / 2).attr('y1', topY).attr('x2', -w / 2).attr('y2', topY + bodyH)
    .attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH).attr('stroke-dasharray', dash);
  g.append('line')
    .attr('x1', w / 2).attr('y1', topY).attr('x2', w / 2).attr('y2', topY + bodyH)
    .attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH).attr('stroke-dasharray', dash);
  g.append('ellipse')
    .attr('cx', 0).attr('cy', topY).attr('rx', w / 2).attr('ry', ry)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH).attr('stroke-dasharray', dash);
}

/** Networking — hexagon */
function renderShapeNetworking(g: D3G, w: number, h: number, f: string, s: string): void {
  const inset = 16;
  const points = [
    `${-w / 2 + inset},${-h / 2}`,
    `${w / 2 - inset},${-h / 2}`,
    `${w / 2},0`,
    `${w / 2 - inset},${h / 2}`,
    `${-w / 2 + inset},${h / 2}`,
    `${-w / 2},0`,
  ].join(' ');
  g.append('polygon')
    .attr('points', points)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
}

/** Frontend — monitor with stand */
function renderShapeFrontend(g: D3G, w: number, h: number, f: string, s: string): void {
  const screenH = h - 10;
  // Screen
  g.append('rect')
    .attr('x', -w / 2).attr('y', -h / 2).attr('width', w).attr('height', screenH)
    .attr('rx', 3).attr('ry', 3)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
  // Stand
  g.append('line')
    .attr('x1', 0).attr('y1', -h / 2 + screenH).attr('x2', 0).attr('y2', h / 2 - 2)
    .attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
  // Base
  g.append('line')
    .attr('x1', -14).attr('y1', h / 2 - 2).attr('x2', 14).attr('y2', h / 2 - 2)
    .attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH);
}

/** External — dashed rectangle */
function renderShapeExternal(g: D3G, w: number, h: number, f: string, s: string): void {
  g.append('rect')
    .attr('x', -w / 2).attr('y', -h / 2)
    .attr('width', w).attr('height', h)
    .attr('rx', NODE_RX).attr('ry', NODE_RX)
    .attr('fill', f).attr('stroke', s).attr('stroke-width', NODE_STROKE_WIDTH)
    .attr('stroke-dasharray', '6 3');
}

/** Dispatch to the right shape renderer */
function renderNodeShape(
  g: D3G,
  shape: ParticipantType,
  w: number,
  h: number,
  fillColor: string,
  strokeColor: string
): void {
  switch (shape) {
    case 'actor':      renderShapeActor(g, w, h, strokeColor); break;
    case 'database':   renderShapeDatabase(g, w, h, fillColor, strokeColor); break;
    case 'queue':      renderShapeQueue(g, w, h, fillColor, strokeColor); break;
    case 'cache':      renderShapeCache(g, w, h, fillColor, strokeColor); break;
    case 'networking': renderShapeNetworking(g, w, h, fillColor, strokeColor); break;
    case 'frontend':   renderShapeFrontend(g, w, h, fillColor, strokeColor); break;
    case 'external':   renderShapeExternal(g, w, h, fillColor, strokeColor); break;
    case 'service':    renderShapeService(g, w, h, fillColor, strokeColor); break;
    default:           renderShapeRect(g, w, h, fillColor, strokeColor); break;
  }
}

// ============================================================
// Main renderer
// ============================================================

export interface ISRenderOptions {
  onClickItem?: (lineNumber: number) => void;
  exportDims?: { width?: number; height?: number };
  legendActive?: boolean | null;
  activeTagGroup?: string | null;
  hiddenTagValues?: Map<string, Set<string>>;
  tagGroups?: TagGroup[];
}

export function renderInitiativeStatus(
  container: HTMLDivElement,
  parsed: ParsedInitiativeStatus,
  layout: ISLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  options?: ISRenderOptions
): void {
  const {
    onClickItem,
    exportDims,
    legendActive,
    activeTagGroup,
    hiddenTagValues,
    tagGroups,
  } = options ?? {};
  // Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const legendEntries = collectStatuses(parsed);
  const hasLegend = legendEntries.length > 1;
  const isLegendExpanded = legendActive !== false;

  const effectiveTagGroups = tagGroups ?? parsed.tagGroups ?? [];
  const hasTagGroups = effectiveTagGroups.length > 0;

  const titleHeight = parsed.title ? 40 : 0;
  const LEGEND_FIXED_GAP = 8;
  const legendReserve = (hasLegend || hasTagGroups) ? LEGEND_HEIGHT + LEGEND_FIXED_GAP : 0;

  // Scale to fit
  const diagramW = layout.width;
  const diagramH = layout.height;
  const availH = height - titleHeight - legendReserve;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + legendReserve + DIAGRAM_PADDING;

  // Create SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // Defs: arrowhead markers per status color
  const defs = svg.append('defs');
  const markerColors = new Set<string>();
  for (const edge of layout.edges) {
    markerColors.add(edgeStrokeColor(edge.status, palette, isDark));
  }
  // Default marker
  markerColors.add(palette.textMuted);

  for (const color of markerColors) {
    const id = `is-arrow-${color.replace('#', '')}`;
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
      .attr('refX', ARROWHEAD_W)
      .attr('refY', ARROWHEAD_H / 2)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
      .attr('fill', color);
  }

  // Title
  if (parsed.title) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', '20px')
      .attr('font-weight', '700')
      .style('cursor', onClickItem && parsed.titleLineNumber ? 'pointer' : 'default')
      .text(parsed.title);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
      if (onClickItem) {
        titleEl
          .on('click', () => onClickItem(parsed.titleLineNumber!))
          .on('mouseenter', function () { d3Selection.select(this).attr('opacity', 0.7); })
          .on('mouseleave', function () { d3Selection.select(this).attr('opacity', 1); });
      }
    }
  }

  // ── Legend ──
  if (hasLegend || hasTagGroups) {
    const groupBg = isDark
      ? mix(palette.surface, palette.bg, 50)
      : mix(palette.surface, palette.bg, 30);

    // Build legend groups: Status + tag groups
    interface LegendGroup {
      name: string;
      key: string; // lowercase key for data attribute
      isStatus: boolean;
      entries: { label: string; color: string; value: string }[];
      width: number; // total width when expanded
    }

    const legendGroups: LegendGroup[] = [];

    // Status group (always first if entries exist)
    if (hasLegend) {
      const statusEntries = legendEntries.map((e) => ({
        label: e.label,
        color: statusColor(e.statusKey, palette, isDark),
        value: e.statusKey ?? 'na',
      }));
      const pillW = LEGEND_GROUP_NAME.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
      const entrW = legendEntriesWidth(legendEntries);
      legendGroups.push({
        name: LEGEND_GROUP_NAME,
        key: 'status',
        isStatus: true,
        entries: statusEntries,
        width: LEGEND_CAPSULE_PAD * 2 + pillW + LEGEND_ENTRY_TRAIL + entrW,
      });
    }

    // Tag groups
    for (const tg of effectiveTagGroups) {
      const entries = tg.entries.map((e) => ({
        label: e.value,
        color: e.color || palette.textMuted,
        value: e.value.toLowerCase(),
      }));
      const pillW = tg.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
      let entrW = 0;
      for (const e of entries) {
        entrW += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + e.label.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
      }
      legendGroups.push({
        name: tg.name,
        key: tg.name.toLowerCase(),
        isStatus: false,
        entries,
        width: LEGEND_CAPSULE_PAD * 2 + pillW + 4 + entrW,
      });
    }

    // Determine which group is active/expanded
    const activeKey = activeTagGroup?.toLowerCase() ?? null;
    const isStatusExpanded = isLegendExpanded && activeKey === null;

    // When a tag group is active, only show that group (mutual exclusion).
    // When no tag group is active, show all pills (Status expanded + tag pills minified).
    const visibleLegendGroups = activeKey !== null
      ? legendGroups.filter((lg) => !lg.isStatus && lg.key === activeKey)
      : legendGroups;

    // Compute total legend width
    let totalLegendW = 0;
    for (const lg of visibleLegendGroups) {
      const isActive = lg.isStatus ? isStatusExpanded : (activeKey === lg.key);
      const pillW = lg.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
      totalLegendW += isActive ? lg.width : pillW;
      totalLegendW += LEGEND_GROUP_GAP;
    }
    totalLegendW -= LEGEND_GROUP_GAP; // remove trailing gap

    const legendX = (width - totalLegendW) / 2;
    const legendY = titleHeight;

    const legendRow = svg
      .append('g')
      .attr('class', 'is-legend-row')
      .attr('transform', `translate(${legendX}, ${legendY})`);

    let cursorX = 0;

    for (const lg of visibleLegendGroups) {
      const isActive = lg.isStatus ? isStatusExpanded : (activeKey === lg.key);
      const pillW = lg.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
      const pillH = LEGEND_HEIGHT - (isActive ? LEGEND_CAPSULE_PAD * 2 : 0);
      const groupW = isActive ? lg.width : pillW;

      const gEl = legendRow
        .append('g')
        .attr('transform', `translate(${cursorX}, 0)`)
        .attr('class', 'is-legend-group')
        .attr('data-legend-group', lg.key)
        .style('cursor', 'pointer');

      if (isActive) {
        // Outer capsule background
        gEl.append('rect')
          .attr('width', groupW)
          .attr('height', LEGEND_HEIGHT)
          .attr('rx', LEGEND_HEIGHT / 2)
          .attr('fill', groupBg);
      }

      const pillXOff = isActive ? LEGEND_CAPSULE_PAD : 0;
      const pillYOff = isActive ? LEGEND_CAPSULE_PAD : 0;

      // Pill background
      gEl.append('rect')
        .attr('x', pillXOff)
        .attr('y', pillYOff)
        .attr('width', pillW)
        .attr('height', pillH)
        .attr('rx', pillH / 2)
        .attr('fill', isActive ? palette.bg : groupBg);

      // Active pill border
      if (isActive) {
        gEl.append('rect')
          .attr('x', pillXOff)
          .attr('y', pillYOff)
          .attr('width', pillW)
          .attr('height', pillH)
          .attr('rx', pillH / 2)
          .attr('fill', 'none')
          .attr('stroke', mix(palette.textMuted, palette.bg, 50))
          .attr('stroke-width', 0.75);
      }

      // Pill text
      gEl.append('text')
        .attr('x', pillXOff + pillW / 2)
        .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
        .attr('font-size', LEGEND_PILL_FONT_SIZE)
        .attr('font-weight', '500')
        .attr('fill', isActive ? palette.text : palette.textMuted)
        .attr('text-anchor', 'middle')
        .attr('font-family', FONT_FAMILY)
        .text(lg.name);

      // Entries inside capsule (active only)
      if (isActive) {
        // Determine which values are hidden for this group
        const hiddenSet = !lg.isStatus ? hiddenTagValues?.get(lg.key) : undefined;

        let entryX = pillXOff + pillW + 4;
        for (const entry of lg.entries) {
          const isHidden = hiddenSet?.has(entry.value) ?? false;

          const entryG = gEl.append('g')
            .attr('data-legend-entry', entry.value)
            .style('cursor', !lg.isStatus ? 'pointer' : 'default');

          if (isHidden) {
            // Hidden: hollow ring + dimmed text (strikethrough-like)
            entryG.append('circle')
              .attr('cx', entryX + LEGEND_DOT_R)
              .attr('cy', LEGEND_HEIGHT / 2)
              .attr('r', LEGEND_DOT_R)
              .attr('fill', 'none')
              .attr('stroke', entry.color)
              .attr('stroke-width', 1.2)
              .attr('opacity', 0.5);
          } else {
            // Visible: solid dot
            entryG.append('circle')
              .attr('cx', entryX + LEGEND_DOT_R)
              .attr('cy', LEGEND_HEIGHT / 2)
              .attr('r', LEGEND_DOT_R)
              .attr('fill', entry.color);
          }

          entryG.append('text')
            .attr('x', entryX + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP)
            .attr('y', LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1)
            .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
            .attr('fill', palette.textMuted)
            .attr('font-family', FONT_FAMILY)
            .attr('opacity', isHidden ? 0.4 : 1)
            .attr('text-decoration', isHidden ? 'line-through' : 'none')
            .text(entry.label);

          entryX += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + entry.label.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
        }
      }

      cursorX += groupW + LEGEND_GROUP_GAP;
    }

  }

  // Content group
  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // Helper: interpolate a point at parameter t (0–1) along a polyline
  function interpolatePolyline(
    pts: { x: number; y: number }[],
    t: number
  ): { x: number; y: number } {
    if (pts.length < 2) return pts[0];
    // Compute cumulative segment lengths
    const segLens: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      segLens.push(d);
      total += d;
    }
    const target = t * total;
    let accum = 0;
    for (let i = 0; i < segLens.length; i++) {
      if (accum + segLens[i] >= target) {
        const frac = segLens[i] > 0 ? (target - accum) / segLens[i] : 0;
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * frac,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * frac,
        };
      }
      accum += segLens[i];
    }
    return pts[pts.length - 1];
  }

  // Compute label positions — place each label ON its own edge path.
  // Start at t=0.5 (midpoint). If two labels overlap, slide them apart
  // along their respective paths.
  interface LabelPlacement {
    x: number;
    y: number;
    w: number;
    h: number;
    edgeIdx: number;
    t: number; // parameter along path
    points: { x: number; y: number }[];
  }
  const labelPlacements: LabelPlacement[] = [];

  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei];
    if (!edge.label || edge.points.length < 2) continue;

    const t = 0.5;
    const pt = interpolatePolyline(edge.points, t);
    const labelLen = edge.label.length;
    const bgW = labelLen * 7 + 10;
    const bgH = 18;

    labelPlacements.push({
      x: pt.x,
      y: pt.y,
      w: bgW,
      h: bgH,
      edgeIdx: ei,
      t,
      points: edge.points,
    });
  }

  // Resolve overlaps by sliding labels along their own paths
  const MIN_LABEL_GAP = 6;
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < labelPlacements.length; i++) {
      for (let j = i + 1; j < labelPlacements.length; j++) {
        const a = labelPlacements[i];
        const b = labelPlacements[j];
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2 + MIN_LABEL_GAP;
        const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2 + MIN_LABEL_GAP;
        if (overlapX && overlapY) {
          // Slide each label along its own path in opposite directions
          const step = 0.08;
          a.t = Math.max(0.15, a.t - step);
          b.t = Math.min(0.85, b.t + step);
          const ptA = interpolatePolyline(a.points, a.t);
          const ptB = interpolatePolyline(b.points, b.t);
          a.x = ptA.x;
          a.y = ptA.y;
          b.x = ptB.x;
          b.y = ptB.y;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // Build lookup from edge index to label placement
  const labelMap = new Map<number, LabelPlacement>();
  for (const lp of labelPlacements) labelMap.set(lp.edgeIdx, lp);

  // Render groups (background layer, before edges and nodes)
  for (const group of layout.groups) {
    if (group.collapsed) {
      // ── Collapsed: node-like box (same fill/stroke as nodes) + drill-bar ──
      const fillCol = nodeFill(group.status, palette, isDark);
      const strokeCol = nodeStroke(group.status, palette, isDark);
      const textCol = nodeTextColor(group.status, palette, isDark);
      const clipId = `clip-group-${group.lineNumber}`;

      const groupG = contentG
        .append('g')
        .attr('class', 'is-group is-group-collapsed')
        .attr('data-line-number', String(group.lineNumber))
        .attr('data-group-toggle', group.label)
        .style('cursor', 'pointer');

      // Clip path for drill-bar rounded corners
      groupG.append('clipPath').attr('id', clipId)
        .append('rect')
        .attr('x', group.x).attr('y', group.y)
        .attr('width', group.width).attr('height', group.height)
        .attr('rx', NODE_RX);

      // Main box
      groupG.append('rect')
        .attr('x', group.x).attr('y', group.y)
        .attr('width', group.width).attr('height', group.height)
        .attr('rx', NODE_RX)
        .attr('fill', fillCol)
        .attr('stroke', strokeCol)
        .attr('stroke-width', NODE_STROKE_WIDTH);

      // Drill-bar (6px bottom stripe, clipped to rounded corners)
      groupG.append('rect')
        .attr('x', group.x)
        .attr('y', group.y + group.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', group.width)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', strokeCol)
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'is-collapse-bar');

      // Label centered (above drill-bar)
      groupG.append('text')
        .attr('x', group.x + group.width / 2)
        .attr('y', group.y + group.height / 2 - COLLAPSE_BAR_HEIGHT / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textCol)
        .attr('font-size', NODE_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('font-family', FONT_FAMILY)
        .text(group.label);

    } else {
      // ── Expanded: neutral background (no status color bleed) ──
      if (group.width === 0 && group.height === 0) continue;
      const gx = group.x - GROUP_EXTRA_PADDING;
      const gy = group.y - GROUP_EXTRA_PADDING - GROUP_LABEL_FONT_SIZE - 4;
      const gw = group.width + GROUP_EXTRA_PADDING * 2;
      const gh = group.height + GROUP_EXTRA_PADDING * 2 + GROUP_LABEL_FONT_SIZE + 4;

      const fillColor = isDark ? palette.surface : palette.bg;
      const strokeColor = palette.textMuted;

      const groupG = contentG
        .append('g')
        .attr('class', 'is-group')
        .attr('data-line-number', String(group.lineNumber))
        .attr('data-group-toggle', group.label)
        .style('cursor', 'pointer');

      groupG
        .append('rect')
        .attr('x', gx)
        .attr('y', gy)
        .attr('width', gw)
        .attr('height', gh)
        .attr('rx', 6)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-opacity', 0.5);

      groupG
        .append('text')
        .attr('x', gx + 8)
        .attr('y', gy + GROUP_LABEL_FONT_SIZE + 4)
        .attr('fill', strokeColor)
        .attr('font-size', GROUP_LABEL_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('opacity', 0.7)
        .attr('class', 'is-group-label')
        .text(group.label);

    }
  }

  // Render edges (below nodes)
  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei];
    if (edge.points.length < 2) continue;
    const edgeColor = edgeStrokeColor(edge.status, palette, isDark);
    const markerId = `is-arrow-${edgeColor.replace('#', '')}`;

    const edgeG = contentG
      .append('g')
      .attr('class', 'is-edge-group')
      .attr('data-line-number', String(edge.lineNumber));

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      // Transparent wide hit area behind the visible edge
      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', Math.max(6, Math.round(16 / (edge.parallelCount ?? 1))));

      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', EDGE_STROKE_WIDTH)
        .attr('marker-end', `url(#${markerId})`)
        .attr('class', 'is-edge');
    }

    // Edge label placed on its own path
    const lp = labelMap.get(ei);
    if (edge.label && lp) {
      edgeG
        .append('rect')
        .attr('x', lp.x - lp.w / 2)
        .attr('y', lp.y - lp.h / 2 - 1)
        .attr('width', lp.w)
        .attr('height', lp.h)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.9)
        .attr('class', 'is-edge-label-bg');

      edgeG
        .append('text')
        .attr('x', lp.x)
        .attr('y', lp.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', EDGE_LABEL_FONT_SIZE)
        .attr('class', 'is-edge-label')
        .text(edge.label);
    }

    if (onClickItem) {
      edgeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(edge.lineNumber);
      });
    }
  }

  // Render nodes (top layer)
  for (const node of layout.nodes) {
    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'is-node')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-is-status', node.status ?? 'na');

    // Tag data attributes for hover dimming
    if (node.metadata) {
      for (const [key, val] of Object.entries(node.metadata)) {
        nodeG.attr(`data-tag-${key}`, val.toLowerCase());
      }
    }

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    // Transparent hit-area rect — ensures the full bounding box captures
    // clicks for shapes with gaps (actors, frontends, databases, etc.)
    nodeG
      .append('rect')
      .attr('x', -node.width / 2)
      .attr('y', -node.height / 2)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', 'transparent')
      .attr('class', 'is-node-hit-area');

    // Always use status coloring regardless of legend state
    const fill = nodeFill(node.status, palette, isDark);
    const stroke = nodeStroke(node.status, palette, isDark);
    renderNodeShape(nodeG, node.shape, node.width, node.height, fill, stroke);

    const textColor = contrastText(fill, '#eceff4', '#2e3440');

    // Label placement: actors put label below the figure, others center inside
    const isActor = node.shape === 'actor';
    if (isActor) {
      const fitted = fitTextToNode(node.label, node.width, node.height * 0.35);
      const labelY = node.height / 2 - fitted.fontSize * 0.3;
      for (let li = 0; li < fitted.lines.length; li++) {
        nodeG
          .append('text')
          .attr('x', 0)
          .attr('y', labelY + li * fitted.fontSize * 1.3)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', textColor)
          .attr('font-size', fitted.fontSize)
          .attr('font-weight', '600')
          .text(fitted.lines[li]);
      }
    } else {
      const fitted = fitTextToNode(node.label, node.width, node.height);
      const totalTextHeight = fitted.lines.length * fitted.fontSize * 1.3;
      const startY = -totalTextHeight / 2 + fitted.fontSize * 0.65;

      for (let li = 0; li < fitted.lines.length; li++) {
        nodeG
          .append('text')
          .attr('x', 0)
          .attr('y', startY + li * fitted.fontSize * 1.3)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', textColor)
          .attr('font-size', fitted.fontSize)
          .attr('font-weight', '600')
          .text(fitted.lines[li]);
      }
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderInitiativeStatusForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseInitiativeStatus(content);
  if (parsed.error || parsed.nodes.length === 0) return '';

  const layout = layoutInitiativeStatus(parsed);
  const isDark = theme === 'dark';

  const legendEntries = collectStatuses(parsed);
  const EXPORT_LEGEND_GAP = 8;
  const legendReserve = legendEntries.length > 1 ? LEGEND_HEIGHT + EXPORT_LEGEND_GAP : 0;
  const titleOffset = parsed.title ? 40 : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleOffset + legendReserve;

  return runInExportContainer(exportWidth, exportHeight, (container) => {
    renderInitiativeStatus(
      container,
      parsed,
      layout,
      palette,
      isDark,
      { exportDims: { width: exportWidth, height: exportHeight } }
    );
    return extractExportSvg(container, theme);
  });
}
