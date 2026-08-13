/**
 * Find every month-name date literal in `line` (`Jan 3`, `3 January`,
 * `Jan 3, 2026`, `3 Jan 2026`) and return the char-offset span of each whole
 * literal, left-to-right and non-overlapping.
 *
 * The Lezer grammar already tokenizes numeric/ISO/slash dates as `DateLiteral`,
 * but it cannot join a month word and its day across a space — this powers a
 * highlight post-pass that colors them like numeric dates. It mirrors the
 * MONTH_D / D_MONTH parser arms exactly — same regex shape plus the
 * `monthNameToNum` guard — so highlighting matches parser acceptance, including
 * its month-prefix over-acceptance (e.g. `Marina` → March). It is intentionally
 * liberal about position (matches anywhere in the line, not just the front) so
 * a date mid-label (`Task  Jan 3`) still highlights.
 */
declare function scanMonthNameDates(line: string): Array<{
    start: number;
    end: number;
}>;

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
interface ColorDirectiveRule {
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
declare const COLOR_DIRECTIVES: ReadonlyMap<string, ReadonlyMap<string, ColorDirectiveRule>>;
/** The rule for a directive on a chart type, or null when it takes no color. */
declare function colorDirectiveRule(chartType: string | null | undefined, directive: string): ColorDirectiveRule | null;

/**
 * Standalone DGMO syntax highlighter — no CodeMirror dependency.
 *
 * Exports:
 *   - `highlightDgmo(source)` → `HighlightToken[]` (consumer-agnostic)
 *   - `NORD_ROLE_STYLES` — inline style objects keyed by role (for React/Astro)
 *   - `ROLE_TO_ANSI` — ANSI escape codes keyed by role (for CLI)
 *
 * Uses the raw Lezer parser directly — keyword specialization is wired into
 * the grammar, so `parser.parse()` runs it automatically.
 *
 * @module @diagrammo/dgmo/highlight
 */

interface HighlightToken {
    text: string;
    role: string;
}
declare const NODE_TO_ROLE: Record<string, string>;
/**
 * Tokenize DGMO source into annotated highlight spans.
 *
 * Guarantees lossless round-trip:
 *   `highlightDgmo(src).map(t => t.text).join('') === src`
 */
declare function highlightDgmo(source: string): HighlightToken[];
/**
 * Colon `key: value` attribute keys that highlight as `propertyName`. This is
 * the single source of truth for attribute-key highlighting — the standalone
 * `applyAttributeKeys()` pass below and the desktop app's attribute-key
 * ViewPlugin both consume it, so the two render paths can't drift.
 */
declare const ATTRIBUTE_KEYS: Set<string>;
/** A role override for one token span on a recurrence line. */
interface RecurrenceSpan {
    /** Char offset of the token within the line. */
    start: number;
    /** Char offset (exclusive) of the token end within the line. */
    end: number;
    role: 'keyword' | 'modifier';
}
/**
 * Classify the significant tokens on a countdown recurrence line. Returns the
 * spans to re-role: sub-keywords (`every`/`on`/`at`/`from` + cadence units) →
 * `keyword`, closed instant vocab (month/weekday names, ordinals) → `modifier`.
 * Numeric tokens (day, `HH:MM`, dates) already tokenize as numbers, so they are
 * left alone. Returns `[]` for any non-recurrence line.
 */
declare function classifyRecurrenceLine(line: string): RecurrenceSpan[];
declare const NORD_ROLE_STYLES: Record<string, Record<string, string>>;
/**
 * Light-background counterpart of NORD_ROLE_STYLES for static contexts
 * (marketing site, light-mode source panels). Same role keys — a parity test
 * (tests/block.test.ts) guards the two maps and the `.dgmo-tok-*` rules in
 * block/css.ts against drift. Colors are darker AA-targeting tones tuned for
 * a light code panel (bg ~#f3f5f8). Moved here from the site repo's
 * hand-maintained mirror (BL-114).
 */
declare const LIGHT_ROLE_STYLES: Record<string, Record<string, string>>;
declare const ROLE_TO_ANSI: Record<string, string>;
/**
 * Render highlighted tokens to an ANSI string for terminal display.
 */
declare function renderAnsi(tokens: HighlightToken[], useColor: boolean): string;

export { ATTRIBUTE_KEYS, COLOR_DIRECTIVES, type ColorDirectiveRule, type HighlightToken, LIGHT_ROLE_STYLES, NODE_TO_ROLE, NORD_ROLE_STYLES, ROLE_TO_ANSI, type RecurrenceSpan, classifyRecurrenceLine, colorDirectiveRule, highlightDgmo, renderAnsi, scanMonthNameDates };
