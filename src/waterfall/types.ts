import type { DgmoError } from '../diagnostics';
import type { ChartFrame } from '../utils/chart-frame-parse';
import type { NumberFormatSpec } from '../utils/number-format';

/** What a bar is: a change up, a change down, or a total from zero. */
export type WaterfallKind = 'rise' | 'fall' | 'total';

export interface WaterfallRow {
  readonly label: string;
  readonly kind: WaterfallKind;
  /** The number the bar prints: the signed change of a step, or the level of a
   *  total. */
  readonly value: number;
  /** Where the bar starts and ends on the value axis. A step floats from the
   *  running total before it to the one after it; a total runs from 0. */
  readonly from: number;
  readonly to: number;
  /** An authored trailing colour name (§1.5), which overrides the rise / fall /
   *  total hue. Resolved against the palette when drawn. */
  readonly color?: string;
  readonly lineNumber: number;
}

export interface ParsedWaterfall {
  readonly type: 'waterfall';
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  readonly frame?: ChartFrame;
  readonly title?: string;
  readonly titleLineNumber?: number;
  /** The rows in source order, already walked. */
  readonly rows: readonly WaterfallRow[];
  /** `direction down`: a rise is bad (a cost bridge), so it takes red. */
  readonly directionDown: boolean;
  /** `no-connectors` turns the dashed running-total connectors off. */
  readonly connectors: boolean;
  /** `no-value` turns the value labels off. */
  readonly values: boolean;
  /** `orientation-horizontal` (or `horizontal`): steps down the left. */
  readonly horizontal: boolean;
  /** `format`, `unit`, `locale` (#1831). */
  readonly numberFormat?: NumberFormatSpec;
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
