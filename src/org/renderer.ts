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

// Legend
const LEGEND_RADIUS = 6;
const LEGEND_DOT_R = 5;
const LEGEND_DOT_TEXT_GAP = 6;
const LEGEND_ENTRY_GAP = 12;
const LEGEND_PAD = 10;
const LEGEND_HEADER_H = 20;
const LEGEND_ENTRY_H = 18;
const LEGEND_FONT_SIZE = 11;
const LEGEND_MAX_PER_ROW = 3;
const LEGEND_CHAR_WIDTH = 7.5;

// Eye icon (12×12 viewBox, scaled from 0,0 to 12,12)
const EYE_ICON_SIZE = 12;
const EYE_ICON_GAP = 6;
// Open eye: elliptical outline + circle pupil
const EYE_OPEN_PATH =
  'M1 6C1 6 3 2 6 2C9 2 11 6 11 6C11 6 9 10 6 10C3 10 1 6 1 6Z';
const EYE_PUPIL_CX = 6;
const EYE_PUPIL_CY = 6;
const EYE_PUPIL_R = 1.8;
// Closed eye: same outline + diagonal slash
const EYE_SLASH_PATH = 'M2 2L10 10';

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
  exportDims?: { width?: number; height?: number },
  activeTagGroup?: string | null,
  hiddenAttributes?: Set<string>
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

  // Build display name map from tag groups (lowercase key → original casing)
  const displayNames = new Map<string, string>();
  for (const group of parsed.tagGroups) {
    displayNames.set(group.name.toLowerCase(), group.name);
  }

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
        .attr('aria-label', c.label);
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
      // Compute max key width so values align vertically
      const metaDisplayKeys = metaEntries.map(([k]) => displayNames.get(k) ?? k);
      const maxKeyLen = Math.max(...metaDisplayKeys.map((k) => k.length));
      const valueX = 10 + (maxKeyLen + 2) * (CONTAINER_META_FONT_SIZE * 0.6);

      const metaStartY = CONTAINER_HEADER_HEIGHT + CONTAINER_META_FONT_SIZE - 2;
      for (let i = 0; i < metaEntries.length; i++) {
        const [, value] = metaEntries[i];
        const displayKey = metaDisplayKeys[i];
        const rowY = metaStartY + i * CONTAINER_META_LINE_HEIGHT;

        cG.append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', CONTAINER_META_FONT_SIZE)
          .text(`${displayKey}: `);

        cG.append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', palette.text)
          .attr('font-size', CONTAINER_META_FONT_SIZE)
          .text(value);
      }
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
        .attr('aria-label', node.label);
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

      // Metadata rows — compute max key width so values align vertically
      const metaDisplayKeys = metaEntries.map(([k]) => displayNames.get(k) ?? k);
      const maxKeyLen = Math.max(...metaDisplayKeys.map((k) => k.length));
      const valueX = 10 + (maxKeyLen + 2) * (META_FONT_SIZE * 0.6);

      const metaStartY = HEADER_HEIGHT + SEPARATOR_GAP + META_FONT_SIZE;
      for (let i = 0; i < metaEntries.length; i++) {
        const [, value] = metaEntries[i];
        const displayKey = metaDisplayKeys[i];
        const rowY = metaStartY + i * META_LINE_HEIGHT;

        // Key (muted)
        nodeG
          .append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', META_FONT_SIZE)
          .text(`${displayKey}: `);

        // Value (normal)
        nodeG
          .append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', palette.text)
          .attr('font-size', META_FONT_SIZE)
          .text(value);
      }
    }

  }

  // Render legend — skip entirely in export mode; hide non-active groups when one is active
  if (!exportDims) for (const group of layout.legend) {
    const isActive =
      activeTagGroup != null &&
      group.name.toLowerCase() === activeTagGroup.toLowerCase();

    // When a group is active, skip rendering all other groups
    if (activeTagGroup != null && !isActive) continue;

    const gEl = contentG
      .append('g')
      .attr('transform', `translate(${group.x}, ${group.y})`)
      .attr('class', 'org-legend-group')
      .attr('data-legend-group', group.name.toLowerCase())
      .style('cursor', 'pointer');

    // Background rect
    const legendFill = mix(palette.surface, palette.bg, 40);
    const bgRect = gEl
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', group.width)
      .attr('height', group.height)
      .attr('rx', LEGEND_RADIUS)
      .attr('fill', legendFill);

    if (isActive) {
      bgRect
        .attr('stroke', palette.primary)
        .attr('stroke-opacity', 0.8)
        .attr('stroke-width', 2);
    } else {
      bgRect
        .attr('stroke', palette.textMuted)
        .attr('stroke-opacity', 0.35)
        .attr('stroke-width', NODE_STROKE_WIDTH);
    }

    // Group name header
    gEl
      .append('text')
      .attr('x', LEGEND_PAD)
      .attr('y', LEGEND_HEADER_H / 2 + LEGEND_FONT_SIZE / 2 - 2)
      .attr('fill', palette.text)
      .attr('font-size', LEGEND_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(group.name);

    // Eye icon for visibility toggle (interactive only, not export)
    if (hiddenAttributes !== undefined && !exportDims) {
      const groupKey = group.name.toLowerCase();
      const isHidden = hiddenAttributes.has(groupKey);
      const eyeX =
        LEGEND_PAD + group.name.length * LEGEND_CHAR_WIDTH + EYE_ICON_GAP;
      const eyeY = (LEGEND_HEADER_H - EYE_ICON_SIZE) / 2;

      const eyeG = gEl
        .append('g')
        .attr('class', 'org-legend-eye')
        .attr('data-legend-visibility', groupKey)
        .attr('transform', `translate(${eyeX}, ${eyeY})`);

      // Transparent hit area
      eyeG
        .append('rect')
        .attr('x', -4)
        .attr('y', -4)
        .attr('width', EYE_ICON_SIZE + 8)
        .attr('height', EYE_ICON_SIZE + 8)
        .attr('fill', 'transparent');

      // Eye outline
      eyeG
        .append('path')
        .attr('d', EYE_OPEN_PATH)
        .attr('fill', isHidden ? 'none' : palette.textMuted)
        .attr('fill-opacity', isHidden ? 0 : 0.15)
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1.2)
        .attr('opacity', isHidden ? 0.5 : 0.7);

      if (!isHidden) {
        // Pupil (only when visible)
        eyeG
          .append('circle')
          .attr('cx', EYE_PUPIL_CX)
          .attr('cy', EYE_PUPIL_CY)
          .attr('r', EYE_PUPIL_R)
          .attr('fill', palette.textMuted)
          .attr('opacity', 0.7);
      } else {
        // Slash through the eye (hidden state)
        eyeG
          .append('line')
          .attr('x1', 2)
          .attr('y1', 2)
          .attr('x2', 10)
          .attr('y2', 10)
          .attr('stroke', palette.textMuted)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.5);
      }
    }

    // Entries: colored dot + value label
    for (let i = 0; i < group.entries.length; i++) {
      const entry = group.entries[i];
      const row = Math.floor(i / LEGEND_MAX_PER_ROW);
      const colStart = row * LEGEND_MAX_PER_ROW;

      // Compute x position from preceding entries in the same row
      let entryX = LEGEND_PAD;
      for (let j = colStart; j < i; j++) {
        const prev = group.entries[j];
        entryX +=
          LEGEND_DOT_R * 2 +
          LEGEND_DOT_TEXT_GAP +
          prev.value.length * LEGEND_CHAR_WIDTH +
          LEGEND_ENTRY_GAP;
      }

      const entryY =
        LEGEND_HEADER_H + row * LEGEND_ENTRY_H + LEGEND_ENTRY_H / 2;

      // Colored dot
      gEl
        .append('circle')
        .attr('cx', entryX + LEGEND_DOT_R)
        .attr('cy', entryY)
        .attr('r', LEGEND_DOT_R)
        .attr('fill', entry.color);

      // Value label
      gEl
        .append('text')
        .attr('x', entryX + LEGEND_DOT_R * 2 + LEGEND_DOT_TEXT_GAP)
        .attr('y', entryY + LEGEND_FONT_SIZE / 2 - 2)
        .attr('fill', palette.text)
        .attr('font-size', LEGEND_FONT_SIZE)
        .text(entry.value);
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

  // Extract hide option for export: cards sized without hidden attributes
  const hideOption = parsed.options?.['hide'];
  const exportHidden = hideOption
    ? new Set(hideOption.split(',').map((s) => s.trim().toLowerCase()))
    : undefined;

  const layout = layoutOrg(parsed, undefined, undefined, exportHidden);
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
    // No hiddenAttributes passed to renderOrg — export never shows eye icons
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
