// ============================================================
// Wireframe Diagram Renderer (D3-based SVG)
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import { renderLegendD3 } from '../utils/legend-d3';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
} from '../utils/legend-types';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';
import { measureLegendText } from '../utils/legend-constants';
import type { WireframeElement, ParsedWireframe } from './types';
import type { WireframeLayout, WireframeLayoutNode } from './layout';

// ============================================================
// Constants
// ============================================================

const INPUT_CORNER = 4;
const BUTTON_CORNER = 6;
const GROUP_CORNER = 8;

/** Semantic color mapping — wireframe-only, not a palette schema change (ADR-2) */
const SEMANTIC_COLORS: Record<string, (p: PaletteColors) => string> = {
  destructive: (p) => p.destructive,
  success: (p) => p.colors.green,
  warning: (p) => p.colors.yellow,
  info: (p) => p.colors.blue,
};

function getSemanticColor(
  state: string,
  palette: PaletteColors
): string | null {
  const fn = SEMANTIC_COLORS[state];
  return fn ? fn(palette) : null;
}

function getElementSemanticColor(
  el: WireframeElement,
  palette: PaletteColors
): string | null {
  for (const s of el.states) {
    const c = getSemanticColor(s, palette);
    if (c) return c;
  }
  return null;
}

// ============================================================
// Types
// ============================================================

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

interface RenderContext {
  palette: PaletteColors;
  isTransparent: boolean;
  isDark: boolean;
  showGroupLabels: boolean;
}

// ============================================================
// Main Renderer
// ============================================================

export interface WireframeRenderOptions {
  exportDims?: { width?: number; height?: number };
  theme?: string;
  onClickItem?: (lineNumber: number) => void;
  /** Controls group state */
  controlsExpanded?: boolean;
  fitWidth?: boolean;
  showGroupLabels?: boolean;
  onControlsExpand?: () => void;
  onControlsToggle?: (id: string, active: boolean) => void;
}

