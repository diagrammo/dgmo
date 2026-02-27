// ============================================================
// Class Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import type { ParsedClassDiagram, ClassModifier, RelationshipType } from './types';
import type { ClassLayoutResult, ClassLayoutNode, ClassLayoutEdge } from './layout';
import { parseClassDiagram } from './parser';
import { layoutClassDiagram } from './layout';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const CLASS_FONT_SIZE = 13;
const MEMBER_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const MEMBER_LINE_HEIGHT = 18;
const COMPARTMENT_PADDING_Y = 8;
const MEMBER_PADDING_X = 10;

// ============================================================
// Color helpers
// ============================================================

function mix(a: string, b: string, pct: number): string {
  const parse = (h: string) => {
    const r = h.replace('#', '');
    const f = r.length === 3 ? r[0]+r[0]+r[1]+r[1]+r[2]+r[2] : r;
    return [parseInt(f.substring(0,2),16), parseInt(f.substring(2,4),16), parseInt(f.substring(4,6),16)];
  };
  const [ar,ag,ab] = parse(a), [br,bg,bb] = parse(b), t = pct/100;
  const c = (x: number, y: number) => Math.round(x*t + y*(1-t)).toString(16).padStart(2,'0');
  return `#${c(ar,br)}${c(ag,bg)}${c(ab,bb)}`;
}

function modifierColor(modifier: ClassModifier | undefined, palette: PaletteColors, colorOff?: boolean): string {
  if (colorOff) return palette.textMuted;
  switch (modifier) {
    case 'interface':  return palette.colors.blue;
    case 'abstract':   return palette.colors.purple;
    case 'enum':       return palette.colors.yellow;
    default:           return palette.colors.teal;
  }
}

function nodeFill(palette: PaletteColors, isDark: boolean, modifier: ClassModifier | undefined, nodeColor?: string, colorOff?: boolean): string {
  const color = nodeColor ?? modifierColor(modifier, palette, colorOff);
  return mix(color, isDark ? palette.surface : palette.bg, 25);
}

function nodeStroke(palette: PaletteColors, modifier: ClassModifier | undefined, nodeColor?: string, colorOff?: boolean): string {
  return nodeColor ?? modifierColor(modifier, palette, colorOff);
}

// ============================================================
// Visibility symbols
// ============================================================

function visibilitySymbol(vis: 'public' | 'private' | 'protected'): string {
  switch (vis) {
    case 'public':    return '+';
    case 'private':   return '-';
    case 'protected': return '#';
  }
}

// ============================================================
// Edge path generator
// ============================================================

const lineGenerator = d3Shape.line<{ x: number; y: number }>()
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
    case 'extends':     return 'cd-arrow-inherit';
    case 'implements':  return 'cd-arrow-implement';
    case 'composes':    return 'cd-arrow-compose';
    case 'aggregates':  return 'cd-arrow-aggregate';
    case 'depends':     return 'cd-arrow-depend';
    case 'associates':  return 'cd-arrow-assoc';
  }
}

// Where to place marker — source-end for compose/aggregate, target-end for others
function isSourceMarker(type: RelationshipType): boolean {
  return type === 'composes' || type === 'aggregates';
}

// ============================================================
// Main renderer
// ============================================================

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

