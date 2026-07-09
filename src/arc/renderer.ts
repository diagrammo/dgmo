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

  // First group containing each node (a node sits in at most one band), and a
  // node → group-color lookup so arcs can inherit their group's color. Shared
  // by both orientations.
  const groupOfNode = new Map<string, string>();
  const groupColorByName = new Map<string, string>();
  for (const grp of arcNodeGroups) {
    if (grp.color) groupColorByName.set(grp.name, grp.color);
    for (const n of grp.nodes)
      if (nodes.includes(n) && !groupOfNode.has(n))
        groupOfNode.set(n, grp.name);
  }
  // A link takes its source node's group color (falls back to target's).
  const groupColorOfLink = (l: ArcLink): string | undefined => {
    const g = groupOfNode.get(l.source) ?? groupOfNode.get(l.target);
    return g ? groupColorByName.get(g) : undefined;
  };

  if (isVertical) {
    // Vertical layout: nodes along Y axis, arcs curve to the right
    const yScale = d3Scale
      .scalePoint<string>()
      .domain(nodes)
      .range([0, innerHeight])
      .padding(0.5);

    const baseX = innerWidth / 2;

    // Group bands (shaded regions bounding grouped nodes). Node labels sit to
    // the left of the spine; the group name becomes a rotated lane-label in a
    // dedicated column at the far-left edge so it never crowds the top node.
    if (arcNodeGroups.length > 0) {
      const bandPad = (yScale.step?.() ?? 20) * 0.4;
      const vWidestLabelPx =
        Math.max(...nodes.map((n) => n.length)) * sNodeLabelFont * 0.6;
      // Name column = text height + a full font of padding on each side, so the
      // rotated lane-label breathes off both the band edge and the node labels.
      const vNameColW = sGroupLabelFont * 3;
      // Band left encloses the node labels, then the rotated-name column.
      const innerLeft =
        baseX - Math.max(sBandHalfW, sNodeLabelXOffset + vWidestLabelPx + 4);
      const bandLeft = innerLeft - vNameColW;
      const bandRight = baseX + sBandHalfW;
      for (const group of arcNodeGroups) {
        const groupNodes = group.nodes.filter((n) => nodes.includes(n));
        if (groupNodes.length === 0) continue;
        const positions = groupNodes.map((n) => yScale(n)!);
        const minY = Math.min(...positions) - bandPad;
        const maxY = Math.max(...positions) + bandPad;
        const midYBand = (minY + maxY) / 2;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', bandLeft)
          .attr('y', minY)
          .attr('width', bandRight - bandLeft)
          .attr('height', maxY - minY)
          .attr('rx', sBandRadius)
          .attr('fill', group.color ?? textColor)
          .attr('fill-opacity', group.color ? 0.15 : 0.06)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        const nameX = bandLeft + vNameColW / 2;
        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', nameX)
          .attr('y', midYBand)
          .attr('text-anchor', 'middle')
          .attr('transform', `rotate(-90 ${nameX} ${midYBand})`)
          .attr('fill', textColor)
          .attr('font-size', `${sGroupLabelFont}px`)
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.6)
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
      // Explicit link color wins; else the group's color; else palette cycle.
      // colors is non-empty; modulo guarantees in-bounds.
      const color =
        link.color ?? groupColorOfLink(link) ?? colors[idx % colors.length]!;

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

    // Rotate node labels 45° when horizontal names would collide. Approximate
    // each label's rendered width (~0.6em/char for Inter) and compare to the
    // per-node slot (scalePoint step). A rotated label reads down-left from its
    // dot; its vertical footprint is width*sin45 ≈ width*0.71.
    const arcStep = xScale.step();
    const widestLabelChars = Math.max(...nodes.map((n) => n.length));
    const labelWidthPx = widestLabelChars * sNodeLabelFont * 0.6;
    const rotateLabels = labelWidthPx > arcStep * 0.9;
    const labelPivotGap = sNodeRadius + 4;
    const rotatedLabelDrop = labelWidthPx * 0.71;

    const hasGroups = arcNodeGroups.length > 0;

    // X positions. Ungrouped → even scalePoint. Grouped → manual layout that
    // fills the width and injects an inter-group gap wide enough that a rotated
    // (down-left) label of one group can never reach into the previous group.
    // The gap is sized in px from the label overhang, so groups spread apart
    // exactly as much as the diagonal labels demand.
    const xPos = new Map<string, number>();
    let bandStepPx = arcStep;
    if (hasGroups) {
      let boundaryCount = 0;
      let prevG: string | null = null;
      for (const n of nodes) {
        const gn = groupOfNode.get(n) ?? ` solo:${n}`;
        if (prevG !== null && gn !== prevG) boundaryCount++;
        prevG = gn;
      }
      const withinAdj = nodes.length - 1 - boundaryCount;
      // Gap ≥ widest possible label overhang + both bands' side padding, so a
      // next-group label can never reach the previous band (no seam overlap).
      const groupGapPx = rotateLabels
        ? rotatedLabelDrop + sNodeRadius * 2 + 12
        : arcStep * 0.9;
      const leftInset = rotateLabels
        ? rotatedLabelDrop + sNodeRadius
        : arcStep * 0.5;
      const rightInset = rotateLabels ? sNodeRadius + 2 : arcStep * 0.5;
      const avail = innerWidth - leftInset - rightInset;
      let stepPx =
        withinAdj > 0
          ? (avail - boundaryCount * groupGapPx) / withinAdj
          : avail;
      if (!isFinite(stepPx) || stepPx < sNodeRadius * 2)
        stepPx = Math.max(sNodeRadius * 2, arcStep * 0.5);
      bandStepPx = stepPx;
      let cx = leftInset;
      prevG = null;
      for (const n of nodes) {
        const gn = groupOfNode.get(n) ?? ` solo:${n}`;
        if (prevG !== null) cx += gn !== prevG ? groupGapPx : stepPx;
        xPos.set(n, cx);
        prevG = gn;
      }
    } else {
      for (const n of nodes) xPos.set(n, xScale(n)!);
    }
    const posX = (n: string) => xPos.get(n)!;

    // Depth below the baseline occupied by node labels, then the group name.
    // When labels rotate they drop past the flat band, so the band (and the
    // export canvas) must grow to keep both labels and group name inside.
    const nodeLabelDepth = rotateLabels
      ? labelPivotGap + rotatedLabelDrop
      : sNodeLabelYOffset + sNodeLabelFont;
    const groupNameGap = sGroupLabelFont + sBandLabelBottomOffset;
    // Grouped bands (either orientation of labels) seat the group name a full
    // font below the node labels, then the box extends further below it so the
    // name never crowds the band's bottom edge.
    const belowExtent = hasGroups
      ? nodeLabelDepth + groupNameGap + sGroupLabelFont * 0.25
      : Math.max(sBandHalfH, nodeLabelDepth);

    // Live preview centers the baseline in the host container; export sizes the
    // canvas to the arc band so the SVG carries no dead whitespace (arcs bow up
    // by ~distance*0.2 above the baseline, labels/bands sit just below it).
    let baseY = innerHeight / 2;
    if (exportDims) {
      let maxDist = 0;
      for (const l of links) {
        const a = posX(l.source);
        const b = posX(l.target);
        if (a != null && b != null)
          maxDist = Math.max(maxDist, Math.abs(b - a));
      }
      const above = maxDist * 0.2 + sNodeRadius;
      const below = belowExtent;
      baseY = above;
      const tightHeight = margin.top + above + below + margin.bottom;
      svg
        .attr('height', tightHeight)
        .attr('viewBox', `0 0 ${width} ${tightHeight}`);
    }

    // Group bands (shaded regions bounding grouped nodes). Filled with the
    // group's own color when defined; the box grows down to enclose the node
    // labels (rotated labels drop below the flat band) with the group name
    // seated just under them, still inside the box.
    if (hasGroups) {
      const bandTopY = baseY - sBandHalfH;
      const bandBottomY = baseY + belowExtent;
      for (const group of arcNodeGroups) {
        const groupNodes = group.nodes.filter((n) => nodes.includes(n));
        if (groupNodes.length === 0) continue;
        const positions = groupNodes.map((n) => posX(n));
        const minP = Math.min(...positions);
        const maxP = Math.max(...positions);
        const sidePad = rotateLabels ? sNodeRadius + 4 : bandStepPx * 0.4;
        // Left edge hugs this group's own leftmost label (its rotated overhang),
        // not the global widest — keeps each band snug against its labels.
        const leftNode = groupNodes.reduce((a, b) =>
          posX(a) < posX(b) ? a : b
        );
        const ownOverhang = leftNode.length * sNodeLabelFont * 0.6 * 0.71;
        const bandLeft = rotateLabels
          ? minP - ownOverhang - sidePad
          : minP - sidePad;
        const bandRight = maxP + sidePad;
        const bandFill = group.color ?? textColor;
        const bandFillOpacity = group.color ? 0.15 : 0.06;
        const nameY = baseY + nodeLabelDepth + sGroupLabelFont;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', bandLeft)
          .attr('y', bandTopY)
          .attr('width', bandRight - bandLeft)
          .attr('height', bandBottomY - bandTopY)
          .attr('rx', sBandRadius)
          .attr('fill', bandFill)
          .attr('fill-opacity', bandFillOpacity)
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
          .attr('x', (minP + maxP) / 2)
          .attr('y', nameY)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', `${sGroupLabelFont}px`)
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.6)
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
      const x1 = posX(link.source)!;
      const x2 = posX(link.target)!;
      const midX = (x1 + x2) / 2;
      const distance = Math.abs(x2 - x1);
      const controlY = baseY - distance * 0.4;
      // Explicit link color wins; else the group's color; else palette cycle.
      // colors is non-empty; modulo guarantees in-bounds.
      const color =
        link.color ?? groupColorOfLink(link) ?? colors[idx % colors.length]!;

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
      const x = posX(node)!;
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

      const labelY = rotateLabels
        ? baseY + labelPivotGap
        : baseY + sNodeLabelYOffset;
      const nodeLabel = nodeG
        .append('text')
        .attr('x', x)
        .attr('y', labelY)
        .attr('text-anchor', rotateLabels ? 'end' : 'middle')
        .attr('fill', textColor)
        .attr('font-size', `${sNodeLabelFont}px`)
        .text(node);
      if (rotateLabels) {
        // -45° pivots at the dot; anchor 'end' hangs text down-left, last char
        // under the dot (see rotatedLabelDrop above).
        nodeLabel.attr('transform', `rotate(-45 ${x} ${labelY})`);
      }
    }
  }
}

// ============================================================
// Timeline Era Bands
// ============================================================
