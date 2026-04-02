// ============================================================
// Centralized legend layout engine
// Pure function: config + state + width → positions
// ============================================================

import {
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
  measureLegendText,
} from './legend-constants';

import type { LegendGroupData } from './legend-svg';
import type {
  LegendConfig,
  LegendState,
  LegendLayout,
  LegendPillLayout,
  LegendCapsuleLayout,
  LegendControlLayout,
  LegendEntryLayout,
  LegendControl,
} from './legend-types';

// ── Constants ───────────────────────────────────────────────

export const LEGEND_TOP_PAD = 12;
export const LEGEND_TITLE_GAP = 8;
export const LEGEND_CONTENT_GAP = 12;
export const LEGEND_MAX_ENTRY_ROWS = 3;

const CONTROL_PILL_PAD = 16;
const CONTROL_FONT_SIZE = 11;
const CONTROL_ICON_GAP = 4;
const CONTROL_GAP = 8;

// ── Measurement helpers ─────────────────────────────────────

export function pillWidth(name: string): number {
  return measureLegendText(name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
}

function entriesWidth(entries: Array<{ value: string }>): number {
  let w = 0;
  for (const e of entries) {
    w +=
      LEGEND_DOT_R * 2 +
      LEGEND_ENTRY_DOT_GAP +
      measureLegendText(e.value, LEGEND_ENTRY_FONT_SIZE) +
      LEGEND_ENTRY_TRAIL;
  }
  return w;
}

function entryWidth(value: string): number {
  return (
    LEGEND_DOT_R * 2 +
    LEGEND_ENTRY_DOT_GAP +
    measureLegendText(value, LEGEND_ENTRY_FONT_SIZE) +
    LEGEND_ENTRY_TRAIL
  );
}

function controlWidth(control: LegendControl): number {
  let w = CONTROL_PILL_PAD;
  if (control.label) {
    w += measureLegendText(control.label, CONTROL_FONT_SIZE);
    if (control.icon) w += CONTROL_ICON_GAP;
  }
  // Icon space (approximate — icons are typically ~14px)
  if (control.icon) w += 14;
  if (control.children) {
    for (const child of control.children) {
      w += measureLegendText(child.label, CONTROL_FONT_SIZE) + 12;
    }
  }
  return w;
}

function capsuleWidth(
  name: string,
  entries: Array<{ value: string }>,
  containerWidth: number,
  addonWidth = 0
): {
  width: number;
  entryRows: number;
  moreCount: number;
  visibleEntries: number;
} {
  const pw = pillWidth(name);
  const maxCapsuleW = containerWidth;
  const baseW = LEGEND_CAPSULE_PAD * 2 + pw + 4 + addonWidth;

  // Try single row first
  const ew = entriesWidth(entries);
  const singleRowW = baseW + ew;
  if (singleRowW <= maxCapsuleW) {
    return {
      width: singleRowW,
      entryRows: 1,
      moreCount: 0,
      visibleEntries: entries.length,
    };
  }

  // Multi-row: compute how many entries fit per row
  const rowWidth = maxCapsuleW - LEGEND_CAPSULE_PAD * 2;
  let row = 1;
  let rowX = pw + 4;
  let visible = 0;

  for (let i = 0; i < entries.length; i++) {
    const ew2 = entryWidth(entries[i].value);
    if (rowX + ew2 > rowWidth && rowX > pw + 4) {
      row++;
      rowX = 0;
      if (row > LEGEND_MAX_ENTRY_ROWS) {
        return {
          width: maxCapsuleW,
          entryRows: LEGEND_MAX_ENTRY_ROWS,
          moreCount: entries.length - visible,
          visibleEntries: visible,
        };
      }
    }
    rowX += ew2;
    visible++;
  }

  return {
    width: maxCapsuleW,
    entryRows: row,
    moreCount: 0,
    visibleEntries: entries.length,
  };
}

// ── Main layout computation ─────────────────────────────────

export function computeLegendLayout(
  config: LegendConfig,
  state: LegendState,
  containerWidth: number
): LegendLayout {
  const { groups, controls: configControls, mode } = config;
  const isExport = mode === 'inline';

  // Filter groups for export: only active group shown
  const activeGroupName = state.activeGroup?.toLowerCase() ?? null;

  // In export mode with no active group, no legend
  if (isExport && !activeGroupName) {
    return {
      height: 0,
      width: 0,
      rows: [],
      controls: [],
      pills: [],
      activeCapsule: undefined,
    };
  }

  const visibleGroups = config.showEmptyGroups
    ? groups
    : groups.filter((g) => g.entries.length > 0);
  if (
    visibleGroups.length === 0 &&
    (!configControls || configControls.length === 0)
  ) {
    return {
      height: 0,
      width: 0,
      rows: [],
      controls: [],
      pills: [],
      activeCapsule: undefined,
    };
  }

  // Compute control layouts (right-aligned)
  const controlLayouts: LegendControlLayout[] = [];
  let totalControlsW = 0;

  if (configControls && !isExport) {
    for (const ctrl of configControls) {
      const w = controlWidth(ctrl);
      controlLayouts.push({
        id: ctrl.id,
        x: 0, // positioned later
        y: 0,
        width: w,
        height: LEGEND_HEIGHT,
        icon: ctrl.icon,
        label: ctrl.label,
        exportBehavior: ctrl.exportBehavior,
        children: ctrl.children?.map((c) => ({
          id: c.id,
          label: c.label,
          x: 0,
          y: 0,
          width: measureLegendText(c.label, CONTROL_FONT_SIZE) + 12,
          isActive: c.isActive,
        })),
      });
      totalControlsW += w + CONTROL_GAP;
    }
    if (totalControlsW > 0) totalControlsW -= CONTROL_GAP; // remove trailing gap
  } else if (configControls && isExport) {
    // In export, include controls with exportBehavior 'include' or 'static'
    for (const ctrl of configControls) {
      if (ctrl.exportBehavior === 'strip') continue;
      const w = controlWidth(ctrl);
      controlLayouts.push({
        id: ctrl.id,
        x: 0,
        y: 0,
        width: w,
        height: LEGEND_HEIGHT,
        icon: ctrl.icon,
        label: ctrl.label,
        exportBehavior: ctrl.exportBehavior,
        children: ctrl.children?.map((c) => ({
          id: c.id,
          label: c.label,
          x: 0,
          y: 0,
          width: measureLegendText(c.label, CONTROL_FONT_SIZE) + 12,
          isActive: c.isActive,
        })),
      });
      totalControlsW += w + CONTROL_GAP;
    }
    if (totalControlsW > 0) totalControlsW -= CONTROL_GAP;
  }

  // Available width for tag groups (controls anchor right)
  const controlsSpace =
    totalControlsW > 0 ? totalControlsW + LEGEND_GROUP_GAP * 2 : 0;
  const groupAvailW = containerWidth - controlsSpace;

  // Build pill/capsule layouts
  const pills: LegendPillLayout[] = [];
  let activeCapsule: LegendCapsuleLayout | undefined;

  for (const g of visibleGroups) {
    const isActive = activeGroupName === g.name.toLowerCase();

    // In export mode, skip non-active groups
    if (isExport && !isActive) continue;

    if (isActive) {
      activeCapsule = buildCapsuleLayout(
        g,
        containerWidth,
        config.capsulePillAddonWidth ?? 0
      );
    } else {
      const pw = pillWidth(g.name);
      pills.push({
        groupName: g.name,
        x: 0,
        y: 0,
        width: pw,
        height: LEGEND_HEIGHT,
        isActive: false,
      });
    }
  }

  // Position elements in rows
  const rows = layoutRows(
    activeCapsule,
    pills,
    controlLayouts,
    groupAvailW,
    containerWidth,
    totalControlsW
  );

  const height = rows.length * LEGEND_HEIGHT;
  const width = containerWidth;

  return {
    height,
    width,
    rows,
    activeCapsule,
    controls: controlLayouts,
    pills,
  };
}

// ── Build capsule for active group ──────────────────────────

function buildCapsuleLayout(
  group: LegendGroupData,
  containerWidth: number,
  addonWidth = 0
): LegendCapsuleLayout {
  const pw = pillWidth(group.name);
  const info = capsuleWidth(
    group.name,
    group.entries,
    containerWidth,
    addonWidth
  );

  const pill: LegendPillLayout = {
    groupName: group.name,
    x: LEGEND_CAPSULE_PAD,
    y: LEGEND_CAPSULE_PAD,
    width: pw,
    height: LEGEND_HEIGHT - LEGEND_CAPSULE_PAD * 2,
    isActive: true,
  };

  const entries: LegendEntryLayout[] = [];
  let ex = LEGEND_CAPSULE_PAD + pw + 4 + addonWidth;
  let ey = 0;
  let rowX = ex;
  const maxRowW = containerWidth - LEGEND_CAPSULE_PAD * 2;
  let currentRow = 0;

  for (let i = 0; i < info.visibleEntries; i++) {
    const entry = group.entries[i];
    const ew = entryWidth(entry.value);

    // Wrap to next row if needed
    if (rowX + ew > maxRowW && rowX > ex && i > 0) {
      currentRow++;
      rowX = 0;
      ey = currentRow * LEGEND_HEIGHT;
      if (currentRow === 0) ex = LEGEND_CAPSULE_PAD + pw + 4;
    }

    const dotCx = rowX + LEGEND_DOT_R;
    const dotCy = ey + LEGEND_HEIGHT / 2;
    const textX = rowX + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP;
    const textY = ey + LEGEND_HEIGHT / 2;

    entries.push({
      value: entry.value,
      color: entry.color,
      x: rowX,
      y: ey,
      dotCx,
      dotCy,
      textX,
      textY,
    });

    rowX += ew;
  }

  const totalRows = info.entryRows;
  const capsuleH = totalRows * LEGEND_HEIGHT;

  return {
    groupName: group.name,
    x: 0,
    y: 0,
    width: info.width,
    height: capsuleH,
    pill,
    entries,
    moreCount: info.moreCount > 0 ? info.moreCount : undefined,
    addonX: addonWidth > 0 ? LEGEND_CAPSULE_PAD + pw + 4 : undefined,
  };
}

// ── Row layout ──────────────────────────────────────────────

function layoutRows(
  activeCapsule: LegendCapsuleLayout | undefined,
  pills: LegendPillLayout[],
  controls: LegendControlLayout[],
  groupAvailW: number,
  containerWidth: number,
  totalControlsW: number
): Array<{
  y: number;
  items: Array<LegendPillLayout | LegendCapsuleLayout | LegendControlLayout>;
}> {
  const rows: Array<{
    y: number;
    items: Array<LegendPillLayout | LegendCapsuleLayout | LegendControlLayout>;
  }> = [];

  // Collect all group-side items in display order: active capsule first, then collapsed pills
  const groupItems: Array<LegendPillLayout | LegendCapsuleLayout> = [];
  if (activeCapsule) groupItems.push(activeCapsule);
  groupItems.push(...pills);

  // Compute total group items width
  let currentRowItems: Array<
    LegendPillLayout | LegendCapsuleLayout | LegendControlLayout
  > = [];
  let currentRowW = 0;
  let rowY = 0;

  for (const item of groupItems) {
    const itemW = item.width + LEGEND_GROUP_GAP;
    if (currentRowW + item.width > groupAvailW && currentRowItems.length > 0) {
      // Commit current row
      centerRowItems(currentRowItems, containerWidth, totalControlsW);
      rows.push({ y: rowY, items: currentRowItems });
      rowY += LEGEND_HEIGHT;
      currentRowItems = [];
      currentRowW = 0;
    }
    item.x = currentRowW;
    item.y = rowY;
    currentRowItems.push(item);
    currentRowW += itemW;
  }

  // Add controls to first row (right-aligned)
  if (controls.length > 0) {
    let cx = containerWidth;
    for (let i = controls.length - 1; i >= 0; i--) {
      cx -= controls[i].width;
      controls[i].x = cx;
      controls[i].y = 0;
      cx -= CONTROL_GAP;
    }
    // Controls go on first row
    if (rows.length > 0) {
      rows[0].items.push(...controls);
    } else if (currentRowItems.length > 0) {
      currentRowItems.push(...controls);
    } else {
      // Only controls, no groups
      currentRowItems.push(...controls);
    }
  }

  // Commit last row
  if (currentRowItems.length > 0) {
    centerRowItems(currentRowItems, containerWidth, totalControlsW);
    rows.push({ y: rowY, items: currentRowItems });
  }

  // Ensure at least one row height
  if (rows.length === 0) {
    rows.push({ y: 0, items: [] });
  }

  return rows;
}

function centerRowItems(
  items: Array<LegendPillLayout | LegendCapsuleLayout | LegendControlLayout>,
  containerWidth: number,
  totalControlsW: number
): void {
  // Only center group items (pills and capsules), not controls
  const groupItems = items.filter((it) => 'groupName' in it) as Array<
    LegendPillLayout | LegendCapsuleLayout
  >;

  if (groupItems.length === 0) return;

  const totalGroupW =
    groupItems.reduce((s, it) => s + it.width, 0) +
    (groupItems.length - 1) * LEGEND_GROUP_GAP;

  const availW =
    containerWidth -
    (totalControlsW > 0 ? totalControlsW + LEGEND_GROUP_GAP * 2 : 0);
  const offset = Math.max(0, (availW - totalGroupW) / 2);

  let x = offset;
  for (const item of groupItems) {
    item.x = x;
    x += item.width + LEGEND_GROUP_GAP;
  }
}

// ── Public: height reservation ──────────────────────────────

export function getLegendReservedHeight(
  config: LegendConfig,
  state: LegendState,
  containerWidth: number
): number {
  const layout = computeLegendLayout(config, state, containerWidth);
  return layout.height;
}
