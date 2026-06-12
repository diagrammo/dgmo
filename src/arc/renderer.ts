// ============================================================
// Arc renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Array from 'd3-array';
import type { D3ExportDimensions } from '../utils/d3-types';
import { ScaleContext } from '../utils/scaling';
import { initD3Chart, renderChartTitle } from '../utils/d3-helpers';
import type {
  ParsedArc,
  ArcLink,
  ArcOrder,
  ArcNodeGroup,
} from '../visualizations/types';
import type { PaletteColors } from '../palettes';

export function orderArcNodes(
  links: ArcLink[],
  order: ArcOrder,
  groups: ArcNodeGroup[]
): string[] {
  // Collect all unique nodes in first-appearance order
  const nodeSet = new Set<string>();
  for (const link of links) {
    nodeSet.add(link.source);
    nodeSet.add(link.target);
  }
  const allNodes = Array.from(nodeSet);

  if (order === 'name') {
    return allNodes.slice().sort((a, b) => a.localeCompare(b));
  }

  if (order === 'degree') {
    const degree = new Map<string, number>();
    for (const node of allNodes) degree.set(node, 0);
    for (const link of links) {
      degree.set(link.source, degree.get(link.source)! + link.value);
      degree.set(link.target, degree.get(link.target)! + link.value);
    }
    return allNodes.slice().sort((a, b) => {
      const diff = degree.get(b)! - degree.get(a)!;
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  }

  if (order === 'group') {
    if (groups.length > 0) {
      // Explicit groups: order by ## header order, appearance within each group
      const ordered: string[] = [];
      const placed = new Set<string>();
      for (const group of groups) {
        for (const node of group.nodes) {
          if (!placed.has(node)) {
            ordered.push(node);
            placed.add(node);
          }
        }
      }
      // Orphans at end in first-appearance order
      for (const node of allNodes) {
        if (!placed.has(node)) {
          ordered.push(node);
          placed.add(node);
        }
      }
      return ordered;
    }
    // No explicit groups: connectivity clustering via BFS
    const adj = new Map<string, Set<string>>();
    for (const node of allNodes) adj.set(node, new Set());
    for (const link of links) {
      adj.get(link.source)!.add(link.target);
      adj.get(link.target)!.add(link.source);
    }

    const degree = new Map<string, number>();
    for (const node of allNodes) degree.set(node, 0);
    for (const link of links) {
      degree.set(link.source, degree.get(link.source)! + link.value);
      degree.set(link.target, degree.get(link.target)! + link.value);
    }

    const visited = new Set<string>();
    const components: string[][] = [];

    const remaining = new Set(allNodes);
    while (remaining.size > 0) {
      // Pick highest-degree unvisited node as BFS root
      let root = '';
      let maxDeg = -1;
      for (const node of remaining) {
        if (degree.get(node)! > maxDeg) {
          maxDeg = degree.get(node)!;
          root = node;
        }
      }
      // BFS
      const component: string[] = [];
      const queue = [root];
      visited.add(root);
      remaining.delete(root);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        component.push(curr);
        for (const neighbor of adj.get(curr)!) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            remaining.delete(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }
    // Sort components by size descending
    components.sort((a, b) => b.length - a.length);
    return components.flat();
  }

  // 'appearance' — first-appearance order (default)
  return allNodes;
}

// ============================================================
// Arc Diagram Renderer
// ============================================================

const ARC_MARGIN_TOP = 60;
const ARC_MARGIN_RIGHT = 40;
const ARC_MARGIN_BOTTOM = 60;
const ARC_MARGIN_LEFT = 40;
const ARC_MARGIN_LEFT_VERTICAL = 120;
const ARC_NODE_RADIUS = 5;
const ARC_NODE_STROKE_WIDTH = 1.5;
const ARC_NODE_LABEL_FONT = 11;
const ARC_GROUP_LABEL_FONT = 12;
const ARC_BAND_HALF_W = 60;
const ARC_BAND_HALF_H = 40;
const ARC_BAND_RADIUS = 4;
const ARC_BAND_LABEL_X_OFFSET = 6;
const ARC_BAND_LABEL_Y_OFFSET = 14;
const ARC_BAND_LABEL_BOTTOM_OFFSET = 4;
const ARC_NODE_LABEL_X_OFFSET = 14;
const ARC_NODE_LABEL_Y_OFFSET = 20;
const ARC_STROKE_MIN = 1.5;
const ARC_STROKE_MAX = 6;
const ARC_BASELINE_STROKE_WIDTH = 1;

/**
 * Renders an arc diagram into the given container using D3.
 */
export function renderArcDiagram(
  container: HTMLDivElement,
  parsed: ParsedArc,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { links, orientation, arcOrder, arcNodeGroups } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (links.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;

  const isVertical = orientation === 'vertical';

  const nodes = orderArcNodes(links, arcOrder, arcNodeGroups);

  const idealWidth = isVertical
    ? ARC_MARGIN_LEFT_VERTICAL + ARC_MARGIN_RIGHT + ARC_BAND_HALF_W * 2 + 100
    : nodes.length * 20 + ARC_MARGIN_LEFT + ARC_MARGIN_RIGHT;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sMarginTop = ctx.aesthetic(ARC_MARGIN_TOP);
  const sMarginRight = ctx.aesthetic(ARC_MARGIN_RIGHT);
  const sMarginBottom = ctx.aesthetic(ARC_MARGIN_BOTTOM);
  const sMarginLeft = isVertical
    ? ctx.aesthetic(ARC_MARGIN_LEFT_VERTICAL)
    : ctx.aesthetic(ARC_MARGIN_LEFT);
  const sNodeRadius = ctx.structural(ARC_NODE_RADIUS);
  const sNodeStrokeWidth = ctx.structural(ARC_NODE_STROKE_WIDTH);
  const sNodeLabelFont = ctx.text(ARC_NODE_LABEL_FONT);
  const sGroupLabelFont = ctx.text(ARC_GROUP_LABEL_FONT);
  const sBandHalfW = ctx.aesthetic(ARC_BAND_HALF_W);
  const sBandHalfH = ctx.aesthetic(ARC_BAND_HALF_H);
  const sBandRadius = ctx.structural(ARC_BAND_RADIUS);
  const sBandLabelXOffset = ctx.structural(ARC_BAND_LABEL_X_OFFSET);
  const sBandLabelYOffset = ctx.structural(ARC_BAND_LABEL_Y_OFFSET);
  const sBandLabelBottomOffset = ctx.structural(ARC_BAND_LABEL_BOTTOM_OFFSET);
  const sNodeLabelXOffset = ctx.structural(ARC_NODE_LABEL_X_OFFSET);
  const sNodeLabelYOffset = ctx.structural(ARC_NODE_LABEL_Y_OFFSET);
  const sStrokeMin = ctx.structural(ARC_STROKE_MIN);
  const sStrokeMax = ctx.structural(ARC_STROKE_MAX);
  const sBaselineDash = `${ctx.structural(4)},${ctx.structural(4)}`;
  const sBaselineStrokeWidth = ctx.structural(ARC_BASELINE_STROKE_WIDTH);

  svg.attr('preserveAspectRatio', 'xMidYMin meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const margin = {
    top: sMarginTop,
    right: sMarginRight,
    bottom: sMarginBottom,
    left: sMarginLeft,
  };

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const nodeColorMap = new Map<string, string>();
  for (const group of arcNodeGroups) {
    if (group.color) {
      for (const node of group.nodes) {
        if (!nodeColorMap.has(node)) {
          nodeColorMap.set(node, group.color);
        }
      }
    }
  }

  const groupNodeSets = new Map<string, Set<string>>();
  for (const group of arcNodeGroups) {
    groupNodeSets.set(group.name, new Set(group.nodes));
  }

  const values = links.map((l) => l.value);
  const [minVal, maxVal] = d3Array.extent(values) as [number, number];
  const strokeScale = d3Scale
    .scaleLinear()
    .domain([minVal, maxVal])
    .range([sStrokeMin, sStrokeMax]);

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Title
  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // Build adjacency map for hover interactions
  const neighbors = new Map<string, Set<string>>();
  for (const node of nodes) neighbors.set(node, new Set());
  for (const link of links) {
    neighbors.get(link.source)!.add(link.target);
    neighbors.get(link.target)!.add(link.source);
  }

  const FADE_OPACITY = 0.1;

  function handleMouseEnter(hovered: string) {
    const connected = neighbors.get(hovered)!;

    g.selectAll<SVGPathElement, unknown>('.arc-link').each(function () {
      const el = d3Selection.select(this);
      const src = el.attr('data-source');
      const tgt = el.attr('data-target');
      const isRelated = src === hovered || tgt === hovered;
      el.attr('stroke-opacity', isRelated ? 0.85 : FADE_OPACITY);
    });

    g.selectAll<SVGGElement, unknown>('.arc-node').each(function () {
      const el = d3Selection.select(this);
      const name = el.attr('data-node');
      const isRelated = name === hovered || connected.has(name!);
      el.attr('opacity', isRelated ? 1 : FADE_OPACITY);
    });
  }

  function handleMouseLeave() {
    g.selectAll<SVGPathElement, unknown>('.arc-link').attr(
      'stroke-opacity',
      0.7
    );
    g.selectAll<SVGGElement, unknown>('.arc-node').attr('opacity', 1);
    g.selectAll<SVGRectElement, unknown>('.arc-group-band').attr(
      'fill-opacity',
      0.06
    );
    g.selectAll<SVGTextElement, unknown>('.arc-group-label').attr(
      'fill-opacity',
      0.5
    );
  }

  function handleGroupEnter(groupName: string) {
    const members = groupNodeSets.get(groupName);
    if (!members) return;

    g.selectAll<SVGPathElement, unknown>('.arc-link').each(function () {
      const el = d3Selection.select(this);
      const isRelated =
        members.has(el.attr('data-source')!) ||
        members.has(el.attr('data-target')!);
      el.attr('stroke-opacity', isRelated ? 0.85 : FADE_OPACITY);
    });

    g.selectAll<SVGGElement, unknown>('.arc-node').each(function () {
      const el = d3Selection.select(this);
      el.attr('opacity', members.has(el.attr('data-node')!) ? 1 : FADE_OPACITY);
    });

    g.selectAll<SVGRectElement, unknown>('.arc-group-band').each(function () {
      const el = d3Selection.select(this);
      el.attr(
        'fill-opacity',
        el.attr('data-group') === groupName ? 0.18 : 0.03
      );
    });

    g.selectAll<SVGTextElement, unknown>('.arc-group-label').each(function () {
      const el = d3Selection.select(this);
      el.attr('fill-opacity', el.attr('data-group') === groupName ? 1 : 0.2);
    });
  }

  if (isVertical) {
    // Vertical layout: nodes along Y axis, arcs curve to the right
    const yScale = d3Scale
      .scalePoint<string>()
      .domain(nodes)
      .range([0, innerHeight])
      .padding(0.5);

    const baseX = innerWidth / 2;

    // Group bands (shaded regions bounding grouped nodes)
    if (arcNodeGroups.length > 0) {
      const bandPad = (yScale.step?.() ?? 20) * 0.4;
      for (const group of arcNodeGroups) {
        const groupNodes = group.nodes.filter((n) => nodes.includes(n));
        if (groupNodes.length === 0) continue;
        const positions = groupNodes.map((n) => yScale(n)!);
        const minY = Math.min(...positions) - bandPad;
        const maxY = Math.max(...positions) + bandPad;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', baseX - sBandHalfW)
          .attr('y', minY)
          .attr('width', sBandHalfW * 2)
          .attr('height', maxY - minY)
          .attr('rx', sBandRadius)
          .attr('fill', textColor)
          .attr('fill-opacity', 0.06)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', baseX - sBandHalfW + sBandLabelXOffset)
          .attr('y', minY + sBandLabelYOffset)
          .attr('fill', textColor)
          .attr('font-size', `${sGroupLabelFont}px`)
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.5)
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .text(group.name)
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });
      }
    }

    // Dashed vertical baseline
    g.append('line')
      .attr('x1', baseX)
      .attr('y1', 0)
      .attr('x2', baseX)
      .attr('y2', innerHeight)
      .attr('stroke', mutedColor)
      .attr('stroke-width', sBaselineStrokeWidth)
      .attr('stroke-dasharray', sBaselineDash);

    // Arcs
    links.forEach((link, idx) => {
      const y1 = yScale(link.source)!;
      const y2 = yScale(link.target)!;
      const midY = (y1 + y2) / 2;
      const distance = Math.abs(y2 - y1);
      const controlX = baseX + distance * 0.4;
      // colors is non-empty; modulo guarantees in-bounds.
      const color = link.color ?? colors[idx % colors.length]!;

      g.append('path')
        .attr('class', 'arc-link')
        .attr('data-source', link.source)
        .attr('data-target', link.target)
        .attr('data-line-number', String(link.lineNumber))
        .attr('d', `M ${baseX},${y1} Q ${controlX},${midY} ${baseX},${y2}`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeScale(link.value))
        .attr('stroke-opacity', 0.7)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('click', () => {
          if (onClickItem && link.lineNumber) onClickItem(link.lineNumber);
        });
    });

    // Node circles and labels
    for (const node of nodes) {
      const y = yScale(node)!;
      const nodeColor = nodeColorMap.get(node) ?? textColor;
      // Find the first link involving this node (for line number and click target)
      const nodeLink = links.find(
        (l) => l.source === node || l.target === node
      );

      const nodeG = g
        .append('g')
        .attr('class', 'arc-node')
        .attr('data-node', node)
        .attr(
          'data-line-number',
          nodeLink?.lineNumber ? String(nodeLink.lineNumber) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', () => handleMouseEnter(node))
        .on('mouseleave', handleMouseLeave)
        .on('click', () => {
          if (onClickItem && nodeLink?.lineNumber)
            onClickItem(nodeLink.lineNumber);
        });

      nodeG
        .append('circle')
        .attr('cx', baseX)
        .attr('cy', y)
        .attr('r', sNodeRadius)
        .attr('fill', nodeColor)
        .attr('stroke', bgColor)
        .attr('stroke-width', sNodeStrokeWidth);

      nodeG
        .append('text')
        .attr('x', baseX - sNodeLabelXOffset)
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', `${sNodeLabelFont}px`)
        .text(node);
    }
  } else {
    // Horizontal layout (default): nodes along X axis, arcs curve upward
    const xScale = d3Scale
      .scalePoint<string>()
      .domain(nodes)
      .range([0, innerWidth])
      .padding(0.5);

    const baseY = innerHeight / 2;

    // Group bands (shaded regions bounding grouped nodes)
    if (arcNodeGroups.length > 0) {
      const bandPad = (xScale.step?.() ?? 20) * 0.4;
      for (const group of arcNodeGroups) {
        const groupNodes = group.nodes.filter((n) => nodes.includes(n));
        if (groupNodes.length === 0) continue;
        const positions = groupNodes.map((n) => xScale(n)!);
        const minX = Math.min(...positions) - bandPad;
        const maxX = Math.max(...positions) + bandPad;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', minX)
          .attr('y', baseY - sBandHalfH)
          .attr('width', maxX - minX)
          .attr('height', sBandHalfH * 2)
          .attr('rx', sBandRadius)
          .attr('fill', textColor)
          .attr('fill-opacity', 0.06)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', (minX + maxX) / 2)
          .attr('y', baseY + sBandHalfH - sBandLabelBottomOffset)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', `${sGroupLabelFont}px`)
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.5)
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .text(group.name)
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });
      }
    }

    // Dashed horizontal baseline
    g.append('line')
      .attr('x1', 0)
      .attr('y1', baseY)
      .attr('x2', innerWidth)
      .attr('y2', baseY)
      .attr('stroke', mutedColor)
      .attr('stroke-width', sBaselineStrokeWidth)
      .attr('stroke-dasharray', sBaselineDash);

    // Arcs
    links.forEach((link, idx) => {
      const x1 = xScale(link.source)!;
      const x2 = xScale(link.target)!;
      const midX = (x1 + x2) / 2;
      const distance = Math.abs(x2 - x1);
      const controlY = baseY - distance * 0.4;
      // colors is non-empty; modulo guarantees in-bounds.
      const color = link.color ?? colors[idx % colors.length]!;

      g.append('path')
        .attr('class', 'arc-link')
        .attr('data-source', link.source)
        .attr('data-target', link.target)
        .attr('data-line-number', String(link.lineNumber))
        .attr('d', `M ${x1},${baseY} Q ${midX},${controlY} ${x2},${baseY}`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeScale(link.value))
        .attr('stroke-opacity', 0.7)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('click', () => {
          if (onClickItem && link.lineNumber) onClickItem(link.lineNumber);
        });
    });

    // Node circles and labels
    for (const node of nodes) {
      const x = xScale(node)!;
      const nodeColor = nodeColorMap.get(node) ?? textColor;
      // Find the first link involving this node (for line number and click target)
      const nodeLink = links.find(
        (l) => l.source === node || l.target === node
      );

      const nodeG = g
        .append('g')
        .attr('class', 'arc-node')
        .attr('data-node', node)
        .attr(
          'data-line-number',
          nodeLink?.lineNumber ? String(nodeLink.lineNumber) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', () => handleMouseEnter(node))
        .on('mouseleave', handleMouseLeave)
        .on('click', () => {
          if (onClickItem && nodeLink?.lineNumber)
            onClickItem(nodeLink.lineNumber);
        });

      nodeG
        .append('circle')
        .attr('cx', x)
        .attr('cy', baseY)
        .attr('r', sNodeRadius)
        .attr('fill', nodeColor)
        .attr('stroke', bgColor)
        .attr('stroke-width', sNodeStrokeWidth);

      nodeG
        .append('text')
        .attr('x', x)
        .attr('y', baseY + sNodeLabelYOffset)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', `${sNodeLabelFont}px`)
        .text(node);
    }
  }
}

// ============================================================
// Timeline Era Bands
// ============================================================
