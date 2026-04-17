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
