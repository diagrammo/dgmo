// ============================================================
// Wireframe Diagram Layout Engine (Document Flow)
// ============================================================

import type {
  WireframeElement,
  ParsedWireframe,
  WireframeFormFactor,
} from './types';

// ============================================================
// Constants
// ============================================================

const DESKTOP_WIDTH = 1200;
const MOBILE_WIDTH = 375;

const CHAR_WIDTH = 7.5;
const LABEL_PADDING = 16;

/** Element type-specific heights */
const ELEMENT_HEIGHTS: Record<string, number> = {
  textInput: 36,
  button: 40,
  dropdown: 36,
  checkbox: 24,
  radio: 24,
  heading: 48,
  subheading: 36,
  divider: 24,
  text: 22,
  listItem: 24,
  image: 120,
  progress: 28,
  chart: 160,
  alert: 40,
  nav: 44,
  tabs: 44,
};

/** Spacing after specific element types */
const SPACING_AFTER: Record<string, number> = {
  heading: 16,
  subheading: 12,
  divider: 12,
  textInput: 8,
  dropdown: 8,
  checkbox: 8,
  radio: 8,
  button: 8,
  text: 12,
  listItem: 4,
  group: 16,
  image: 12,
  progress: 12,
  chart: 16,
  alert: 12,
  nav: 12,
  tabs: 12,
  table: 16,
};

const GROUP_PADDING_TOP_WITH_LABEL = 32; // label + top padding
const GROUP_PADDING_TOP_NO_LABEL = 10; // just content padding
const GROUP_PADDING_BOTTOM = 12;

/** Resolved at layout time based on showGroupLabels option */
let GROUP_PADDING_TOP = GROUP_PADDING_TOP_WITH_LABEL;
const GROUP_PADDING_X = 12;
const FRAME_PADDING = 20;
const TITLE_HEIGHT = 40;

/** Smart sizing: recognized region name prefixes → width fraction */
const REGION_SIZES: Record<string, number> = {
  sidebar: 0.25,
  side: 0.25,
  left: 0.25,
  right: 0.25,
  main: 0, // fill remaining
  content: 0, // fill remaining
  center: 0, // fill remaining
};

/** Full-width regions (thin strips) */
const FULL_WIDTH_REGIONS = new Set(['header', 'top', 'footer', 'bottom']);
const HEADER_REGION_HEIGHT = 60;
const FOOTER_REGION_HEIGHT = 40;

// ============================================================
// Layout Types
// ============================================================

export interface WireframeLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  element: WireframeElement;
  children: WireframeLayoutNode[];
  /** For label-field pairs: the x offset where fields align */
  fieldAlignX?: number;
}

export interface WireframeLayout {
  width: number;
  height: number;
  titleHeight: number;
  nodes: WireframeLayoutNode[];
  modalNodes: WireframeLayoutNode[];
}

// ============================================================
// Layout Engine
// ============================================================

export function layoutWireframe(
  parsed: ParsedWireframe,
  _options?: Record<string, string>,
  overrideWidth?: number,
  showGroupLabels = true
): WireframeLayout {
  GROUP_PADDING_TOP = showGroupLabels
    ? GROUP_PADDING_TOP_WITH_LABEL
    : GROUP_PADDING_TOP_NO_LABEL;
  const defaultWidth =
    parsed.formFactor === 'mobile' ? MOBILE_WIDTH : DESKTOP_WIDTH;
  const frameWidth = overrideWidth ?? defaultWidth;
  const titleHeight = parsed.title ? TITLE_HEIGHT : 0;

  const contentWidth = frameWidth - FRAME_PADDING * 2;

  // Layout top-level roots
  const nodes = layoutTopLevel(parsed.roots, contentWidth, parsed.formFactor);

  // Calculate total height from positioned nodes
  let maxY = 0;
  for (const n of nodes) {
    maxY = Math.max(maxY, n.y + n.height);
  }

  // Layout modals below main content
  const modalNodes: WireframeLayoutNode[] = [];
  let modalY = maxY + 24;
  for (const modal of parsed.modals) {
    const modalWidth = Math.min(contentWidth * 0.7, 600);
    const modalX = (contentWidth - modalWidth) / 2;
    const node = layoutElement(modal, modalX, modalY, modalWidth);
    modalNodes.push(node);
    modalY += node.height + 24;
  }

  const totalHeight =
    (modalNodes.length > 0
      ? modalNodes[modalNodes.length - 1].y +
        modalNodes[modalNodes.length - 1].height
      : maxY) +
    FRAME_PADDING * 2 +
    titleHeight;

  return {
    width: frameWidth,
    height: totalHeight,
    titleHeight,
    nodes,
    modalNodes,
  };
}

