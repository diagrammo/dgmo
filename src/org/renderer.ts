// ============================================================
// Org Chart SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import type { ParsedOrg } from './parser';
import type { OrgLayoutResult, OrgLayoutNode } from './layout';
import { parseOrg } from './parser';
import { layoutOrg } from './layout';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const TITLE_HEIGHT = 30;
const TITLE_FONT_SIZE = 18;
const LABEL_FONT_SIZE = 13;
const META_FONT_SIZE = 11;
const META_LINE_HEIGHT = 16;
const HEADER_HEIGHT = 28;
const SEPARATOR_GAP = 6;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const CARD_RADIUS = 6;
const CONTAINER_RADIUS = 8;
const CONTAINER_LABEL_FONT_SIZE = 13;
const CONTAINER_META_FONT_SIZE = 11;
const CONTAINER_META_LINE_HEIGHT = 16;
const CONTAINER_HEADER_HEIGHT = 28;

// ============================================================
// Color helpers (inline to avoid cross-module import issues)
// ============================================================

function mix(a: string, b: string, pct: number): string {
  const parse = (h: string) => {
    const r = h.replace('#', '');
    const f = r.length === 3 ? r[0] + r[0] + r[1] + r[1] + r[2] + r[2] : r;
    return [
      parseInt(f.substring(0, 2), 16),
      parseInt(f.substring(2, 4), 16),
      parseInt(f.substring(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a),
    [br, bg, bb] = parse(b),
    t = pct / 100;
  const c = (x: number, y: number) =>
    Math.round(x * t + y * (1 - t))
      .toString(16)
      .padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

function nodeFill(
  palette: PaletteColors,
  isDark: boolean,
  nodeColor?: string
): string {
  if (nodeColor) {
    return mix(nodeColor, isDark ? palette.surface : palette.bg, 25);
  }
  return mix(palette.primary, isDark ? palette.surface : palette.bg, 15);
}

function nodeStroke(palette: PaletteColors, nodeColor?: string): string {
  return nodeColor ?? palette.textMuted;
}

function containerFill(
  palette: PaletteColors,
  isDark: boolean,
  nodeColor?: string
): string {
  if (nodeColor) {
    return mix(nodeColor, isDark ? palette.surface : palette.bg, 10);
  }
  return mix(palette.surface, palette.bg, 40);
}

function containerStroke(palette: PaletteColors, nodeColor?: string): string {
  return nodeColor ?? palette.textMuted;
}

// ============================================================
// Main Renderer
// ============================================================

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

export function renderOrg(
  container: HTMLDivElement,
  parsed: ParsedOrg,
  layout: OrgLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number }
): void {
  // Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleOffset = parsed.title ? TITLE_HEIGHT : 0;

  // Compute scale to fit diagram in viewport
  const diagramW = layout.width;
  const diagramH = layout.height + titleOffset;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (height - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(scaleX, scaleY);

  // Center the diagram
  const scaledW = diagramW * scale;
  const scaledH = diagramH * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = DIAGRAM_PADDING;

  // Create SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // Main content group with scale/translate
  const mainG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // Title
  if (parsed.title) {
    const titleEl = mainG
      .append('text')
      .attr('x', diagramW / 2)
      .attr('y', TITLE_FONT_SIZE)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', 'bold')
      .attr('class', 'org-title chart-title')
      .style(
        'cursor',
        onClickItem && parsed.titleLineNumber ? 'pointer' : 'default'
      )
      .text(parsed.title);

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

  // Content group (offset by title)
  const contentG = mainG
    .append('g')
    .attr('transform', `translate(0, ${titleOffset})`);

  // Render container backgrounds (bottom layer)
  for (const c of layout.containers) {
    const cG = contentG
      .append('g')
      .attr('transform', `translate(${c.x}, ${c.y})`)
      .attr('class', 'org-container')
      .attr('data-line-number', String(c.lineNumber)) as GSelection;

    // Toggle attribute for containers that have (or had) children
    if (c.hasChildren) {
      cG.attr('data-node-toggle', c.nodeId)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr(
          'aria-expanded',
          String(!c.hiddenCount)
        )
        .attr(
          'aria-label',
          `${c.label}${c.hiddenCount ? `, +${c.hiddenCount} hidden` : ''}`
        );
    }

    if (onClickItem) {
      cG.style('cursor', 'pointer').on('click', () => {
        onClickItem(c.lineNumber);
      });
    }

    const fill = containerFill(palette, isDark, c.color);
    const stroke = containerStroke(palette, c.color);

    // Background rect
    cG.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', c.width)
      .attr('height', c.height)
      .attr('rx', CONTAINER_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Container label (bold, at top)
    cG.append('text')
      .attr('x', c.width / 2)
      .attr('y', CONTAINER_HEADER_HEIGHT / 2 + CONTAINER_LABEL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', CONTAINER_LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(c.label);

    // Container metadata (below label)
    const metaEntries = Object.entries(c.metadata);
    if (metaEntries.length > 0) {
      const metaStartY = CONTAINER_HEADER_HEIGHT + CONTAINER_META_FONT_SIZE - 2;
      for (let i = 0; i < metaEntries.length; i++) {
        const [key, value] = metaEntries[i];
        const rowY = metaStartY + i * CONTAINER_META_LINE_HEIGHT;

        cG.append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', CONTAINER_META_FONT_SIZE)
          .text(`${key}: `);

        const keyWidth = (key.length + 2) * (CONTAINER_META_FONT_SIZE * 0.6);
        cG.append('text')
          .attr('x', 10 + keyWidth)
          .attr('y', rowY)
          .attr('fill', palette.text)
          .attr('font-size', CONTAINER_META_FONT_SIZE)
          .text(value);
      }
    }

    // "+N" badge for collapsed containers
    if (c.hiddenCount && c.hiddenCount > 0) {
      const badgeText = `+${c.hiddenCount}`;
      const badgeW = Math.max(28, badgeText.length * 8 + 12);
      const badgeH = 18;
      const badgeX = c.width / 2 - badgeW / 2;
      const badgeY = c.height - badgeH - 6;

      const badgeG = cG
        .append('g')
        .attr('class', 'org-collapse-badge')
        .attr('transform', `translate(${badgeX}, ${badgeY})`);

      badgeG
        .append('rect')
        .attr('width', badgeW)
        .attr('height', badgeH)
        .attr('rx', badgeH / 2)
        .attr('fill', palette.primary)
        .attr('opacity', 0.85);

      badgeG
        .append('text')
        .attr('x', badgeW / 2)
        .attr('y', badgeH / 2 + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ffffff')
        .attr('font-size', 10)
        .attr('font-weight', 'bold')
        .text(badgeText);
    }
  }

  // Render edges
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const pathParts: string[] = [];
    pathParts.push(`M ${edge.points[0].x} ${edge.points[0].y}`);
    for (let i = 1; i < edge.points.length; i++) {
      pathParts.push(`L ${edge.points[i].x} ${edge.points[i].y}`);
    }

    contentG
      .append('path')
      .attr('d', pathParts.join(' '))
      .attr('fill', 'none')
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('class', 'org-edge');
  }

  // Collect container node IDs so we can skip them in card rendering
  const containerNodeIds = new Set(layout.containers.map((c) => c.nodeId));

  // Render node cards (top layer) — skip containers (already drawn as background boxes)
  for (const node of layout.nodes) {
    if (containerNodeIds.has(node.id)) continue;

    const nodeG = contentG
      .append('g')
      .attr(
        'transform',
        `translate(${node.x - node.width / 2}, ${node.y})`
      )
      .attr('class', 'org-node')
      .attr('data-line-number', String(node.lineNumber)) as GSelection;

    // Toggle attribute for nodes that have (or had) children
    if (node.hasChildren) {
      nodeG
        .attr('data-node-toggle', node.id)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-expanded', String(!node.hiddenCount))
        .attr(
          'aria-label',
          `${node.label}${node.hiddenCount ? `, +${node.hiddenCount} hidden` : ''}`
        );
    }

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    // Card background
    const fill = nodeFill(palette, isDark, node.color);
    const stroke = nodeStroke(palette, node.color);

    const rect = nodeG
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', CARD_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Container nodes: dashed border
    if (node.isContainer) {
      rect.attr('stroke-dasharray', '6 3');
    }

    // Label
    nodeG
      .append('text')
      .attr('x', node.width / 2)
      .attr('y', HEADER_HEIGHT / 2 + LABEL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(node.label);

    // Metadata
    const metaEntries = Object.entries(node.metadata);
    if (metaEntries.length > 0) {
      // Header separator line
      nodeG
        .append('line')
        .attr('x1', 0)
        .attr('y1', HEADER_HEIGHT)
        .attr('x2', node.width)
        .attr('y2', HEADER_HEIGHT)
        .attr('stroke', stroke)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);

      // Metadata rows
      const metaStartY = HEADER_HEIGHT + SEPARATOR_GAP + META_FONT_SIZE;
      for (let i = 0; i < metaEntries.length; i++) {
        const [key, value] = metaEntries[i];
        const rowY = metaStartY + i * META_LINE_HEIGHT;

        // Key (muted)
        nodeG
          .append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', META_FONT_SIZE)
          .text(`${key}: `);

        // Value (normal)
        const keyWidth = (key.length + 2) * (META_FONT_SIZE * 0.6);
        nodeG
          .append('text')
          .attr('x', 10 + keyWidth)
          .attr('y', rowY)
          .attr('fill', palette.text)
          .attr('font-size', META_FONT_SIZE)
          .text(value);
      }
    }

    // "+N" badge for collapsed nodes
    if (node.hiddenCount && node.hiddenCount > 0) {
      const badgeText = `+${node.hiddenCount}`;
      const badgeW = Math.max(28, badgeText.length * 8 + 12);
      const badgeH = 18;
      const badgeX = node.width / 2 - badgeW / 2;
      const badgeY = node.height - badgeH - 4;

      const badgeG = nodeG
        .append('g')
        .attr('class', 'org-collapse-badge')
        .attr('transform', `translate(${badgeX}, ${badgeY})`);

      badgeG
        .append('rect')
        .attr('width', badgeW)
        .attr('height', badgeH)
        .attr('rx', badgeH / 2)
        .attr('fill', palette.primary)
        .attr('opacity', 0.85);

      badgeG
        .append('text')
        .attr('x', badgeW / 2)
        .attr('y', badgeH / 2 + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ffffff')
        .attr('font-size', 10)
        .attr('font-weight', 'bold')
        .text(badgeText);
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderOrgForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseOrg(content, palette);
  if (parsed.error || parsed.roots.length === 0) return '';

  const layout = layoutOrg(parsed);
  const isDark = theme === 'dark';

  // Create offscreen container
  const container = document.createElement('div');
  const titleOffset = parsed.title ? TITLE_HEIGHT : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight =
    layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    renderOrg(container, parsed, layout, palette, isDark, undefined, {
      width: exportWidth,
      height: exportHeight,
    });

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
