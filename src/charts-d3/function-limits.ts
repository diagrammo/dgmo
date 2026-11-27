// ============================================================
// function — the magnitude limit (#2437, owner's decision 2026-11-26)
// ============================================================
//
// A curve like exp(1000*x) on 0..10 returns finite samples up to ~1.8e308
// before it overflows to Infinity. Such values cannot share an axis with
// ordinary ones: the plot collapses and every tick label is hundreds of
// digits wide. The parser samples each function exactly as the renderer
// does; a function past FUNCTION_MAX_ABS_Y raises an error and is not drawn.

import type { DiagnosticSpec } from '../diagnostics';
import { evaluateExpressionRaw } from '../utils/expr-eval';

/** Samples per curve, shared by the overflow check and the renderer. */
export const FUNCTION_SAMPLES = 200;

/**
 * Largest |y| a function chart plots. 1e15 is past every realistic quantity
 * and still below 2^53 (~9e15), where doubles stop holding whole numbers.
 */
export const FUNCTION_MAX_ABS_Y = 1e15;

/** Largest |tick| printed in full; past it ticks print compact (10T). */
export const FUNCTION_FULL_TICKS_BELOW = 1e6;

/** The x values a curve is evaluated at. */
export function functionSampleXs(xr: { min: number; max: number }): number[] {
  const step = (xr.max - xr.min) / FUNCTION_SAMPLES;
  const xs: number[] = [];
  for (let i = 0; i <= FUNCTION_SAMPLES; i++) xs.push(xr.min + i * step);
  return xs;
}

/**
 * True when a curve cannot be plotted: a finite sample past
 * FUNCTION_MAX_ABS_Y, or ±Infinity on more than half the samples. A lone
 * infinite sample (1/x at 0) is a pole the renderer already skips.
 */
export function functionOverflows(
  expression: string,
  xs: readonly number[]
): boolean {
  let infinite = 0;
  for (const x of xs) {
    const y = evaluateExpressionRaw(expression, x);
    if (Number.isNaN(y)) continue;
    if (!isFinite(y)) infinite++;
    else if (Math.abs(y) > FUNCTION_MAX_ABS_Y) return true;
  }
  return infinite * 2 > xs.length;
}

export const FUNCTION_DX = {
  OVERFLOW: {
    code: 'E_FUNCTION_OVERFLOW',
    severity: 'error',
    chartType: 'function',
    title: 'Function too large to plot',
    message: (p) =>
      `Overflow ${(p.name as string) ?? 'function'}: ${(p.expression as string) ?? 'this function'} grows past 1e15 on x ${(p.range as string) ?? 'the x range'} and cannot be plotted. Narrow the x range or rescale the function.`,
    hint: 'Keep every value within 1e15 of zero: narrow the x range with `x-axis`, or divide the function by a constant.',
    example: `function Growth\n\nx-axis 0..10\n\nslow: exp(x / 2)`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const FUNCTION_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(FUNCTION_DX);
