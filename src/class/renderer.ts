// ============================================================
// Class Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { fillModeFromOptions, legendSuppressed } from '../utils/parsing';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import {
  runInExportContainer,
  extractExportSvg,
} from '../utils/export-container';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import type { PaletteColors } from '../palettes';
import { contrastText, shapeFill } from '../palettes/color-utils';
import type {
  ParsedClassDiagram,
  ClassModifier,
  RelationshipType,
} from './types';
import type { ClassLayoutResult } from './layout';
import { parseClassDiagram } from './parser';
import { layoutClassDiagram } from './layout';
import { ScaleContext } from '../utils/scaling';
import { measureText } from '../utils/text-measure';
import {
  renderNoteBox,
  renderNoteConnector,
  renderNoteBadge,
  noteConnectorPoints,
  NOTE_BADGE_RADIUS,
} from '../utils/note-box';

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const CLASS_FONT_SIZE = 13;
const MEMBER_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 11;
import {
  EDGE_STROKE_WIDTH,
  NODE_STROKE_WIDTH,
} from '../utils/visual-conventions'; // shared (Story 111.1)
const MEMBER_LINE_HEIGHT = 18;
const COMPARTMENT_PADDING_Y = 8;
const MEMBER_PADDING_X = 10;

// ============================================================
// Color helpers
// ============================================================

function modifierColor(
  modifier: ClassModifier | undefined,
  palette: PaletteColors,
  colorOff?: boolean
): string {
  if (colorOff) return palette.textMuted;
  switch (modifier) {
    case 'interface':
      return palette.colors.blue;
    case 'abstract':
      return palette.colors.purple;
    case 'enum':
      return palette.colors.yellow;
    default:
      return palette.colors.teal;
  }
}

function nodeFill(
  palette: PaletteColors,
  isDark: boolean,
  modifier: ClassModifier | undefined,
  nodeColor?: string,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline'
): string {
  const color = nodeColor ?? modifierColor(modifier, palette, colorOff);
  return shapeFill(palette, color, isDark, { mode: fillMode });
}

function nodeStroke(
  palette: PaletteColors,
  modifier: ClassModifier | undefined,
  nodeColor?: string,
  colorOff?: boolean
): string {
  return nodeColor ?? modifierColor(modifier, palette, colorOff);
}

// ============================================================
// Legend helpers
// ============================================================

interface ClassLegendEntry {
  label: string;
  colorKey: keyof PaletteColors['colors'];
}

const CLASS_TYPE_MAP: Record<string, ClassLegendEntry> = {
  class: { label: 'Class', colorKey: 'teal' },
  abstract: { label: 'Abstract', colorKey: 'purple' },
  interface: { label: 'Interface', colorKey: 'blue' },
  enum: { label: 'Enum', colorKey: 'yellow' },
};

const CLASS_TYPE_ORDER = ['class', 'abstract', 'interface', 'enum'];

function collectClassTypes(parsed: ParsedClassDiagram): ClassLegendEntry[] {
  if (parsed.options?.['no-auto-color']) return [];

  const present = new Set<string>();
  for (const c of parsed.classes) {
    if (c.color) continue; // explicit color override — skip
    present.add(c.modifier ?? 'class');
  }
  // CLASS_TYPE_ORDER keys are all present in CLASS_TYPE_MAP by construction.
  return CLASS_TYPE_ORDER.filter((k) => present.has(k)).map(
    (k) => CLASS_TYPE_MAP[k]!
  );
}

const LEGEND_GROUP_NAME = 'Type';

// legendEntriesWidth removed — centralized legend handles sizing

function classTypeKey(modifier: ClassModifier | undefined): string {
  return modifier ?? 'class';
}

// ============================================================
// Visibility symbols
// ============================================================

function visibilitySymbol(vis: 'public' | 'private' | 'protected'): string {
  switch (vis) {
    case 'public':
      return '+';
    case 'private':
      return '-';
    case 'protected':
      return '#';
  }
}

