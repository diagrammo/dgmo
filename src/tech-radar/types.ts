import type { DgmoError } from '../diagnostics';

// ============================================================
// Tech Radar — Parsed Types
// ============================================================

export type QuadrantPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type BlipTrend = 'new' | 'up' | 'down' | 'stable';

export interface TechRadarRing {
  readonly name: string;
  readonly alias: string | null;
  readonly lineNumber: number;
}

export interface TechRadarBlip {
  readonly name: string;
  readonly ring: string;
  readonly trend: BlipTrend | null;
  readonly description: readonly string[];
  readonly lineNumber: number;
  /** Assigned after parsing — global numbering across all quadrants. */
  readonly globalNumber: number;
}

export interface TechRadarQuadrant {
  readonly name: string;
  readonly position: QuadrantPosition;
  readonly color: string | null;
  readonly lineNumber: number;
  readonly blips: readonly TechRadarBlip[];
}

export interface ParsedTechRadar {
  readonly type: 'tech-radar';
  readonly title: string;
  readonly titleLineNumber: number;
  readonly rings: readonly TechRadarRing[];
  readonly quadrants: readonly TechRadarQuadrant[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

// ============================================================
// Tech Radar — Layout Types
// ============================================================

export interface TechRadarLayoutPoint {
  blip: TechRadarBlip;
  x: number;
  y: number;
  quadrantIndex: number;
  ringIndex: number;
}

// ============================================================
// Tech Radar — Render Options
// ============================================================

export interface TechRadarRenderOptions {
  /** Whether the blip listing is visible. Default: true for export, false for interactive. */
  showListing?: boolean;
  /** Callback when the listing toggle is clicked. */
  onToggleListing?: (show: boolean) => void;
  /** Whether the controls legend capsule is expanded. */
  controlsExpanded?: boolean;
  /** Callback when the controls gear pill is clicked (expand/collapse). */
  onToggleControlsExpand?: () => void;
  /** Active legend group name (e.g. 'Trends'). */
  activeLegendGroup?: string | null;
  /** Callback when a legend group pill is toggled. */
  onLegendGroupToggle?: (groupName: string) => void;
  /** Active line from the editor cursor — triggers popover/expansion for that blip. */
  activeLine?: number | null;
  /** True when rendering for export (PNG/SVG/PDF) — controls whether collapsed legend pills and cog are stripped. */
  exportMode?: boolean;
  /** When 'app', the Blip Legend toggle is hosted by the app overlay strip
   *  (inline gear suppressed, controls row + anchor reserved). */
  controlsHost?: 'app' | 'inline';
}
