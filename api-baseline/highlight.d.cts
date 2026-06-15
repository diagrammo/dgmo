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
declare const NORD_ROLE_STYLES: Record<string, Record<string, string>>;
declare const ROLE_TO_ANSI: Record<string, string>;
/**
 * Render highlighted tokens to an ANSI string for terminal display.
 */
declare function renderAnsi(tokens: HighlightToken[], useColor: boolean): string;

export { ATTRIBUTE_KEYS, type HighlightToken, NODE_TO_ROLE, NORD_ROLE_STYLES, ROLE_TO_ANSI, highlightDgmo, renderAnsi };
