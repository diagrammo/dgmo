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
  name: string;
  lineNumber: number;
}

export interface TechRadarBlip {
  name: string;
  ring: string;
  trend: BlipTrend | null;
  description: string[];
  lineNumber: number;
  /** Assigned after parsing — global numbering across all quadrants. */
  globalNumber: number;
}

export interface TechRadarQuadrant {
  name: string;
  position: QuadrantPosition;
  color: string | null;
  lineNumber: number;
  blips: TechRadarBlip[];
}

export interface ParsedTechRadar {
  type: 'tech-radar';
  title: string;
  titleLineNumber: number;
  rings: TechRadarRing[];
  quadrants: TechRadarQuadrant[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
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
}