export function renderClassDiagram(
  container: HTMLDivElement,
  parsed: ParsedClassDiagram,
  layout: ClassLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number }
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleHeight = parsed.title ? 40 : 0;
  const diagramW = layout.width;
  const diagramH = layout.height;
  const availH = height - titleHeight;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const scaledH = diagramH * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + DIAGRAM_PADDING;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // ── Marker defs ──
  const defs = svg.append('defs');
  const AW = 12; // arrowhead width
  const AH = 8;  // arrowhead height

  // Filled triangle (inheritance) — filled with stroke color
  defs.append('marker')
    .attr('id', 'cd-arrow-inherit')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW).attr('refY', AH / 2)
    .attr('markerWidth', AW).attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', palette.textMuted)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1);

  // Hollow triangle (implementation) — white/bg fill
  defs.append('marker')
    .attr('id', 'cd-arrow-implement')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW).attr('refY', AH / 2)
    .attr('markerWidth', AW).attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', palette.bg)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1);

  // Filled diamond (composition) — at source end
  const DW = 12;
  const DH = 8;
  defs.append('marker')
    .attr('id', 'cd-arrow-compose')
    .attr('viewBox', `0 0 ${DW} ${DH}`)
    .attr('refX', 0).attr('refY', DH / 2)
    .attr('markerWidth', DW).attr('markerHeight', DH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `${DW / 2},0 ${DW},${DH / 2} ${DW / 2},${DH} 0,${DH / 2}`)
    .attr('fill', palette.textMuted)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1);

  // Hollow diamond (aggregation) — at source end
  defs.append('marker')
    .attr('id', 'cd-arrow-aggregate')
    .attr('viewBox', `0 0 ${DW} ${DH}`)
    .attr('refX', 0).attr('refY', DH / 2)
    .attr('markerWidth', DW).attr('markerHeight', DH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `${DW / 2},0 ${DW},${DH / 2} ${DW / 2},${DH} 0,${DH / 2}`)
    .attr('fill', palette.bg)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1);

  // Open arrowhead (dependency)
  defs.append('marker')
    .attr('id', 'cd-arrow-depend')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW).attr('refY', AH / 2)
    .attr('markerWidth', AW).attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polyline')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', 'none')
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1.5);

  // Open arrowhead (association)
  defs.append('marker')
    .attr('id', 'cd-arrow-assoc')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW).attr('refY', AH / 2)
    .attr('markerWidth', AW).attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polyline')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', 'none')
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1.5);

  // ── Title ──
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
      .attr('data-line-number', String(edge.lineNumber));

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
        .attr('stroke-width', EDGE_STROKE_WIDTH)
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
      const midPt = edge.points[midIdx];
      const labelLen = edge.label.length;
      const bgW = labelLen * 7 + 8;
      const bgH = 16;

      edgeG.append('rect')
        .attr('x', midPt.x - bgW / 2)
        .attr('y', midPt.y - bgH / 2 - 1)
        .attr('width', bgW)
        .attr('height', bgH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.85)
        .attr('class', 'cd-edge-label-bg');

      edgeG.append('text')
        .attr('x', midPt.x)
        .attr('y', midPt.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', EDGE_LABEL_FONT_SIZE)
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
      .attr('data-node-id', node.id);

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    const w = node.width;
    const h = node.height;
    const colorOff = parsed.options?.color === 'off';
    const fill = nodeFill(palette, isDark, node.modifier, node.color, colorOff);
    const stroke = nodeStroke(palette, node.modifier, node.color, colorOff);

    // Outer rectangle
    nodeG.append('rect')
      .attr('x', -w / 2)
      .attr('y', -h / 2)
      .attr('width', w)
      .attr('height', h)
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Header section
    let yPos = -h / 2;
    const headerCenterY = yPos + node.headerHeight / 2;

    // Modifier badge <<interface>> etc.
    if (node.modifier) {
      const badgeText = `\u00AB${node.modifier}\u00BB`; // « »
      nodeG.append('text')
        .attr('x', 0)
        .attr('y', headerCenterY - 6)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.textMuted)
        .attr('font-size', MEMBER_FONT_SIZE)
        .attr('font-style', 'italic')
        .text(badgeText);

      // Class name below badge
      nodeG.append('text')
        .attr('x', 0)
        .attr('y', headerCenterY + 10)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.text)
        .attr('font-size', CLASS_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('font-style', node.modifier === 'abstract' ? 'italic' : 'normal')
        .text(node.name);
    } else {
      // Just class name centered
      nodeG.append('text')
        .attr('x', 0)
        .attr('y', headerCenterY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.text)
        .attr('font-size', CLASS_FONT_SIZE)
        .attr('font-weight', 'bold')
        .text(node.name);
    }

    yPos += node.headerHeight;

    const isEnum = node.modifier === 'enum';
    const fields = node.members.filter((m) => !m.isMethod);
    const methods = node.members.filter((m) => m.isMethod);

    if (isEnum) {
      // Enum: all members as values
      if (node.members.length > 0) {
        // Separator
        nodeG.append('line')
          .attr('x1', -w / 2)
          .attr('y1', yPos)
          .attr('x2', w / 2)
          .attr('y2', yPos)
          .attr('stroke', stroke)
          .attr('stroke-width', 0.5)
          .attr('stroke-opacity', 0.5);

        let memberY = yPos + COMPARTMENT_PADDING_Y;
        for (const member of node.members) {
          nodeG.append('text')
            .attr('x', -w / 2 + MEMBER_PADDING_X)
            .attr('y', memberY + MEMBER_LINE_HEIGHT / 2)
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.text)
            .attr('font-size', MEMBER_FONT_SIZE)
            .text(member.name);
          memberY += MEMBER_LINE_HEIGHT;
        }
      }
    } else {
      // Fields compartment
      if (fields.length > 0) {
        // Separator
        nodeG.append('line')
          .attr('x1', -w / 2)
          .attr('y1', yPos)
          .attr('x2', w / 2)
          .attr('y2', yPos)
          .attr('stroke', stroke)
          .attr('stroke-width', 0.5)
          .attr('stroke-opacity', 0.5);

        let memberY = yPos + COMPARTMENT_PADDING_Y;
        for (const field of fields) {
          const vis = visibilitySymbol(field.visibility);
          let text = `${vis} ${field.name}`;
          if (field.type) text += `: ${field.type}`;

          const textEl = nodeG.append('text')
            .attr('x', -w / 2 + MEMBER_PADDING_X)
            .attr('y', memberY + MEMBER_LINE_HEIGHT / 2)
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.text)
            .attr('font-size', MEMBER_FONT_SIZE);

          if (field.isStatic) {
            textEl.attr('text-decoration', 'underline');
          }
          textEl.text(text);

          memberY += MEMBER_LINE_HEIGHT;
        }
        yPos += node.fieldsHeight;
      }

      // Methods compartment
      if (methods.length > 0) {
        // Separator
        nodeG.append('line')
          .attr('x1', -w / 2)
          .attr('y1', yPos)
          .attr('x2', w / 2)
          .attr('y2', yPos)
          .attr('stroke', stroke)
          .attr('stroke-width', 0.5)
          .attr('stroke-opacity', 0.5);

        let memberY = yPos + COMPARTMENT_PADDING_Y;
        for (const method of methods) {
          const vis = visibilitySymbol(method.visibility);
          let text = `${vis} ${method.name}(${method.params ?? ''})`;
          if (method.type) text += `: ${method.type}`;

          const textEl = nodeG.append('text')
            .attr('x', -w / 2 + MEMBER_PADDING_X)
            .attr('y', memberY + MEMBER_LINE_HEIGHT / 2)
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.text)
            .attr('font-size', MEMBER_FONT_SIZE);

          if (method.isStatic) {
            textEl.attr('text-decoration', 'underline');
          }
          textEl.text(text);

          memberY += MEMBER_LINE_HEIGHT;
        }
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

  const container = document.createElement('div');
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + (parsed.title ? 40 : 0);
  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    renderClassDiagram(
      container,
      parsed,
      layout,
      palette,
      isDark,
      undefined,
      { width: exportWidth, height: exportHeight }
    );

    const svgEl = container.querySelector('svg');
    if (!svgEl) return '';

    if (theme === 'transparent') {
      svgEl.style.background = 'none';
    }

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;

    return svgEl.outerHTML;
  } finally {
    document.body.removeChild(container);
  }
}