/**
 * Layout top-level roots: separate into full-width regions (header/footer)
 * and horizontal siblings, then stack vertically.
 */
function layoutTopLevel(
  roots: WireframeElement[],
  contentWidth: number,
  formFactor: WireframeFormFactor
): WireframeLayoutNode[] {
  const result: WireframeLayoutNode[] = [];
  let y = 0;

  // Classify roots into rows
  const rows: WireframeElement[][] = [];
  let currentRow: WireframeElement[] = [];

  for (const root of roots) {
    const regionName = root.label.toLowerCase().split(/\s+/)[0];
    if (FULL_WIDTH_REGIONS.has(regionName) || formFactor === 'mobile') {
      // Full-width: flush current row first, then add as its own row
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      rows.push([root]);
    } else {
      currentRow.push(root);
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // Layout each row
  for (const row of rows) {
    if (row.length === 1 && formFactor !== 'mobile') {
      const el = row[0];
      const regionName = el.label.toLowerCase().split(/\s+/)[0];

      if (FULL_WIDTH_REGIONS.has(regionName)) {
        // Full-width strip
        const node = layoutElement(el, 0, y, contentWidth);
        // Enforce min height for header/footer
        if (regionName === 'header' || regionName === 'top') {
          node.height = Math.max(node.height, HEADER_REGION_HEIGHT);
        } else {
          node.height = Math.max(node.height, FOOTER_REGION_HEIGHT);
        }
        result.push(node);
        y += node.height + 16;
        continue;
      }
    }

    if (formFactor === 'mobile' || row.length === 1) {
      // Stack vertically
      for (const el of row) {
        const node = layoutElement(el, 0, y, contentWidth);
        result.push(node);
        y += node.height + 16;
      }
    } else {
      // Horizontal siblings — smart sizing
      const allocated = allocateHorizontalWidths(row, contentWidth);
      let x = 0;
      let maxHeight = 0;
      const rowNodes: WireframeLayoutNode[] = [];

      for (let i = 0; i < row.length; i++) {
        const w = allocated[i];
        const node = layoutElement(row[i], x, y, w);
        rowNodes.push(node);
        maxHeight = Math.max(maxHeight, node.height);
        x += w + 12; // gap between horizontal siblings
      }

      // Equalize heights (tallest wins, F4)
      for (const n of rowNodes) {
        n.height = maxHeight;
      }

      result.push(...rowNodes);
      y += maxHeight + 16;
    }
  }

  return result;
}

/**
 * Allocate horizontal widths for side-by-side regions using smart sizing.
 */
function allocateHorizontalWidths(
  elements: WireframeElement[],
  totalWidth: number
): number[] {
  const gap = 12;
  const totalGaps = (elements.length - 1) * gap;
  const available = totalWidth - totalGaps;

  const widths: number[] = new Array(elements.length).fill(0);
  let allocated = 0;
  let fillCount = 0;

  for (let i = 0; i < elements.length; i++) {
    const name = elements[i].label.toLowerCase().split(/\s+/)[0];
    const fraction = REGION_SIZES[name];

    if (fraction !== undefined && fraction > 0) {
      widths[i] = available * fraction;
      allocated += widths[i];
    } else if (fraction === 0) {
      // Fill remaining
      fillCount++;
    } else {
      // Unknown — will be equal-split
      fillCount++;
    }
  }

  // Distribute remaining to fill/unknown regions
  if (fillCount > 0) {
    const remaining = Math.max(0, available - allocated);
    const each = remaining / fillCount;
    for (let i = 0; i < widths.length; i++) {
      if (widths[i] === 0) widths[i] = Math.max(40, each);
    }
  }

  // Clamp all widths to minimum
  for (let i = 0; i < widths.length; i++) {
    widths[i] = Math.max(40, widths[i]);
  }

  return widths;
}

/**
 * Layout a single element and its children recursively.
 */
function layoutElement(
  el: WireframeElement,
  x: number,
  y: number,
  width: number
): WireframeLayoutNode {
  const node: WireframeLayoutNode = {
    id: el.id,
    x,
    y,
    width,
    height: 0,
    element: el,
    children: [],
  };

  // Nav and tabs render children internally as a horizontal bar — treat as leaf for layout
  const selfRendered = el.type === 'nav' || el.type === 'tabs';

  if (!el.isContainer || el.children.length === 0 || selfRendered) {
    // Leaf element — use type-specific height
    node.height = getElementHeight(el);
    return node;
  }

  // Container — layout children
  const isInlineRow =
    el.metadata._inlineRow === 'true' || el.metadata._labelField === 'true';
  const padTop = isInlineRow ? 0 : GROUP_PADDING_TOP;
  const padBottom = isInlineRow ? 0 : GROUP_PADDING_BOTTOM;
  const padX = isInlineRow ? 0 : GROUP_PADDING_X;
  const innerWidth = width - padX * 2;
  const innerX = padX;

  if (el.orientation === 'horizontal') {
    // Horizontal layout: children in a row
    const childWidths = allocateEqualWidths(el.children, innerWidth);
    let cx = innerX;
    let maxChildHeight = 0;

    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      const cw = childWidths[i];
      const childNode = layoutElement(child, cx, padTop, cw);
      node.children.push(childNode);
      maxChildHeight = Math.max(maxChildHeight, childNode.height);
      cx += cw + 8;
    }

    // Equalize child heights
    for (const cn of node.children) {
      cn.height = maxChildHeight;
    }

    node.height = padTop + maxChildHeight + padBottom;
  } else {
    // Vertical layout: stack children
    let cy = padTop;

    // Check for label-field auto-alignment (ADR-4)
    const fieldAlignX = computeFieldAlignX(el.children);
    if (fieldAlignX > 0) {
      node.fieldAlignX = fieldAlignX;
    }

    for (const child of el.children) {
      const childNode = layoutElement(child, innerX, cy, innerWidth);
      node.children.push(childNode);
      cy += childNode.height + getSpacingAfter(child);
    }

    node.height = cy + padBottom;
  }

  // Collapsed state: only show header
  if (el.states.includes('collapsed')) {
    node.height = GROUP_PADDING_TOP;
    node.children = [];
  }

  return node;
}

function allocateEqualWidths(
  children: WireframeElement[],
  totalWidth: number
): number[] {
  const gap = 8;
  const totalGaps = (children.length - 1) * gap;
  const each = Math.max(40, (totalWidth - totalGaps) / children.length);
  return children.map(() => each);
}

function getElementHeight(el: WireframeElement): number {
  if (el.type === 'heading') {
    return el.headingLevel === 2
      ? (ELEMENT_HEIGHTS.subheading ?? 36)
      : (ELEMENT_HEIGHTS.heading ?? 48);
  }

  if (el.type === 'textInput' && el.fieldVariant === 'textarea') {
    return 80;
  }

  if (el.type === 'table') {
    const headerH = 32;
    const rowH = 28;
    const rows = el.tableData?.length || el.tableRows || 0;
    return headerH + rows * rowH + 8;
  }

  // Image hints affect height
  if (el.type === 'image') {
    if (el.imageHint === 'round') return 80;
    if (el.imageHint === 'wide') return 80;
    return ELEMENT_HEIGHTS.image ?? 120;
  }

  // Label-field wrapper
  if (el.metadata._labelField === 'true') {
    return 36; // input height
  }

  return ELEMENT_HEIGHTS[el.type] ?? 24;
}

function getSpacingAfter(el: WireframeElement): number {
  if (el.type === 'heading' && el.headingLevel === 2) {
    return SPACING_AFTER.subheading ?? 12;
  }
  return SPACING_AFTER[el.type] ?? 8;
}

/**
 * Compute auto-alignment X offset for label-field pairs in a group (ADR-4, EC8).
 * Returns 0 if no label-field pattern detected.
 */
function computeFieldAlignX(children: WireframeElement[]): number {
  let maxLabelWidth = 0;
  let labelFieldCount = 0;

  for (const child of children) {
    if (child.metadata._labelField === 'true' && child.children.length >= 2) {
      const labelEl = child.children[0];
      const labelWidth = labelEl.label.length * CHAR_WIDTH;
      maxLabelWidth = Math.max(maxLabelWidth, labelWidth);
      labelFieldCount++;
    }
  }

  if (labelFieldCount < 2) return 0;
  return maxLabelWidth + LABEL_PADDING;
}
