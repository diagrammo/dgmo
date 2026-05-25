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
// Minimum dimensions formula table
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

const DEFAULT_MIN = { width: 300, height: 200 };

export function computeMinDimensions(
  chartType: string,
  counts: ContentCounts
): { width: number; height: number } {
  switch (chartType) {
    case 'sequence':
      return {
        width: Math.max((counts.participants ?? 2) * 80, 320),
        height: Math.max((counts.messages ?? 1) * 20 + 120, 200),
      };
    case 'raci':
      return {
        width: Math.max((counts.roles ?? 2) * 50 + 180, 300),
        height: Math.max((counts.tasks ?? 1) * 28 + 80, 200),
      };
    case 'mindmap':
      return {
        width: Math.max((counts.nodes ?? 3) * 30, 300),
        height: Math.max((counts.depth ?? 2) * 60, 200),
      };
    case 'tech-radar':
      return { width: 360, height: 400 };
    case 'heatmap':
      return {
        width: Math.max((counts.columns ?? 3) * 40, 300),
        height: Math.max((counts.rows ?? 3) * 30 + 60, 200),
      };
    case 'arc':
      return {
        width: 300,
        height: Math.max((counts.nodes ?? 3) * 20 + 120, 200),
      };
    case 'org':
      return {
        width: Math.max((counts.nodes ?? 3) * 60, 300),
        height: Math.max((counts.depth ?? 2) * 80, 200),
      };
    case 'gantt':
      return {
        width: 400,
        height: Math.max((counts.tasks ?? 3) * 24 + 80, 200),
      };
    case 'kanban':
      return {
        width: Math.max((counts.columns ?? 3) * 120, 360),
        height: 300,
      };
    case 'er':
      return {
        width: Math.max((counts.nodes ?? 2) * 140, 300),
        height: Math.max((counts.nodes ?? 2) * 80, 200),
      };
    case 'class':
      return {
        width: Math.max((counts.nodes ?? 2) * 140, 300),
        height: Math.max((counts.nodes ?? 2) * 80, 200),
      };
    case 'flowchart':
    case 'state':
      return {
        width: Math.max((counts.nodes ?? 3) * 60, 300),
        height: Math.max((counts.nodes ?? 3) * 50, 200),
      };
    case 'pert':
      return {
        width: Math.max((counts.tasks ?? 3) * 80, 340),
        height: Math.max((counts.tasks ?? 3) * 40 + 80, 200),
      };
    case 'infra':
      return {
        width: Math.max((counts.nodes ?? 3) * 80, 300),
        height: Math.max((counts.nodes ?? 3) * 60, 200),
      };
    default:
      return { ...DEFAULT_MIN };
  }
}
