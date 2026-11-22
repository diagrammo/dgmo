import type { DgmoError } from '../diagnostics';
import type { AxisSpec } from '../utils/axis-spec';
import type { ChartFrame } from '../utils/chart-frame-parse';
import type { NumberFormatSpec } from '../utils/number-format';

/** One `series` name: a column of values, drawn as one colour of dot. */
export interface DotSeries {
  readonly name: string;
  /** An authored trailing colour name (§1.5), resolved when drawn. */
  readonly color?: string;
  readonly lineNumber: number;
}

export interface DotRow {
  readonly label: string;
  /** One value per series, in `series` order. */
  readonly values: readonly number[];
  readonly lineNumber: number;
}

/** `sort gap` / `sort <series>` / `sort name`; absent ⇒ as written. */
export type DotSort =
  | { readonly by: 'gap' }
  | { readonly by: 'name' }
  | { readonly by: 'series'; readonly index: number };

/** `connector direction` colours each connector by its row's rise or fall;
 *  `connector direction down` flips it, for when a fall is good. */
export type DotConnector = 'grey' | 'direction' | 'direction-down';

export interface ParsedDot {
  readonly type: 'dot';
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  readonly frame?: ChartFrame;
  readonly title?: string;
  readonly titleLineNumber?: number;
  /** The `series` names; empty when the chart has one value per row and no
   *  `series` line. */
  readonly series: readonly DotSeries[];
  /** The rows in drawn order: sorted when `sort` is set, else as written. */
  readonly rows: readonly DotRow[];
  readonly sort?: DotSort;
  /** `gap`: print last − first at each row's right end. */
  readonly gap: boolean;
  readonly connector: DotConnector;
  /** The `x-axis` range and scale (#1830, decision #60). */
  readonly xAxis?: AxisSpec;
  /** `format`, `unit`, `locale` (#1831). */
  readonly numberFormat?: NumberFormatSpec;
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
