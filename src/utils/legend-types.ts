// ============================================================
// Centralized legend system — shared type definitions
// ============================================================

import type { Selection } from 'd3-selection';

// ── State ───────────────────────────────────────────────────

export interface LegendState {
  activeGroup: string | null;
  hiddenAttributes?: Set<string>;
}

export interface LegendCallbacks {
  onGroupToggle?: (groupName: string) => void;
  onVisibilityToggle?: (attribute: string) => void;
  onStateChange?: (newState: LegendState) => void;
  /** Called when an entry is hovered. Chart renderers can use this for cross-element highlighting. */
  onEntryHover?: (groupName: string, entryValue: string | null) => void;
  /** Called after each group <g> is rendered — lets chart renderers inject custom elements (swimlane icons, etc.) */
  onGroupRendered?: (
    groupName: string,
    groupEl: D3Sel,
    isActive: boolean
  ) => void;
}

// ── Position & Layout ───────────────────────────────────────

export interface LegendPosition {
  placement: 'top-center';
  titleRelation: 'below-title' | 'inline-with-title';
}

export type LegendMode = 'fixed' | 'inline';

export type LegendControlExportBehavior = 'include' | 'strip' | 'static';

export interface LegendControl {
  id: string;
  /** SVG markup for the control icon, or a string label */
  icon: string;
  label?: string;
  exportBehavior: LegendControlExportBehavior;
  onClick?: () => void;
  children?: LegendControlEntry[];
}

export interface LegendControlEntry {
  id: string;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}

// ── Config ──────────────────────────────────────────────────

export interface LegendConfig {
  groups: import('./legend-svg').LegendGroupData[];
  position: LegendPosition;
  controls?: LegendControl[];
  mode: LegendMode;
  /** Title width in pixels — used for inline-with-title computation */
  titleWidth?: number;
  /** Extra width (px) reserved after the pill inside an active capsule (e.g. for eye icon addon). Entries start after this offset. */
  capsulePillAddonWidth?: number;
  /** When true, groups with no entries are still rendered as collapsed pills. Default: false (empty groups hidden). */
  showEmptyGroups?: boolean;
}

export interface LegendPalette {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  primary?: string;
}

// ── Layout output ───────────────────────────────────────────

export interface LegendPillLayout {
  groupName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
}

export interface LegendEntryLayout {
  value: string;
  color: string;
  x: number;
  y: number;
  dotCx: number;
  dotCy: number;
  textX: number;
  textY: number;
}

export interface LegendCapsuleLayout {
  groupName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pill: LegendPillLayout;
  entries: LegendEntryLayout[];
  /** Overflow indicator when entries exceed max rows */
  moreCount?: number;
  /** X offset where addon content (e.g. eye icon) can be placed — after pill, before entries */
  addonX?: number;
}

export interface LegendControlLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  icon: string;
  label?: string;
  exportBehavior: LegendControlExportBehavior;
  children?: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    isActive?: boolean;
  }>;
}

export interface LegendRowLayout {
  y: number;
  items: Array<LegendPillLayout | LegendCapsuleLayout | LegendControlLayout>;
}

export interface LegendLayout {
  /** Total computed height including all rows */
  height: number;
  /** Total computed width */
  width: number;
  /** Rows of legend elements (pills wrap to new rows on overflow) */
  rows: LegendRowLayout[];
  /** Active capsule layout (if any group is active) */
  activeCapsule?: LegendCapsuleLayout;
  /** Control layouts (right-aligned) */
  controls: LegendControlLayout[];
  /** All pill layouts (collapsed groups) */
  pills: LegendPillLayout[];
}

// ── Handle ──────────────────────────────────────────────────

export interface LegendHandle {
  setState: (state: LegendState) => void;
  destroy: () => void;
  getHeight: () => number;
  getLayout: () => LegendLayout;
}

// ── D3 selection shorthand ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type D3Sel = Selection<any, unknown, any, unknown>;
