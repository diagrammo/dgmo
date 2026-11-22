// ============================================================
// Calendar — the shape every layout hands the renderer (§41.3).
// ============================================================

import type { DayNumber } from './types';

/** One day's tile and where it sits. */
export interface Cell {
  day: DayNumber;
  x: number;
  y: number;
}

export interface Label {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  cls: string;
  bold?: boolean;
  /** `YYYY-MM`: the label finds its month's days on hover. */
  month?: string;
  /** Font size; the layouts' shared label size when absent. */
  size?: number;
  /** Drawn in the faint ink (weekend column heads in `layout month`). */
  faint?: boolean;
}

export interface Geometry {
  cells: Cell[];
  labels: Label[];
  cellW: number;
  cellH: number;
  pitchX: number;
  pitchY: number;
  /** Right and bottom edge of the drawing, in root units. */
  right: number;
  bottom: number;
  /** Tile tinted as a weekend. */
  weekend: (day: DayNumber) => boolean;
}
