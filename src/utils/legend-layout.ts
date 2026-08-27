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
  LEGEND_MAX_ENTRY_ROWS,
  LEGEND_GEAR_PILL_W,
  LEGEND_TOGGLE_DOT_R,
  measureLegendText,
  truncateLegendText,
} from './legend-constants';

import { compactNumber } from './number-format';
import type { LegendGroupData } from './legend-types';
import type {
  LegendConfig,
  LegendState,
  LegendLayout,
  LegendPillLayout,
  LegendCapsuleLayout,
  LegendControlLayout,
  LegendEntryLayout,
  LegendControl,
  ControlsGroupLayout,
  ControlsGroupToggleLayout,
} from './legend-types';

// ── Constants ───────────────────────────────────────────────

const CONTROL_PILL_PAD = 16;
const CONTROL_FONT_SIZE = 11;
const CONTROL_ICON_GAP = 4;
const CONTROL_GAP = 8;

// Continuous-ramp swatch dims (choropleth groups) — match the legacy map ramp
// block so the gradient reads the same now that it lives in the top legend.
const RAMP_LEGEND_W = 80;
const RAMP_LEGEND_H = 8;
const RAMP_LABEL_GAP = 6;

/** Compact numeric label for a ramp end — shared with the map's on-region value
 *  labels (`compactNumber`) so the gradient ends and region values read the same
 *  (`40M` legend end ↔ a `39.5M` region). */
function fmtRamp(n: number): string {
  return compactNumber(n);
}

/** Width of a gradient group's capsule: pill + min label + ramp + max label. */
function gradientCapsuleWidth(
  name: string,
  gradient: NonNullable<LegendGroupData['gradient']>
): number {
  const pw = pillWidth(name);
  const minW = measureLegendText(fmtRamp(gradient.min), LEGEND_ENTRY_FONT_SIZE);
  const maxW = measureLegendText(fmtRamp(gradient.max), LEGEND_ENTRY_FONT_SIZE);
  return (
    LEGEND_CAPSULE_PAD +
    pw +
    4 +
    minW +
    RAMP_LABEL_GAP +
    RAMP_LEGEND_W +
    RAMP_LABEL_GAP +
    maxW +
    LEGEND_CAPSULE_PAD
  );
}

/** Active capsule for a continuous-ramp (choropleth) group. */
function buildGradientCapsuleLayout(
  group: LegendGroupData,
  gradient: NonNullable<LegendGroupData['gradient']>
): LegendCapsuleLayout {
  const pw = pillWidth(group.name);
  const minText = fmtRamp(gradient.min);
  const maxText = fmtRamp(gradient.max);
  const minW = measureLegendText(minText, LEGEND_ENTRY_FONT_SIZE);
  const gx = LEGEND_CAPSULE_PAD + pw + 4;
  const minX = gx;
  const rampX = gx + minW + RAMP_LABEL_GAP;
  const maxX = rampX + RAMP_LEGEND_W + RAMP_LABEL_GAP;
  const width = gradientCapsuleWidth(group.name, gradient);
  return {
    groupName: group.name,
    x: 0,
    y: 0,
    width,
    height: LEGEND_HEIGHT,
    pill: {
      groupName: group.name,
      x: LEGEND_CAPSULE_PAD,
      y: LEGEND_CAPSULE_PAD,
      width: pw,
      height: LEGEND_HEIGHT - LEGEND_CAPSULE_PAD * 2,
      isActive: true,
    },
    entries: [],
    gradient: {
      rampX,
      rampY: (LEGEND_HEIGHT - RAMP_LEGEND_H) / 2,
      rampW: RAMP_LEGEND_W,
      rampH: RAMP_LEGEND_H,
      min: gradient.min,
      max: gradient.max,
      minText,
      minX,
      maxText,
      maxX,
      textY: LEGEND_HEIGHT / 2,
      low: gradient.low,
      high: gradient.high,
    },
  };
}

// ── Measurement helpers ─────────────────────────────────────