export function renderWireframe(
  container: HTMLDivElement,
  parsed: ParsedWireframe,
  layout: WireframeLayout,
  palette: PaletteColors,
  isDark: boolean,
  _onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number },
  theme?: string,
  options?: WireframeRenderOptions
): void {
  // Merge legacy positional args with options
  const opts = options ?? {};
  const effectiveExportDims = opts.exportDims ?? exportDims;
  const effectiveTheme = opts.theme ?? theme;
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const isExport = !!effectiveExportDims;
  const width = effectiveExportDims?.width ?? container.clientWidth;
  const height = effectiveExportDims?.height ?? container.clientHeight;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${layout.width} ${layout.height}`)
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  if (isExport) {
    svg.attr('width', width).attr('height', height);
  } else {
    // Fill width, scale height proportionally — container scrolls vertically
    svg
      .attr('width', '100%')
      .attr('height', 'auto')
      .attr('preserveAspectRatio', 'xMidYMin meet')
      .style('display', 'block');
  }

  const ctx: RenderContext = {
    palette,
    isTransparent: effectiveTheme === 'transparent',
    isDark,
    showGroupLabels: opts.showGroupLabels ?? true,
  };

  // Background
  if (!ctx.isTransparent) {
    svg
      .append('rect')
      .attr('width', layout.width)
      .attr('height', layout.height)
      .attr('fill', palette.bg)
      .attr('rx', 8);
  }

  const mainG = svg.append('g').attr('transform', `translate(20, 20)`);

  // Title
  let titleOffset = 0;
  if (parsed.title) {
    mainG
      .append('text')
      .attr('x', 0)
      .attr('y', TITLE_FONT_SIZE)
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .text(parsed.title);
    titleOffset = layout.titleHeight;
  }

  // Legend with gear pill (controls group)
  if (!isExport) {
    const titleWidth = parsed.title
      ? measureLegendText(parsed.title, TITLE_FONT_SIZE) + 16
      : 0;
    const legendConfig: LegendConfig = {
      groups: [],
      position: { placement: 'top-center', titleRelation: 'inline-with-title' },
      mode: 'fixed',
      titleWidth,
      controlsGroup: {
        toggles: [
          {
            id: 'fit-width',
            type: 'toggle',
            label: 'Fit Width',
            active: opts.fitWidth ?? true,
            onToggle: (active: boolean) =>
              opts.onControlsToggle?.('fit-width', active),
          },
          {
            id: 'group-labels',
            type: 'toggle',
            label: 'Labels',
            active: opts.showGroupLabels ?? true,
            onToggle: (active: boolean) =>
              opts.onControlsToggle?.('group-labels', active),
          },
        ],
      },
    };
    const legendState: LegendState = {
      activeGroup: null,
      controlsExpanded: opts.controlsExpanded ?? false,
    };
    const legendPalette = {
      text: palette.text,
      textMuted: palette.textMuted,
      bg: palette.bg,
      surface: palette.surface,
      primary: palette.primary,
    };
    const legendCallbacks: LegendCallbacks = {
      onControlsExpand: opts.onControlsExpand,
      onControlsToggle: opts.onControlsToggle,
    };
    const legendG = mainG.append('g').attr('class', 'wireframe-legend');
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      legendPalette,
      isDark,
      legendCallbacks,
      layout.width - 40
    );
  }

  const contentG = mainG
    .append('g')
    .attr('transform', `translate(0, ${titleOffset})`);

  // Render main nodes
  for (const node of layout.nodes) {
    renderNode(contentG, node, ctx, 0);
  }

  // Render modals
  if (layout.modalNodes.length > 0) {
    const modalG = contentG.append('g').attr('class', 'wireframe-modals');
    for (const modalNode of layout.modalNodes) {
      renderModal(modalG, modalNode, ctx);
    }
  }
}

// ============================================================
// Node Rendering
// ============================================================

function renderNode(
  parent: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext,
  depth: number
): void {
  const el = node.element;
  const g = parent
    .append('g')
    .attr('transform', `translate(${node.x}, ${node.y})`)
    .attr('data-line-number', el.lineNumber);

  // Apply disabled state
  if (el.states.includes('disabled')) {
    g.attr('opacity', 0.5);
  }

  // Skeleton override: render as grey placeholder
  if (el.isSkeleton && el.type !== 'skeleton') {
    renderSkeletonPlaceholder(g, node, ctx);
    return;
  }

  switch (el.type) {
    case 'group':
      renderGroup(g, node, ctx, depth);
      break;
    case 'textInput':
      renderTextInput(g, node, ctx);
      break;
    case 'button':
      renderButton(g, node, ctx);
      break;
    case 'dropdown':
      renderDropdown(g, node, ctx);
      break;
    case 'checkbox':
      renderCheckbox(g, node, ctx);
      break;
    case 'radio':
      renderRadio(g, node, ctx);
      break;
    case 'heading':
      renderHeading(g, node, ctx);
      break;
    case 'divider':
      renderDivider(g, node, ctx);
      break;
    case 'text':
      renderText(g, node, ctx);
      break;
    case 'listItem':
      renderListItem(g, node, ctx);
      break;
    case 'nav':
      renderNav(g, node, ctx);
      break;
    case 'tabs':
      renderTabs(g, node, ctx);
      break;
    case 'table':
      renderTable(g, node, ctx);
      break;
    case 'image':
      renderImage(g, node, ctx);
      break;
    case 'skeleton':
      renderSkeletonBlock(g, node, ctx);
      break;
    case 'alert':
      renderAlert(g, node, ctx);
      break;
    case 'progress':
      renderProgress(g, node, ctx);
      break;
    case 'chart':
      renderChart(g, node, ctx);
      break;
    default:
      renderText(g, node, ctx);
  }
}

// ============================================================
// Element Renderers — Visual Archetypes
// ============================================================

function renderGroup(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext,
  depth: number
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;

  // Inline rows and label-field wrappers — no group chrome, just render children
  if (el.metadata._inlineRow === 'true' || el.metadata._labelField === 'true') {
    for (const child of node.children) {
      renderNode(g, child, ctx, depth);
    }
    return;
  }

  // Depth-based fill shading: mix textMuted into bg for visible section tints.
  // mix(a, b, pct) — pct is 0-100 where 100 = 100% of a.
  // depth 0 → 12% textMuted, depth 1 → 7%, depth 2 → 4%, depth 3+ → 2%
  const tintSteps = [12, 7, 4, 2];
  const tintPct = tintSteps[Math.min(depth, tintSteps.length - 1)];
  const fillColor = mix(palette.textMuted, palette.bg, tintPct);

  // Container background — solid border + depth-based shading
  if (isTransparent) {
    g.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', 'none')
      .attr('stroke', palette.border)
      .attr('stroke-width', 1)
      .attr('rx', GROUP_CORNER);
  } else {
    g.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', fillColor)
      .attr('stroke', palette.border)
      .attr('stroke-width', 1)
      .attr('rx', GROUP_CORNER);
  }

  // Label
  if (el.label && ctx.showGroupLabels) {
    g.append('text')
      .attr('x', 10)
      .attr('y', 18)
      .attr('fill', palette.textMuted)
      .attr('font-size', 11)
      .attr('font-weight', '600')
      .attr('letter-spacing', '0.5px')
      .text(el.label.toUpperCase());
  }

  // Collapsed indicator
  if (el.states.includes('collapsed')) {
    g.append('text')
      .attr('x', node.width - 20)
      .attr('y', 18)
      .attr('fill', palette.textMuted)
      .attr('font-size', 12)
      .text('▶');
    return;
  }

  // Scrollable indicator
  if (el.states.includes('scrollable')) {
    g.append('rect')
      .attr('x', node.width - 6)
      .attr('y', 28)
      .attr('width', 3)
      .attr('height', Math.min(node.height - 36, 40))
      .attr('fill', palette.border)
      .attr('rx', 1.5);
  }

  // Render children at increased depth
  for (const child of node.children) {
    renderNode(g, child, ctx, depth + 1);
  }
}

function renderTextInput(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;
  const h = node.height;

  // Input box
  g.append('rect')
    .attr('width', node.width)
    .attr('height', h)
    .attr('fill', isTransparent ? 'none' : palette.bg)
    .attr('stroke', palette.border)
    .attr('rx', INPUT_CORNER);

  if (el.fieldVariant === 'password') {
    // Dots for password
    g.append('text')
      .attr('x', 10)
      .attr('y', h / 2 + 4)
      .attr('fill', palette.text)
      .attr('font-size', 16)
      .text('• • • • • •');
  } else {
    // Placeholder text
    g.append('text')
      .attr('x', 10)
      .attr('y', h / 2 + 4)
      .attr('fill', palette.textMuted)
      .attr('font-size', 13)
      .text(el.label || 'Text input');
  }

  // Cursor line
  if (el.fieldVariant !== 'password') {
    const textWidth = Math.min(
      (el.label || 'Text input').length * 7 + 14,
      node.width - 20
    );
    g.append('line')
      .attr('x1', textWidth)
      .attr('y1', 8)
      .attr('x2', textWidth)
      .attr('y2', h - 8)
      .attr('stroke', palette.primary)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.6);
  }

  // Textarea multi-line indicator
  if (el.fieldVariant === 'textarea') {
    // Grip handle
    for (let i = 0; i < 3; i++) {
      g.append('line')
        .attr('x1', node.width - 12 + i * 3)
        .attr('y1', h - 4)
        .attr('x2', node.width - 4)
        .attr('y2', h - 12 + i * 3)
        .attr('stroke', palette.border)
        .attr('stroke-width', 1);
    }
  }
}

function renderButton(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;
  const isGhost = el.states.includes('ghost');
  const semanticColor = getElementSemanticColor(el, palette);
  const isPrimary = el.states.includes('primary');

  let fill = isPrimary ? palette.primary : palette.secondary;
  let textColor = palette.bg;

  if (semanticColor) {
    fill = semanticColor;
  }

  if (isGhost || isTransparent) {
    // Outline button
    g.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', 'none')
      .attr('stroke', fill)
      .attr('stroke-width', 1.5)
      .attr('rx', BUTTON_CORNER);
    textColor = fill;
  } else {
    g.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', fill)
      .attr('rx', BUTTON_CORNER);
  }

  g.append('text')
    .attr('x', node.width / 2)
    .attr('y', node.height / 2 + 4)
    .attr('fill', textColor)
    .attr('font-size', 13)
    .attr('font-weight', '600')
    .attr('text-anchor', 'middle')
    .text(el.label);
}

function renderDropdown(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;

  // Select box
  g.append('rect')
    .attr('width', node.width)
    .attr('height', node.height)
    .attr('fill', isTransparent ? 'none' : palette.bg)
    .attr('stroke', palette.border)
    .attr('rx', INPUT_CORNER);

  // Selected text
  g.append('text')
    .attr('x', 10)
    .attr('y', node.height / 2 + 4)
    .attr('fill', palette.text)
    .attr('font-size', 13)
    .text(el.label || (el.options?.[0] ?? 'Select...'));

  // Chevron
  const cx = node.width - 16;
  const cy = node.height / 2;
  g.append('path')
    .attr('d', `M${cx - 4},${cy - 2} L${cx},${cy + 2} L${cx + 4},${cy - 2}`)
    .attr('fill', 'none')
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1.5);
}

function renderCheckbox(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette } = ctx;
  const el = node.element;
  const isToggle = el.states.includes('toggle');

  if (isToggle) {
    // Toggle switch
    const trackW = 32;
    const trackH = 18;
    const cy = node.height / 2;

    g.append('rect')
      .attr('x', 0)
      .attr('y', cy - trackH / 2)
      .attr('width', trackW)
      .attr('height', trackH)
      .attr('rx', trackH / 2)
      .attr('fill', el.checked ? palette.primary : palette.border);

    g.append('circle')
      .attr('cx', el.checked ? trackW - trackH / 2 : trackH / 2)
      .attr('cy', cy)
      .attr('r', trackH / 2 - 2)
      .attr('fill', palette.bg);

    if (el.label) {
      g.append('text')
        .attr('x', trackW + 8)
        .attr('y', cy + 4)
        .attr('fill', palette.text)
        .attr('font-size', 13)
        .text(el.label);
    }
  } else {
    // Checkbox square
    const boxSize = 16;
    const cy = node.height / 2;

    g.append('rect')
      .attr('x', 0)
      .attr('y', cy - boxSize / 2)
      .attr('width', boxSize)
      .attr('height', boxSize)
      .attr('fill', el.checked ? palette.primary : 'none')
      .attr('stroke', el.checked ? palette.primary : palette.border)
      .attr('rx', 3);

    // Check mark
    if (el.checked) {
      g.append('path')
        .attr('d', `M${3},${cy} L${6},${cy + 3} L${13},${cy - 4}`)
        .attr('fill', 'none')
        .attr('stroke', palette.bg)
        .attr('stroke-width', 2);
    }

    if (el.label) {
      g.append('text')
        .attr('x', boxSize + 8)
        .attr('y', cy + 4)
        .attr('fill', palette.text)
        .attr('font-size', 13)
        .text(el.label);
    }
  }
}

function renderRadio(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette } = ctx;
  const el = node.element;
  const r = 8;
  const cy = node.height / 2;

  // Outer circle
  g.append('circle')
    .attr('cx', r)
    .attr('cy', cy)
    .attr('r', r)
    .attr('fill', 'none')
    .attr('stroke', el.selected ? palette.primary : palette.border)
    .attr('stroke-width', 1.5);

  // Inner dot
  if (el.selected) {
    g.append('circle')
      .attr('cx', r)
      .attr('cy', cy)
      .attr('r', 4)
      .attr('fill', palette.primary);
  }

  g.append('text')
    .attr('x', r * 2 + 8)
    .attr('y', cy + 4)
    .attr('fill', palette.text)
    .attr('font-size', 13)
    .text(el.label);
}

function renderHeading(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette } = ctx;
  const el = node.element;
  const isH1 = el.headingLevel === 1;

  g.append('text')
    .attr('x', 0)
    .attr('y', isH1 ? 28 : 22)
    .attr('fill', palette.text)
    .attr('font-size', isH1 ? 22 : 16)
    .attr('font-weight', 'bold')
    .text(el.label);
}

function renderDivider(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette } = ctx;

  g.append('line')
    .attr('x1', 0)
    .attr('y1', node.height / 2)
    .attr('x2', node.width)
    .attr('y2', node.height / 2)
    .attr('stroke', palette.border)
    .attr('stroke-width', 1);
}

function renderText(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette } = ctx;
  const el = node.element;

  // Check if this is a label-field wrapper
  if (el.metadata._labelField === 'true' && el.children.length >= 2) {
    for (const child of node.children) {
      renderNode(g, child, ctx, 0);
    }
    return;
  }

  const color = el.labelFor ? palette.textMuted : palette.text;

  g.append('text')
    .attr('x', 0)
    .attr('y', 15)
    .attr('fill', color)
    .attr('font-size', 13)
    .text(el.label);
}

function renderListItem(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette } = ctx;
  const el = node.element;

  // Bullet
  g.append('circle')
    .attr('cx', 4)
    .attr('cy', node.height / 2)
    .attr('r', 2.5)
    .attr('fill', palette.textMuted);

  g.append('text')
    .attr('x', 14)
    .attr('y', node.height / 2 + 4)
    .attr('fill', palette.text)
    .attr('font-size', 13)
    .text(el.label);
}

function renderNav(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette } = ctx;
  const el = node.element;

  // Background bar
  g.append('rect')
    .attr('width', node.width)
    .attr('height', node.height)
    .attr('fill', mix(palette.surface, palette.bg, 0.3))
    .attr('rx', 4);

  // Nav items horizontal
  let x = 12;
  for (const child of el.children) {
    const isActive = child.states.includes('active');
    g.append('text')
      .attr('x', x)
      .attr('y', node.height / 2 + 4)
      .attr('fill', isActive ? palette.primary : palette.text)
      .attr('font-size', 13)
      .attr('font-weight', isActive ? '600' : 'normal')
      .text(child.label);

    // Active underline
    if (isActive) {
      const textW = child.label.length * 7.5;
      g.append('line')
        .attr('x1', x)
        .attr('y1', node.height - 4)
        .attr('x2', x + textW)
        .attr('y2', node.height - 4)
        .attr('stroke', palette.primary)
        .attr('stroke-width', 2);
    }

    x += child.label.length * 7.5 + 24;
  }
}

function renderTabs(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette } = ctx;
  const el = node.element;

  // Bottom border
  g.append('line')
    .attr('x1', 0)
    .attr('y1', node.height - 1)
    .attr('x2', node.width)
    .attr('y2', node.height - 1)
    .attr('stroke', palette.border)
    .attr('stroke-width', 1);

  // Tab items
  let x = 0;
  for (const child of el.children) {
    const isActive = child.states.includes('active');
    const tabW = child.label.length * 7.5 + 24;

    if (isActive) {
      // Active tab bottom border
      g.append('line')
        .attr('x1', x)
        .attr('y1', node.height - 1)
        .attr('x2', x + tabW)
        .attr('y2', node.height - 1)
        .attr('stroke', palette.primary)
        .attr('stroke-width', 2);
    }

    g.append('text')
      .attr('x', x + 12)
      .attr('y', node.height / 2 + 4)
      .attr('fill', isActive ? palette.primary : palette.textMuted)
      .attr('font-size', 13)
      .attr('font-weight', isActive ? '600' : 'normal')
      .text(child.label);

    x += tabW;
  }
}

function renderTable(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;
  const headers = el.tableHeaders || [];
  const data = el.tableData || [];
  const isSkeleton = el.tableRows !== undefined && el.tableCols !== undefined;

  const cols = headers.length || el.tableCols || 3;
  const colW = node.width / cols;
  const headerH = 32;
  const rowH = 28;

  // Table border
  g.append('rect')
    .attr('width', node.width)
    .attr('height', node.height)
    .attr('fill', 'none')
    .attr('stroke', palette.border)
    .attr('rx', 4);

  // Header row
  g.append('rect')
    .attr('width', node.width)
    .attr('height', headerH)
    .attr(
      'fill',
      isTransparent ? 'none' : mix(palette.surface, palette.bg, 0.3)
    )
    .attr('rx', 4);

  for (let c = 0; c < cols; c++) {
    const label = headers[c] || `Col ${c + 1}`;
    g.append('text')
      .attr('x', c * colW + 10)
      .attr('y', headerH / 2 + 4)
      .attr('fill', palette.text)
      .attr('font-size', 12)
      .attr('font-weight', '600')
      .text(label);
  }

  // Header separator
  g.append('line')
    .attr('x1', 0)
    .attr('y1', headerH)
    .attr('x2', node.width)
    .attr('y2', headerH)
    .attr('stroke', palette.border);

  // Data rows or skeleton rows
  const rowCount = isSkeleton ? el.tableRows || 3 : data.length;
  for (let r = 0; r < rowCount; r++) {
    const ry = headerH + r * rowH;

    // Row separator
    if (r > 0) {
      g.append('line')
        .attr('x1', 0)
        .attr('y1', ry)
        .attr('x2', node.width)
        .attr('y2', ry)
        .attr('stroke', palette.border)
        .attr('opacity', 0.3);
    }

    for (let c = 0; c < cols; c++) {
      if (isSkeleton) {
        // Skeleton placeholder
        g.append('rect')
          .attr('x', c * colW + 10)
          .attr('y', ry + 8)
          .attr('width', colW * 0.6)
          .attr('height', 12)
          .attr('fill', palette.border)
          .attr('opacity', 0.3)
          .attr('rx', 2);
      } else if (data[r]) {
        const cellText = data[r][c] || '';
        renderTableCell(g, cellText, c * colW + 10, ry, colW - 20, rowH, ctx);
      }
    }
  }
}

/** Render a table cell — detects button/checkbox patterns in cell text */
function renderTableCell(
  g: GSelection,
  text: string,
  x: number,
  y: number,
  maxW: number,
  rowH: number,
  ctx: RenderContext
): void {
  const { palette } = ctx;
  const trimmed = text.trim();

  // Button pattern: `(Label)` or `(Label) | state`
  const btnMatch = trimmed.match(/^\(([^)]+)\)(?:\s*\|\s*(.+))?$/);
  if (btnMatch) {
    const label = btnMatch[1];
    const stateStr = btnMatch[2]?.trim().toLowerCase();
    const isGhost = stateStr === 'ghost';
    const isDestructive = stateStr === 'destructive';
    const fill = isDestructive ? palette.destructive : palette.primary;
    const btnW = Math.min(label.length * 7 + 16, maxW);
    const btnH = 20;
    const by = y + (rowH - btnH) / 2;

    if (isGhost) {
      g.append('rect')
        .attr('x', x)
        .attr('y', by)
        .attr('width', btnW)
        .attr('height', btnH)
        .attr('fill', 'none')
        .attr('stroke', fill)
        .attr('stroke-width', 1)
        .attr('rx', 3);
      g.append('text')
        .attr('x', x + btnW / 2)
        .attr('y', by + btnH / 2 + 3)
        .attr('fill', fill)
        .attr('font-size', 10)
        .attr('font-weight', '600')
        .attr('text-anchor', 'middle')
        .text(label);
    } else {
      g.append('rect')
        .attr('x', x)
        .attr('y', by)
        .attr('width', btnW)
        .attr('height', btnH)
        .attr('fill', fill)
        .attr('rx', 3);
      g.append('text')
        .attr('x', x + btnW / 2)
        .attr('y', by + btnH / 2 + 3)
        .attr('fill', palette.bg)
        .attr('font-size', 10)
        .attr('font-weight', '600')
        .attr('text-anchor', 'middle')
        .text(label);
    }
    return;
  }

  // Checkbox pattern: `<x>` or `< >`
  if (/^<\s*x?\s*>$/.test(trimmed)) {
    const checked = /x/i.test(trimmed);
    const boxSize = 12;
    const bx = x;
    const by = y + (rowH - boxSize) / 2;
    g.append('rect')
      .attr('x', bx)
      .attr('y', by)
      .attr('width', boxSize)
      .attr('height', boxSize)
      .attr('fill', checked ? palette.primary : 'none')
      .attr('stroke', checked ? palette.primary : palette.border)
      .attr('rx', 2);
    if (checked) {
      g.append('path')
        .attr(
          'd',
          `M${bx + 2},${by + boxSize / 2} L${bx + 4},${by + boxSize / 2 + 2} L${bx + 10},${by + 2}`
        )
        .attr('fill', 'none')
        .attr('stroke', palette.bg)
        .attr('stroke-width', 1.5);
    }
    return;
  }

  // Plain text
  g.append('text')
    .attr('x', x)
    .attr('y', y + rowH / 2 + 4)
    .attr('fill', palette.text)
    .attr('font-size', 12)
    .text(trimmed);
}

function renderImage(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;
  const isRound = el.imageHint === 'round';

  if (isRound) {
    const r = Math.min(node.width, node.height) / 2;
    const cx = node.width / 2;
    const cy = node.height / 2;

    g.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', r)
      .attr(
        'fill',
        isTransparent ? 'none' : mix(palette.border, palette.bg, 0.5)
      )
      .attr('stroke', palette.border);

    // Diagonal cross
    g.append('line')
      .attr('x1', cx - r * 0.7)
      .attr('y1', cy - r * 0.7)
      .attr('x2', cx + r * 0.7)
      .attr('y2', cy + r * 0.7)
      .attr('stroke', palette.border);
    g.append('line')
      .attr('x1', cx + r * 0.7)
      .attr('y1', cy - r * 0.7)
      .attr('x2', cx - r * 0.7)
      .attr('y2', cy + r * 0.7)
      .attr('stroke', palette.border);
  } else {
    g.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr(
        'fill',
        isTransparent ? 'none' : mix(palette.border, palette.bg, 0.5)
      )
      .attr('stroke', palette.border)
      .attr('rx', 4);

    // Diagonal cross
    g.append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', node.width)
      .attr('y2', node.height)
      .attr('stroke', palette.border);
    g.append('line')
      .attr('x1', node.width)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', node.height)
      .attr('stroke', palette.border);
  }
}

function renderSkeletonBlock(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  // Skeleton block: render children as grey placeholders
  for (const child of node.children) {
    renderSkeletonPlaceholder(g, child, ctx);
  }
}

function renderSkeletonPlaceholder(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const pg = g.append('g').attr('transform', `translate(${node.x}, ${node.y})`);

  if (isTransparent) {
    pg.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', palette.border)
      .attr('opacity', 0.1)
      .attr('rx', 4);
  } else {
    pg.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', palette.border)
      .attr('opacity', 0.2)
      .attr('rx', 4);
  }
}

function renderAlert(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;
  const color = getElementSemanticColor(el, palette) || palette.accent;

  // Background
  if (!isTransparent) {
    g.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', mix(color, palette.bg, 0.85))
      .attr('rx', 4);
  }

  // Left color bar
  g.append('rect')
    .attr('width', 3)
    .attr('height', node.height)
    .attr('fill', color)
    .attr('rx', 1.5);

  // Border for transparent
  if (isTransparent) {
    g.append('rect')
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('rx', 4);
  }

  g.append('text')
    .attr('x', 12)
    .attr('y', node.height / 2 + 4)
    .attr('fill', palette.text)
    .attr('font-size', 13)
    .text(el.label);
}

function renderProgress(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;
  const val = el.progressValue ?? 0;
  const barH = 8;
  const cy = node.height / 2;

  // Track
  g.append('rect')
    .attr('width', node.width - 40)
    .attr('height', barH)
    .attr('y', cy - barH / 2)
    .attr('fill', isTransparent ? 'none' : mix(palette.border, palette.bg, 0.5))
    .attr('stroke', isTransparent ? palette.border : 'none')
    .attr('rx', barH / 2);

  // Fill
  const fillW = ((node.width - 40) * val) / 100;
  if (fillW > 0) {
    g.append('rect')
      .attr('width', fillW)
      .attr('height', barH)
      .attr('y', cy - barH / 2)
      .attr('fill', palette.primary)
      .attr('rx', barH / 2);
  }

  // Label
  g.append('text')
    .attr('x', node.width - 32)
    .attr('y', cy + 4)
    .attr('fill', palette.textMuted)
    .attr('font-size', 11)
    .text(`${val}%`);
}

function renderChart(
  g: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;
  const hint = el.chartHint || 'line';

  // Border
  g.append('rect')
    .attr('width', node.width)
    .attr('height', node.height)
    .attr(
      'fill',
      isTransparent ? 'none' : mix(palette.surface, palette.bg, 0.3)
    )
    .attr('stroke', palette.border)
    .attr('rx', 4);

  const padX = 20;
  const padY = 20;
  const innerW = node.width - padX * 2;
  const innerH = node.height - padY * 2;

  if (hint === 'line') {
    // Wavy line
    const points = [
      [0, innerH * 0.7],
      [innerW * 0.2, innerH * 0.4],
      [innerW * 0.4, innerH * 0.6],
      [innerW * 0.6, innerH * 0.2],
      [innerW * 0.8, innerH * 0.3],
      [innerW, innerH * 0.1],
    ];
    const path = points
      .map(([x, y], i) =>
        i === 0 ? `M${padX + x},${padY + y}` : `L${padX + x},${padY + y}`
      )
      .join(' ');
    g.append('path')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', palette.primary)
      .attr('stroke-width', 2);
  } else if (hint === 'bar') {
    // Vertical bars
    const barCount = 5;
    const barW = innerW / (barCount * 2);
    const barHeights = [0.6, 0.8, 0.5, 0.9, 0.7];
    for (let i = 0; i < barCount; i++) {
      const bh = innerH * barHeights[i];
      g.append('rect')
        .attr('x', padX + i * (innerW / barCount) + barW / 2)
        .attr('y', padY + innerH - bh)
        .attr('width', barW)
        .attr('height', bh)
        .attr('fill', palette.primary)
        .attr('opacity', 0.7)
        .attr('rx', 2);
    }
  } else if (hint === 'pie') {
    // Circle with wedges
    const cx = node.width / 2;
    const cy = node.height / 2;
    const r = Math.min(innerW, innerH) / 2;
    const slices = [0.35, 0.25, 0.2, 0.2];
    const colors = [
      palette.primary,
      palette.secondary,
      palette.accent,
      palette.border,
    ];
    let startAngle = 0;
    for (let i = 0; i < slices.length; i++) {
      const endAngle = startAngle + slices[i] * Math.PI * 2;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = slices[i] > 0.5 ? 1 : 0;
      g.append('path')
        .attr(
          'd',
          `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`
        )
        .attr('fill', colors[i])
        .attr('opacity', 0.7);
      startAngle = endAngle;
    }
  }
}

function renderModal(
  parent: GSelection,
  node: WireframeLayoutNode,
  ctx: RenderContext
): void {
  const { palette, isTransparent } = ctx;
  const el = node.element;

  const g = parent
    .append('g')
    .attr('transform', `translate(${node.x}, ${node.y})`)
    .attr('data-line-number', el.lineNumber);

  // Shadow
  if (!isTransparent) {
    g.append('rect')
      .attr('x', 4)
      .attr('y', 4)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('fill', 'rgba(0,0,0,0.1)')
      .attr('rx', GROUP_CORNER);
  }

  // Modal panel
  g.append('rect')
    .attr('width', node.width)
    .attr('height', node.height)
    .attr('fill', isTransparent ? 'none' : palette.surface)
    .attr('stroke', palette.border)
    .attr('rx', GROUP_CORNER);

  // Title bar
  g.append('rect')
    .attr('width', node.width)
    .attr('height', 36)
    .attr(
      'fill',
      isTransparent ? 'none' : mix(palette.surface, palette.border, 0.3)
    )
    .attr('rx', GROUP_CORNER);

  g.append('text')
    .attr('x', 12)
    .attr('y', 24)
    .attr('fill', palette.text)
    .attr('font-size', 14)
    .attr('font-weight', '600')
    .text(el.label || 'Modal');

  // Close button
  const cx = node.width - 16;
  g.append('text')
    .attr('x', cx)
    .attr('y', 24)
    .attr('fill', palette.textMuted)
    .attr('font-size', 16)
    .text('×');

  // Render children with offset
  for (const child of node.children) {
    const childG = g.append('g').attr('transform', 'translate(0, 36)');
    renderNode(childG, child, ctx, 1);
  }
}
