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

export { ATTRIBUTE_KEYS, type HighlightToken, LIGHT_ROLE_STYLES, NODE_TO_ROLE, NORD_ROLE_STYLES, ROLE_TO_ANSI, type RecurrenceSpan, classifyRecurrenceLine, highlightDgmo, renderAnsi, scanMonthNameDates };
