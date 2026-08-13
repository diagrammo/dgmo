/**
 * Which directives take a trailing color, and how many.
 *
 * §1.5's trailing-token color rule applies to a handful of DIRECTIVE lines as
 * well as to data lines, and each parser implements it locally — `extractColor`
 * here, `peelTrailingColorName` there, `peelRampColors` for the value ramp.
 * An editor cannot recover that from the grammar: `lane Writer gray` colors a
 * lane and `lane gray` names one, and the two are the same shape.
 *
 * So the rules live here, beside the language, and ship through
 * `@diagrammo/dgmo/highlight` for any editor that highlights DGMO.
 * `tests/color-directives.test.ts` drives every entry through the real parser
 * and fails when the table and the parser disagree — the table is a claim
 * about behavior, and an unchecked claim is how the app's copy of this came to
 * paint a color on `marker <date> orange`, which names a milestone "orange".
 */

/** How a directive's trailing color tokens peel. */
export interface ColorDirectiveRule {
  /** Most trailing colors the parser peels. Two only for a value ramp. */
  readonly max: number;
  /**
   * True when the directive's label is optional, so a color needs nothing in
   * front of it — `now blue` and `now 2026-01-01 blue` both color the pin.
   *
   * Everywhere else a lone trailing token IS the label: `lane gray` names a
   * lane "gray", `persona green` a persona "green". A color peels only when a
   * label token precedes it, and a date does not count as one.
   */
  readonly labelOptional?: boolean;
}

/**
 * Chart type → directive → rule. Absence means "this directive takes no
 * trailing color", which is the case for the overwhelming majority — a
 * directive's value is usually prose or a number, and `note the sky is blue`
 * ends in a color word while meaning nothing of the sort.
 *
 * Gantt's `era` is deliberately absent even though it takes a color: its date
 * range makes it an arrow line, which every editor already treats as a data
 * line and colors through the ordinary trailing-token path.
 */
export const COLOR_DIRECTIVES: ReadonlyMap<
  string,
  ReadonlyMap<string, ColorDirectiveRule>
> = new Map([
  ['event-line', new Map([['now', { max: 1, labelOptional: true }]])],
  ['gantt', new Map([['marker', { max: 1 }]])],
  ['swimlane', new Map([['lane', { max: 1 }]])],
  ['journey-map', new Map([['persona', { max: 1 }]])],
  ['map', new Map([['region-heat', { max: 2 }]])],
  [
    'quadrant',
    new Map([
      ['top-right', { max: 1 }],
      ['top-left', { max: 1 }],
      ['bottom-right', { max: 1 }],
      ['bottom-left', { max: 1 }],
    ]),
  ],
]);

/** The rule for a directive on a chart type, or null when it takes no color. */
export function colorDirectiveRule(
  chartType: string | null | undefined,
  directive: string
): ColorDirectiveRule | null {
  if (!chartType) return null;
  return COLOR_DIRECTIVES.get(chartType)?.get(directive) ?? null;
}