// ============================================================
// Edge path generator
// ============================================================

const lineGenerator = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

// ============================================================
// Edge line style
// ============================================================

function isDashedEdge(type: RelationshipType): boolean {
  return type === 'implements' || type === 'depends';
}

function markerIdForType(type: RelationshipType): string {
  switch (type) {
    case 'extends':
      return 'cd-arrow-inherit';
    case 'implements':
      return 'cd-arrow-implement';
    case 'composes':
      return 'cd-arrow-compose';
    case 'aggregates':
      return 'cd-arrow-aggregate';
    case 'depends':
      return 'cd-arrow-depend';
    case 'associates':
      return 'cd-arrow-assoc';
  }
}

// Where to place marker — source-end for compose/aggregate, target-end for others
function isSourceMarker(type: RelationshipType): boolean {
  return type === 'composes' || type === 'aggregates';
}

// ============================================================
// Main renderer
// ============================================================

export function renderClassDiagram(
  container: HTMLDivElement,
  parsed: ParsedClassDiagram,
  layout: ClassLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number },
  legendActive?: boolean | null,
  exportMode?: boolean
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const ctx = ScaleContext.identity();

  const sDiagramPadding = ctx.aesthetic(DIAGRAM_PADDING);
  const sClassFontSize = ctx.text(CLASS_FONT_SIZE);
  const sMemberFontSize = ctx.text(MEMBER_FONT_SIZE);
  const sEdgeLabelFontSize = ctx.text(EDGE_LABEL_FONT_SIZE);
  const sEdgeStrokeWidth = ctx.structural(EDGE_STROKE_WIDTH);
  const sNodeStrokeWidth = ctx.structural(NODE_STROKE_WIDTH);
  const sMemberLineHeight = ctx.structural(MEMBER_LINE_HEIGHT);
  const sCompartmentPaddingY = ctx.structural(COMPARTMENT_PADDING_Y);
  const sMemberPaddingX = ctx.structural(MEMBER_PADDING_X);
  const sTitleFontSize = ctx.text(TITLE_FONT_SIZE);
  const sTitleY = ctx.structural(TITLE_Y);
  const sLegendHeight = ctx.structural(LEGEND_HEIGHT);

  const legendEntries = collectClassTypes(parsed);
  const hasLegend =
    legendEntries.length > 1 && !legendSuppressed(parsed.options);

  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const titleHeight = showTitle ? 40 : 0;
  const LEGEND_FIXED_GAP = 8;
  const sLegendFixedGap = ctx.aesthetic(LEGEND_FIXED_GAP);
  const legendReserve = hasLegend ? sLegendHeight + sLegendFixedGap : 0;
  const diagramW = layout.width;
  const diagramH = layout.height;
  const availH = height - titleHeight - legendReserve;
  const scaleX = (width - sDiagramPadding * 2) / diagramW;
  const scaleY = (availH - sDiagramPadding * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + legendReserve + sDiagramPadding;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  // ── Marker defs ──
  const defs = svg.append('defs');
  const AW = 12; // arrowhead width
  const AH = 8; // arrowhead height

  // Filled triangle (inheritance) — filled with stroke color
  defs
    .append('marker')
    .attr('id', 'cd-arrow-inherit')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW)
    .attr('refY', AH / 2)
    .attr('markerWidth', AW)
    .attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', palette.textMuted)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1);

  // Hollow triangle (implementation) — white/bg fill
  defs
    .append('marker')
    .attr('id', 'cd-arrow-implement')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW)
    .attr('refY', AH / 2)
    .attr('markerWidth', AW)
    .attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', palette.bg)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1);

  // Filled diamond (composition) — at source end
  const DW = 12;
  const DH = 8;
  defs
    .append('marker')
    .attr('id', 'cd-arrow-compose')
    .attr('viewBox', `0 0 ${DW} ${DH}`)
    .attr('refX', 0)
    .attr('refY', DH / 2)
    .attr('markerWidth', DW)
    .attr('markerHeight', DH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `${DW / 2},0 ${DW},${DH / 2} ${DW / 2},${DH} 0,${DH / 2}`)
    .attr('fill', palette.textMuted)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1);

  // Hollow diamond (aggregation) — at source end
  defs
    .append('marker')
    .attr('id', 'cd-arrow-aggregate')
    .attr('viewBox', `0 0 ${DW} ${DH}`)
    .attr('refX', 0)
    .attr('refY', DH / 2)
    .attr('markerWidth', DW)
    .attr('markerHeight', DH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `${DW / 2},0 ${DW},${DH / 2} ${DW / 2},${DH} 0,${DH / 2}`)
    .attr('fill', palette.bg)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1);

  // Open arrowhead (dependency)
  defs
    .append('marker')
    .attr('id', 'cd-arrow-depend')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW)
    .attr('refY', AH / 2)
    .attr('markerWidth', AW)
    .attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polyline')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', 'none')
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1.5);

  // Open arrowhead (association)
  defs
    .append('marker')
    .attr('id', 'cd-arrow-assoc')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW)
    .attr('refY', AH / 2)
    .attr('markerWidth', AW)
    .attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polyline')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', 'none')
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1.5);

  // ── Title ──
  if (showTitle) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', sTitleY)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .style(
        'cursor',
        onClickItem && parsed.titleLineNumber ? 'pointer' : 'default'
      )
      .text(parsed.title!);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
      if (onClickItem) {
        titleEl
          .on('click', () => onClickItem(parsed.titleLineNumber!))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      }
    }
  }

  // ── Legend ──
  // legendActive: true = expanded (default), false = collapsed pill only
  const isLegendExpanded = legendActive !== false;
  if (hasLegend) {
    const legendGroups = [
      {
        name: LEGEND_GROUP_NAME,
        entries: legendEntries.map((entry) => ({
          value: entry.label,
          color: palette.colors[entry.colorKey],
        })),
      },
    ];
    const legendG = svg
      .append('g')
      .attr('class', 'cd-legend')
      .attr('transform', `translate(0,${titleHeight})`);
    renderIntegratedLegend(legendG, {
      groups: legendGroups,
      activeGroup: isLegendExpanded ? LEGEND_GROUP_NAME : null,
      mode: exportMode ? 'export' : 'preview',
      palette,
      isDark,
      width,
    });
  }

  // ── Content group ──
  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // ── Edges (behind nodes) ──
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const edgeG = contentG
      .append('g')
      .attr('class', 'cd-edge-group')
      .attr('data-line-number', String(edge.lineNumber))
      // Endpoint node ids for baked-CSS connection-highlight (hover-styles.ts).
      .attr('data-source', edge.source)
      .attr('data-target', edge.target);

    const edgeColor = palette.textMuted;
    const markerId = markerIdForType(edge.type);
    const dashed = isDashedEdge(edge.type);
    const sourceMarker = isSourceMarker(edge.type);

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      const pathEl = edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', sEdgeStrokeWidth)
        .attr('class', 'cd-edge');

      if (dashed) {
        pathEl.attr('stroke-dasharray', '6 3');
      }

      if (sourceMarker) {
        pathEl.attr('marker-start', `url(#${markerId})`);
      } else {
        pathEl.attr('marker-end', `url(#${markerId})`);
      }
    }

    // Edge label at midpoint
    if (edge.label) {
      const midIdx = Math.floor(edge.points.length / 2);
      // Edges are always non-empty (drawn from a valid graph layout).
      const midPt = edge.points[midIdx]!;
      const bgW = measureText(edge.label, sEdgeLabelFontSize) + 8;
      const bgH = 16;

      edgeG
        .append('rect')
        .attr('x', midPt.x - bgW / 2)
        .attr('y', midPt.y - bgH / 2 - 1)
        .attr('width', bgW)
        .attr('height', bgH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.85)
        .attr('class', 'cd-edge-label-bg');

      edgeG
        .append('text')
        .attr('x', midPt.x)
        .attr('y', midPt.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', sEdgeLabelFontSize)
        .attr('class', 'cd-edge-label')
        .text(edge.label);
    }
  }

  // ── Nodes (top layer) ──
  for (const node of layout.nodes) {
    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'cd-class')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id)
      .attr('data-cd-type', classTypeKey(node.modifier));

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    const w = node.width;
    const h = node.height;
    const colorOff = !!parsed.options?.['no-auto-color'];
    // When legend is collapsed, use neutral color for nodes without explicit color
    const neutralize = hasLegend && !isLegendExpanded && !node.color;
    const effectiveColor = neutralize ? palette.primary : node.color;
    const fillMode = fillModeFromOptions(parsed.options ?? {});
    const fill = nodeFill(
      palette,
      isDark,
      node.modifier,
      effectiveColor,
      colorOff,
      fillMode
    );
    const stroke = nodeStroke(palette, node.modifier, effectiveColor, colorOff);
    const onFillText = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );

    // Outer rectangle
    nodeG
      .append('rect')
      .attr('x', -w / 2)
      .attr('y', -h / 2)
      .attr('width', w)
      .attr('height', h)
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', sNodeStrokeWidth);

    // Header section
    let yPos = -h / 2;
    const headerCenterY = yPos + node.headerHeight / 2;

    // Modifier badge <<interface>> etc.
    if (node.modifier) {
      const badgeText = `\u00AB${node.modifier}\u00BB`; // « »
      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', headerCenterY - 6)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', onFillText)
        .attr('font-size', sMemberFontSize)
        .attr('font-style', 'italic')
        .text(badgeText);

      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', headerCenterY + 10)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', onFillText)
        .attr('font-size', sClassFontSize)
        .attr('font-weight', 'bold')
        .attr('font-style', node.modifier === 'abstract' ? 'italic' : 'normal')
        .text(node.name);
    } else {
      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', headerCenterY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', onFillText)
        .attr('font-size', sClassFontSize)
        .attr('font-weight', 'bold')
        .text(node.name);
    }

    yPos += node.headerHeight;

    const isEnum = node.modifier === 'enum';
    const fields = node.members.filter((m) => !m.isMethod);
    const methods = node.members.filter((m) => m.isMethod);

    if (isEnum) {
      // Enum: single values compartment
      // Separator
      nodeG
        .append('line')
        .attr('x1', -w / 2)
        .attr('y1', yPos)
        .attr('x2', w / 2)
        .attr('y2', yPos)
        .attr('stroke', fillMode === 'solid' ? onFillText : stroke)
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.5);

      let memberY = yPos + sCompartmentPaddingY;
      for (const member of node.members) {
        nodeG
          .append('text')
          .attr('x', -w / 2 + sMemberPaddingX)
          .attr('y', memberY + sMemberLineHeight / 2)
          .attr('dominant-baseline', 'central')
          .attr('fill', onFillText)
          .attr('font-size', sMemberFontSize)
          .text(member.name);
        memberY += sMemberLineHeight;
      }
    } else {
      // UML 3-compartment layout: always show both separators

      // Fields separator
      nodeG
        .append('line')
        .attr('x1', -w / 2)
        .attr('y1', yPos)
        .attr('x2', w / 2)
        .attr('y2', yPos)
        .attr('stroke', fillMode === 'solid' ? onFillText : stroke)
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.5);

      if (fields.length > 0) {
        let memberY = yPos + sCompartmentPaddingY;
        for (const field of fields) {
          const vis = visibilitySymbol(field.visibility);
          let text = `${vis} ${field.name}`;
          if (field.type) text += `: ${field.type}`;

          const textEl = nodeG
            .append('text')
            .attr('x', -w / 2 + sMemberPaddingX)
            .attr('y', memberY + sMemberLineHeight / 2)
            .attr('dominant-baseline', 'central')
            .attr('fill', onFillText)
            .attr('font-size', sMemberFontSize);

          if (field.isStatic) {
            textEl.attr('text-decoration', 'underline');
          }
          textEl.text(text);

          memberY += sMemberLineHeight;
        }
      }
      yPos += node.fieldsHeight;

      // Methods separator
      nodeG
        .append('line')
        .attr('x1', -w / 2)
        .attr('y1', yPos)
        .attr('x2', w / 2)
        .attr('y2', yPos)
        .attr('stroke', fillMode === 'solid' ? onFillText : stroke)
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.5);

      if (methods.length > 0) {
        let memberY = yPos + sCompartmentPaddingY;
        for (const method of methods) {
          const vis = visibilitySymbol(method.visibility);
          let text = `${vis} ${method.name}(${method.params ?? ''})`;
          if (method.type) text += `: ${method.type}`;

          const textEl = nodeG
            .append('text')
            .attr('x', -w / 2 + sMemberPaddingX)
            .attr('y', memberY + sMemberLineHeight / 2)
            .attr('dominant-baseline', 'central')
            .attr('fill', onFillText)
            .attr('font-size', sMemberFontSize);

          if (method.isStatic) {
            textEl.attr('text-decoration', 'underline');
          }
          textEl.text(text);

          memberY += sMemberLineHeight;
        }
      }
    }

    // ── Note (floated beside the class, or a collapsed corner badge) ──
    // The class keeps its layout position; the note floats in adjacent
    // space chosen by the collision-aware placer. Coords are node-center
    // -local (the node `<g>` is translated to the center).
    if (node.note) {
      if (node.note.collapsed) {
        renderNoteBadge(
          nodeG as GSelection,
          {
            x: w / 2 - NOTE_BADGE_RADIUS - 3,
            y: -h / 2 + NOTE_BADGE_RADIUS + 3,
          },
          palette,
          {
            isDark,
            ...(node.note.color && { color: node.note.color }),
            lineNumber: node.note.lineNumber,
            endLineNumber: node.note.endLineNumber,
          }
        );
      } else {
        const [cx1, cy1, cx2, cy2] = noteConnectorPoints(
          { width: w, height: h },
          node.note
        );
        renderNoteConnector(nodeG as GSelection, cx1, cy1, cx2, cy2, palette);
        renderNoteBox(
          nodeG as GSelection,
          {
            x: node.note.x,
            y: node.note.y,
            width: node.note.width,
            height: node.note.height,
          },
          node.note.lines,
          palette,
          {
            isDark,
            ...(node.note.color && { color: node.note.color }),
            lineNumber: node.note.lineNumber,
            endLineNumber: node.note.endLineNumber,
            interactive: true,
          }
        );
      }
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderClassDiagramForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseClassDiagram(content, palette);
  if (parsed.error || parsed.classes.length === 0) return '';

  const layout = layoutClassDiagram(parsed);
  const isDark = theme === 'dark';

  const legendEntries = collectClassTypes(parsed);
  const EXPORT_LEGEND_GAP = 8;
  const legendReserve =
    legendEntries.length > 1 && !legendSuppressed(parsed.options)
      ? LEGEND_HEIGHT + EXPORT_LEGEND_GAP
      : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight =
    layout.height +
    DIAGRAM_PADDING * 2 +
    (parsed.title ? 40 : 0) +
    legendReserve;

  return runInExportContainer(exportWidth, exportHeight, (container) => {
    renderClassDiagram(
      container,
      parsed,
      layout,
      palette,
      isDark,
      undefined,
      {
        width: exportWidth,
        height: exportHeight,
      },
      true, // legendActive for export
      true // exportMode
    );
    return extractExportSvg(container, theme, palette);
  });
}