export function pillWidth(name: string): number {
  return measureLegendText(name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
}

function entriesWidth(
  entries: ReadonlyArray<{ readonly value: string }>
): number {
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

/**
 * The full advance width of one legend entry — dot, gap, label and trail.
 *
 * Public because a caller sizing `capsuleTrailingAddonWidth` has to reserve
 * room for something that will be DRAWN as an entry, and measuring it any other
 * way is a second implementation of `measureLegendText` plus four constants.
 */
export function legendEntryWidth(value: string): number {
  return (
    LEGEND_DOT_R * 2 +
    LEGEND_ENTRY_DOT_GAP +
    measureLegendText(value, LEGEND_ENTRY_FONT_SIZE) +
    LEGEND_ENTRY_TRAIL
  );
}

const entryWidth = legendEntryWidth;

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
  entries: ReadonlyArray<{ readonly value: string }>,
  containerWidth: number,
  addonWidth = 0,
  trailWidth = 0
): {
  width: number;
  entryRows: number;
  moreCount: number;
  visibleEntries: number;
} {
  const pw = pillWidth(name);
  const maxCapsuleW = containerWidth;
  const baseW = LEGEND_CAPSULE_PAD * 2 + pw + 4 + addonWidth;

  // Try single row first. Tolerate sub-pixel float drift: the caller
  // typically sizes its container to exactly match singleRowW, and FP
  // associativity in intermediate sums can leave maxCapsuleW short by
  // ~1e-14 (same family of bug fixed in 069a327 for the per-entry pass).
  const ew = entriesWidth(entries);
  const singleRowW = baseW + ew + trailWidth;
  if (singleRowW <= maxCapsuleW + 0.5) {
    return {
      width: singleRowW,
      entryRows: 1,
      moreCount: 0,
      visibleEntries: entries.length,
    };
  }

  // Multi-row: compute how many entries fit per row
  // Right boundary leaves one LEGEND_CAPSULE_PAD for right padding;
  // left padding is already baked into the starting rowX.
  //
  // 🔴 The trailing addon is reserved on EVERY row, not just the last. Which
  // row is last is not known until the packing is done, and an addon added
  // afterwards would either overhang the capsule or sit on top of an entry.
  // The cost is that rows wrap marginally earlier; the benefit is that the
  // addon can never be the thing pushed past LEGEND_MAX_ENTRY_ROWS — which for
  // an authoring affordance means the control that adds a value cannot be
  // dropped by having too many values.
  const rowWidth = maxCapsuleW - LEGEND_CAPSULE_PAD - trailWidth;
  let row = 1;
  let rowX = LEGEND_CAPSULE_PAD + pw + 4 + addonWidth;
  let visible = 0;

  for (let i = 0; i < entries.length; i++) {
    let ew2 = entryWidth(entries[i]!.value);
    const availW = rowWidth - rowX;
    if (ew2 > availW && i > 0) {
      row++;
      rowX = LEGEND_CAPSULE_PAD + pw + 4 + addonWidth;
      if (row > LEGEND_MAX_ENTRY_ROWS) {
        return {
          width: maxCapsuleW,
          entryRows: LEGEND_MAX_ENTRY_ROWS,
          moreCount: entries.length - visible,
          visibleEntries: visible,
        };
      }
    }
    // Cap to available width (mirrors truncation in buildCapsuleLayout)
    ew2 = Math.min(ew2, rowWidth - rowX);
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

// ── Controls group layout helpers ───────────────────────────

export function controlsGroupCapsuleWidth(
  toggles: Array<{ label: string }>
): number {
  let w = LEGEND_CAPSULE_PAD * 2 + LEGEND_GEAR_PILL_W + 4;
  for (const t of toggles) {
    w +=
      LEGEND_TOGGLE_DOT_R * 2 +
      LEGEND_ENTRY_DOT_GAP +
      measureLegendText(t.label, LEGEND_ENTRY_FONT_SIZE) +
      LEGEND_ENTRY_TRAIL;
  }
  return w;
}

/** True when the controlsGroup should be hosted by the app overlay strip
 *  (gear suppressed, controls row + anchor reserved) rather than drawn inline.
 *  Never gates on the export path. */
function isAppHostedControls(config: LegendConfig, isExport: boolean): boolean {
  return (
    !isExport &&
    config.controlsHost === 'app' &&
    !!config.controlsGroup &&
    config.controlsGroup.toggles.length > 0
  );
}

function buildControlsGroupLayout(
  config: LegendConfig,
  state: LegendState
): ControlsGroupLayout | undefined {
  const cg = config.controlsGroup;
  if (!cg || cg.toggles.length === 0) return undefined;

  const expanded = !!state.controlsExpanded;
  const pillH = LEGEND_HEIGHT - LEGEND_CAPSULE_PAD * 2;

  if (!expanded) {
    // Collapsed: just a gear pill
    return {
      x: 0,
      y: 0,
      width: LEGEND_GEAR_PILL_W,
      height: LEGEND_HEIGHT,
      expanded: false,
      pill: { x: 0, y: 0, width: LEGEND_GEAR_PILL_W, height: LEGEND_HEIGHT },
      toggles: [],
    };
  }

  // Expanded capsule
  const capsuleW = controlsGroupCapsuleWidth(cg.toggles);
  const toggleLayouts: ControlsGroupToggleLayout[] = [];
  let tx = LEGEND_CAPSULE_PAD + LEGEND_GEAR_PILL_W + 4;

  for (const toggle of cg.toggles) {
    const dotCx = tx + LEGEND_TOGGLE_DOT_R;
    const dotCy = LEGEND_HEIGHT / 2;
    const textX = tx + LEGEND_TOGGLE_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP;
    const textY = LEGEND_HEIGHT / 2;

    toggleLayouts.push({
      id: toggle.id,
      label: toggle.label,
      active: toggle.active,
      dotCx,
      dotCy,
      textX,
      textY,
    });

    tx +=
      LEGEND_TOGGLE_DOT_R * 2 +
      LEGEND_ENTRY_DOT_GAP +
      measureLegendText(toggle.label, LEGEND_ENTRY_FONT_SIZE) +
      LEGEND_ENTRY_TRAIL;
  }

  return {
    x: 0,
    y: 0,
    width: capsuleW,
    height: LEGEND_HEIGHT,
    expanded: true,
    pill: {
      x: LEGEND_CAPSULE_PAD,
      y: LEGEND_CAPSULE_PAD,
      width: LEGEND_GEAR_PILL_W - LEGEND_CAPSULE_PAD * 2,
      height: pillH,
    },
    toggles: toggleLayouts,
  };
}

// ── Main layout computation ─────────────────────────────────

export function computeLegendLayout(
  config: LegendConfig,
  state: LegendState,
  containerWidth: number
): LegendLayout {
  const { groups, controls: configControls, mode } = config;
  const isExport = mode === 'export';

  // App-hosted controls: suppress the inline gear, reserve a header row + anchor.
  const gated = isAppHostedControls(config, isExport);

  // Filter groups for export: only active group shown
  const activeGroupName = state.activeGroup?.toLowerCase() ?? null;

  // In export mode with no active group and no groups, no legend
  if (isExport && !activeGroupName) {
    return {
      height: 0,
      width: 0,
      rows: [],
      controls: [],
      pills: [],
    };
  }

  // Controls group (gear): suppressed in export and when app-hosted.
  const controlsGroupLayout =
    isExport || gated ? undefined : buildControlsGroupLayout(config, state);

  const visibleGroups = config.showEmptyGroups
    ? groups
    : groups.filter((g) => g.entries.length > 0 || !!g.gradient);
  if (
    visibleGroups.length === 0 &&
    (!configControls || configControls.length === 0) &&
    !controlsGroupLayout
  ) {
    return {
      height: 0,
      width: 0,
      rows: [],
      controls: [],
      pills: [],
    };
  }

  // Compute control layouts (right-aligned)
  const controlLayouts: LegendControlLayout[] = [];
  let totalControlsW = 0;

  if (configControls && !isExport) {
    for (const ctrl of configControls) {
      const w = controlWidth(ctrl);
      const children = ctrl.children?.map((c) => ({
        id: c.id,
        label: c.label,
        x: 0,
        y: 0,
        width: measureLegendText(c.label, CONTROL_FONT_SIZE) + 12,
        ...(c.isActive !== undefined && { isActive: c.isActive }),
      }));
      controlLayouts.push({
        id: ctrl.id,
        x: 0, // positioned later
        y: 0,
        width: w,
        height: LEGEND_HEIGHT,
        icon: ctrl.icon,
        ...(ctrl.label !== undefined && { label: ctrl.label }),
        exportBehavior: ctrl.exportBehavior,
        ...(children !== undefined && { children }),
      });
      totalControlsW += w + CONTROL_GAP;
    }
    if (totalControlsW > 0) totalControlsW -= CONTROL_GAP; // remove trailing gap
  } else if (configControls && isExport) {
    // In export, include controls with exportBehavior 'include' or 'static'
    for (const ctrl of configControls) {
      if (ctrl.exportBehavior === 'strip') continue;
      const w = controlWidth(ctrl);
      const children = ctrl.children?.map((c) => ({
        id: c.id,
        label: c.label,
        x: 0,
        y: 0,
        width: measureLegendText(c.label, CONTROL_FONT_SIZE) + 12,
        ...(c.isActive !== undefined && { isActive: c.isActive }),
      }));
      controlLayouts.push({
        id: ctrl.id,
        x: 0,
        y: 0,
        width: w,
        height: LEGEND_HEIGHT,
        icon: ctrl.icon,
        ...(ctrl.label !== undefined && { label: ctrl.label }),
        exportBehavior: ctrl.exportBehavior,
        ...(children !== undefined && { children }),
      });
      totalControlsW += w + CONTROL_GAP;
    }
    if (totalControlsW > 0) totalControlsW -= CONTROL_GAP;
  }

  // Available width for tag groups (controls anchor right, gear pill at end of pills)
  const controlsSpace =
    totalControlsW > 0 ? totalControlsW + LEGEND_GROUP_GAP * 2 : 0;
  const gearSpace = controlsGroupLayout
    ? controlsGroupLayout.width + LEGEND_GROUP_GAP
    : 0;
  const groupAvailW = containerWidth - controlsSpace - gearSpace;

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
        groupAvailW,
        config.capsulePillAddonWidth ?? 0,
        config.capsuleTrailingAddonWidth ?? 0
      );
    } else if (!activeGroupName || config.showInactivePills) {
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
  const alignLeft = config.position.titleRelation === 'inline-with-title';
  const rows = layoutRows(
    activeCapsule,
    pills,
    controlLayouts,
    groupAvailW,
    containerWidth,
    totalControlsW,
    alignLeft,
    controlsGroupLayout
  );

  // App-hosted controls: the controlsGroup was dropped above (no gear), and the
  // app overlay strip pins itself to the top edge of the preview — dgmo reserves
  // no row and emits no anchor, so the chart reclaims that space.
  const height = rows.length * LEGEND_HEIGHT;
  const width = containerWidth;

  return {
    height,
    width,
    rows,
    ...(activeCapsule !== undefined && { activeCapsule }),
    controls: controlLayouts,
    pills,
    ...(controlsGroupLayout !== undefined && {
      controlsGroup: controlsGroupLayout,
    }),
  };
}

// ── Build capsule for active group ──────────────────────────

function buildCapsuleLayout(
  group: LegendGroupData,
  containerWidth: number,
  addonWidth = 0,
  trailWidth = 0
): LegendCapsuleLayout {
  if (group.gradient) return buildGradientCapsuleLayout(group, group.gradient);
  const pw = pillWidth(group.name);
  const info = capsuleWidth(
    group.name,
    group.entries,
    containerWidth,
    addonWidth,
    trailWidth
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
  const ex = LEGEND_CAPSULE_PAD + pw + 4 + addonWidth;
  let ey = 0;
  let rowX = ex;
  // Right boundary: one LEGEND_CAPSULE_PAD for right padding.
  // Left padding is already in ex/rowX starting position.
  const maxRowW = containerWidth - LEGEND_CAPSULE_PAD - trailWidth;
  let currentRow = 0;

  for (let i = 0; i < info.visibleEntries; i++) {
    const entry = group.entries[i]!;
    let ew = entryWidth(entry.value);

    if (info.entryRows > 1 && rowX + ew > maxRowW && rowX > ex && i > 0) {
      currentRow++;
      rowX = ex;
      ey = currentRow * LEGEND_HEIGHT;
    }

    let displayValue: string | undefined;
    const availW = maxRowW - rowX;
    if (ew > availW) {
      const textAvail =
        availW - (LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + LEGEND_ENTRY_TRAIL);
      if (textAvail > 0) {
        displayValue = truncateLegendText(
          entry.value,
          LEGEND_ENTRY_FONT_SIZE,
          textAvail
        );
        ew =
          LEGEND_DOT_R * 2 +
          LEGEND_ENTRY_DOT_GAP +
          measureLegendText(displayValue, LEGEND_ENTRY_FONT_SIZE) +
          LEGEND_ENTRY_TRAIL;
      }
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
      width: ew,
      dotCx,
      dotCy,
      textX,
      textY,
      ...(displayValue !== undefined && { displayValue }),
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
    ...(info.moreCount > 0 && { moreCount: info.moreCount }),
    ...(addonWidth > 0 && { addonX: LEGEND_CAPSULE_PAD + pw + 4 }),
    // After the last entry, on whatever row that entry ended on — `rowX` and
    // `ey` are exactly the cursor the loop left behind.
    ...(trailWidth > 0 && {
      trailingAddon: { x: rowX, y: ey, width: trailWidth },
    }),
  };
}

// ── Row layout ──────────────────────────────────────────────

function layoutRows(
  activeCapsule: LegendCapsuleLayout | undefined,
  pills: LegendPillLayout[],
  controls: LegendControlLayout[],
  groupAvailW: number,
  containerWidth: number,
  totalControlsW: number,
  alignLeft = false,
  controlsGroup?: ControlsGroupLayout
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

  // Controls group width for centering offset
  const gearW = controlsGroup ? controlsGroup.width + LEGEND_GROUP_GAP : 0;

  // Compute total group items width
  let currentRowItems: Array<
    LegendPillLayout | LegendCapsuleLayout | LegendControlLayout
  > = [];
  let currentRowW = 0;
  let rowY = 0;

  for (const item of groupItems) {
    const itemW = item.width + LEGEND_GROUP_GAP;
    if (currentRowW + item.width > groupAvailW && currentRowItems.length > 0) {
      // Commit current row (row 0 needs gear space deducted for centering)
      if (!alignLeft) {
        const rowGearW = rows.length === 0 ? gearW : 0;
        centerRowItems(
          currentRowItems,
          containerWidth,
          totalControlsW,
          rowGearW
        );
      }
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
      const ctrl = controls[i]!;
      cx -= ctrl.width;
      ctrl.x = cx;
      ctrl.y = 0;
      cx -= CONTROL_GAP;
    }
    // Controls go on first row
    if (rows.length > 0) {
      rows[0]!.items.push(...controls);
    } else if (currentRowItems.length > 0) {
      currentRowItems.push(...controls);
    } else {
      // Only controls, no groups
      currentRowItems.push(...controls);
    }
  }

  // Commit last row
  if (currentRowItems.length > 0) {
    if (!alignLeft) {
      centerRowItems(currentRowItems, containerWidth, totalControlsW, gearW);
    }
    rows.push({ y: rowY, items: currentRowItems });
  }

  // Position controls group AFTER centering so it follows the shifted items
  if (controlsGroup) {
    const row0Items = rows[0]?.items ?? [];
    const groupItemsInRow0 = row0Items.filter(
      (it) => 'groupName' in it
    ) as Array<LegendPillLayout | LegendCapsuleLayout>;
    if (groupItemsInRow0.length > 0) {
      const last = groupItemsInRow0[groupItemsInRow0.length - 1]!;
      controlsGroup.x = last.x + last.width + LEGEND_GROUP_GAP;
    } else {
      // No group items — center the controls group
      controlsGroup.x = (containerWidth - controlsGroup.width) / 2;
    }
    controlsGroup.y = 0;
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
  totalControlsW: number,
  controlsGroupW = 0
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
    (totalControlsW > 0 ? totalControlsW + LEGEND_GROUP_GAP * 2 : 0) -
    controlsGroupW;
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

export function getMaxLegendReservedHeight(
  config: LegendConfig,
  containerWidth: number
): number {
  const groups = config.groups;
  if (groups.length === 0) return LEGEND_HEIGHT;
  const addon = config.capsulePillAddonWidth ?? 0;
  const trail = config.capsuleTrailingAddonWidth ?? 0;
  let max = LEGEND_HEIGHT;
  for (const g of groups) {
    if (g.entries.length === 0) continue;
    const info = capsuleWidth(g.name, g.entries, containerWidth, addon, trail);
    const h = info.entryRows * LEGEND_HEIGHT;
    if (h > max) max = h;
  }
  return max;
}

/**
 * Natural rendered extent (content width + height) of a legend at a given
 * container width, computed from the shared layout engine — no DOM/string
 * rendering. Used by the §1.9 `legend-inline` fit test (decision #50): a legend
 * whose extent height stays one row and whose width fits beside the title may go
 * inline; otherwise the header falls back to stacked. Pass a generous
 * `containerWidth` (e.g. the full chart width) to read the single-row width.
 */
export function getLegendExtent(
  config: LegendConfig,
  state: LegendState,
  containerWidth: number
): { width: number; height: number } {
  const layout = computeLegendLayout(config, state, containerWidth);
  let left = Infinity;
  let right = 0;
  let bottom = 0;
  const track = (x: number, y: number, w: number, h: number): void => {
    left = Math.min(left, x);
    right = Math.max(right, x + w);
    bottom = Math.max(bottom, y + h);
  };
  if (layout.activeCapsule) {
    const c = layout.activeCapsule;
    track(c.x, c.y, c.width, c.height);
  }
  for (const pill of layout.pills)
    track(pill.x, pill.y, pill.width, pill.height);
  return {
    width: right - (left === Infinity ? 0 : left),
    height: bottom || LEGEND_HEIGHT,
  };
}
