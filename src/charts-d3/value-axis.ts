// ============================================================
// One numeric axis, built from the data extent and the author's AxisSpec
// (#1830): linear or log, with optional fixed ends. Bar, line, scatter,
// function and slope all build their value axis here, so a log axis or a
// fixed range behaves the same on every chart type.
// ============================================================

import { scaleLinear, scaleLog } from 'd3-scale';
import type { AxisSpec } from '../utils/axis-spec';

export interface ValueAxis {
  /** Data value → pixel. */
  (v: number): number;
  domain(): [number, number];
  /** Tick values for about `count` ticks. Log axes return decade ticks. */
  ticks(count: number): number[];
  isLog: boolean;
  /** Where a bar or an area starts: 0 held inside the domain, or the log floor. */
  baseline: number;
}

const LOG_STEPS = [1, 2, 5] as const;

/**
 * Build the axis. `lo`/`hi` are the auto-fit ends the chart would use with
 * no directive (padding included). `spec.min`/`spec.max` replace them; the
 * free end alone is rounded with `.nice()` when `nice` is set. A log scale
 * applies only when both ends are above 0; the parser has already warned.
 */
export function buildValueAxis(
  lo: number,
  hi: number,
  spec: AxisSpec | undefined,
  range: [number, number],
  opts: { nice?: boolean; dataLo?: number; dataHi?: number } = {}
): ValueAxis {
  const fixedLo = spec?.min;
  const fixedHi = spec?.max;
  const dataLo = opts.dataLo ?? lo;
  const dataHi = opts.dataHi ?? hi;
  const wantLog = spec?.scale === 'log';
  const logLo =
    fixedLo ?? (dataLo > 0 ? 10 ** Math.floor(Math.log10(dataLo)) : NaN);
  const logHi =
    fixedHi ?? (dataHi > 0 ? 10 ** Math.ceil(Math.log10(dataHi)) : NaN);
  if (wantLog && logLo > 0 && logHi > logLo) {
    const s = scaleLog().domain([logLo, logHi]).range(range);
    if (fixedLo !== undefined || fixedHi !== undefined) s.clamp(true);
    const axis = ((v: number) => s(v)) as ValueAxis;
    axis.domain = () => [logLo, logHi];
    axis.ticks = () => logTicks(logLo, logHi);
    axis.isLog = true;
    axis.baseline = logLo;
    return axis;
  }

  let a = fixedLo ?? lo;
  let b = fixedHi ?? hi;
  if (!(b > a)) b = a + 1;
  if (opts.nice && (fixedLo === undefined || fixedHi === undefined)) {
    const [na, nb] = scaleLinear().domain([a, b]).nice().domain() as [
      number,
      number,
    ];
    if (fixedLo === undefined) a = na;
    if (fixedHi === undefined) b = nb;
  }
  const s = scaleLinear().domain([a, b]).range(range);
  if (fixedLo !== undefined || fixedHi !== undefined) s.clamp(true);
  const axis = ((v: number) => s(v)) as ValueAxis;
  axis.domain = () => [a, b];
  axis.ticks = (count: number) => {
    const t = s.ticks(count);
    // A fixed end is a value the author chose: label it even off the stride.
    if (fixedLo !== undefined && !t.some((v) => Math.abs(v - a) < 1e-9))
      t.unshift(a);
    if (fixedHi !== undefined && !t.some((v) => Math.abs(v - b) < 1e-9))
      t.push(b);
    return dropCrowdedEnds(
      t,
      a,
      b,
      fixedLo !== undefined,
      fixedHi !== undefined
    );
  };
  axis.isLog = false;
  axis.baseline = Math.min(Math.max(0, a), b);
  return axis;
}

/**
 * Decade ticks: every power of ten in the domain. When that leaves fewer
 * than three, add the 2× and 5× steps so a narrow log axis still reads.
 */
export function logTicks(lo: number, hi: number): number[] {
  const first = Math.floor(Math.log10(lo));
  const last = Math.ceil(Math.log10(hi));
  const within = (v: number) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9);
  const decades: number[] = [];
  for (let e = first; e <= last; e++) {
    const v = 10 ** e;
    if (within(v)) decades.push(v);
  }
  if (decades.length >= 3) return decades;
  const out: number[] = [];
  for (let e = first; e <= last; e++)
    for (const k of LOG_STEPS) {
      const v = k * 10 ** e;
      if (within(v)) out.push(v);
    }
  return out;
}

/**
 * Drop a stride tick within 4% of an end the author fixed, so the two labels
 * never touch. An auto-rounded end is left alone: its ticks are on-stride.
 */
function dropCrowdedEnds(
  t: number[],
  a: number,
  b: number,
  fixedA: boolean,
  fixedB: boolean
): number[] {
  const gap = (b - a) * 0.04;
  const at = (v: number, e: number) => Math.abs(v - e) < 1e-9;
  return t.filter(
    (v) =>
      at(v, a) ||
      at(v, b) ||
      ((!fixedA || v - a >= gap) && (!fixedB || b - v >= gap))
  );
}
