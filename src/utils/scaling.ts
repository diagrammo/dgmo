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

  /**
   * Fit content into a bounding box, scaling by whichever dimension is more
   * constraining (the smaller of the width- and height-fit ratios) so the
   * diagram never overflows the canvas in either axis. Like {@link from}, the
   * factor is clamped to `[minScaleFactor, 1]` (content is never enlarged, and
   * never shrunk past the readability floor).
   */
  static fromBox(
    containerWidth: number,
    idealWidth: number,
    containerHeight: number,
    idealHeight: number,
    minScaleFactor = DEFAULT_MIN_SCALE_FACTOR
  ): ScaleContext {
    const wRaw = idealWidth > 0 ? containerWidth / idealWidth : 1;
    const hRaw = idealHeight > 0 ? containerHeight / idealHeight : 1;
    const raw = Math.min(wRaw, hRaw);
    const clamped = Math.max(Math.min(raw, 1), minScaleFactor);
    return new ScaleContext(clamped, minScaleFactor);
  }

  /**
   * Build a context from an explicit raw factor (clamped to
   * `[minScaleFactor, 1]`). Used to refine a fit iteratively: layout scaling is
   * non-linear (gaps shrink faster than floored text), so the first-pass factor
   * can still overflow — re-measure the laid-out result and tighten.
   */
  static fromFactor(
    rawFactor: number,
    minScaleFactor = DEFAULT_MIN_SCALE_FACTOR
  ): ScaleContext {
    const clamped = Math.max(Math.min(rawFactor, 1), minScaleFactor);
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
