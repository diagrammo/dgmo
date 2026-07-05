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
declare function renderAnsi(
  tokens: HighlightToken[],
  useColor: boolean
): string;

export {
  ATTRIBUTE_KEYS,
  type HighlightToken,
  LIGHT_ROLE_STYLES,
  NODE_TO_ROLE,
  NORD_ROLE_STYLES,
  ROLE_TO_ANSI,
  highlightDgmo,
  renderAnsi,
};
