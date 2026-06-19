const DEFAULT_MIN_SCALE_FACTOR = 0.5;
const TEXT_FLOOR = 9;

export class ScaleContext {
  readonly factor: number;
  readonly isBelowFloor: boolean;

  private constructor(factor: number, minScaleFactor: number) {
    this.factor = factor;
    this.isBelowFloor = factor <= minScaleFactor;
  }

  static from(
    containerSize: number,
    idealSize: number,
    minScaleFactor = DEFAULT_MIN_SCALE_FACTOR
  ): ScaleContext {
    if (idealSize <= 0) return ScaleContext.identity();
    const raw = containerSize / idealSize;
    const clamped = Math.max(Math.min(raw, 1), minScaleFactor);
    return new ScaleContext(clamped, minScaleFactor);
  }

  static identity(): ScaleContext {
    return new ScaleContext(1, DEFAULT_MIN_SCALE_FACTOR);
  }

  aesthetic(value: number): number {
    if (this.factor >= 1) return value;
    return value * this.factor ** 1.5;
  }

  structural(value: number): number {
    if (this.factor >= 1) return value;
    return value * this.factor;
  }

  text(fontSize: number, floor = TEXT_FLOOR): number {
    if (this.factor >= 1) return fontSize;
    return Math.max(fontSize * this.factor, floor);
  }
}

// ============================================================
// ContentCounts — per-chart-type content tallies that feed the registry's
// `minDims` formulas (chart-type-registry.ts). The formulas themselves moved
// there (Story 111.5) so a chart type's sizing is defined in one descriptor.
// ============================================================

export interface ContentCounts {
  items?: number;
  columns?: number;
  rows?: number;
  participants?: number;
  nodes?: number;
  depth?: number;
  messages?: number;
  tasks?: number;
  roles?: number;
  blips?: number;
}
