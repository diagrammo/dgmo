/**
 * Static CSS for `@diagrammo/dgmo/auto` (and `./element`, which shares the
 * same injector).
 *
 * As of BL-114 the diagram + source chrome is the canonical standard block
 * from `src/embed` — its styles ship in `BLOCK_CSS` and are appended below.
 * This file only keeps the auto-surface-specific rules: anti-flash hiding,
 * the `.dgmo-rendered` container reset, and the loading hint.
 *
 * `BLOCK_CSS` keys its dark-mode overrides off `[data-theme="dark"]`; the
 * browser surfaces resolve the theme themselves and stamp a
 * `.dgmo-theme-dark` class on the wrapper, so a re-scoped copy of the dark
 * rules is appended too (same adapter pattern as fumadocs/nextra's
 * build-css.mjs, done here at module init).
 *
 * The string is a literal — no template interpolation of user-supplied
 * values. All selectors are prefixed `.dgmo-` to avoid collisions with
 * embedder styles. Class names are part of the SemVer-stable surface — see
 * "SemVer policy" in the README HTML section.
 *
 * IMPORTANT: keep AUTO_BASE_CSS a single pure template literal — tsup's
 * emitAutoCss extracts it (plus BLOCK_CSS) with a regex to build
 * `dist/auto.css`, mirroring the concatenation done at the bottom of this
 * file. Update tsup.config.ts if the assembly here changes.
 */

import { BLOCK_CSS } from '../embed/css';

const AUTO_BASE_CSS: string = `
/* anti-flash: hide source elements until either render swaps them out
   or the error path replaces them with the standard error card */
pre.dgmo, code.language-dgmo, pre > code.language-dgmo,
.dgmo:not(svg *):not(.dgmo-rendered):not(.dgmo-rendered *):not(.dgmo--error):not(.dgmo--error *) {
  visibility: hidden;
}
.dgmo-rendered, .dgmo-rendered *,
.dgmo--error, .dgmo--error * {
  visibility: visible !important;
}

.dgmo-rendered {
  display: block;
  position: relative;
  margin: 1em 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color-scheme: light dark;
}

.dgmo--loading {
  opacity: 0.6;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
`;

/** Re-scope BLOCK_CSS's \`[data-theme="dark"]\` rules to `.dgmo-theme-dark`. */
function darkScopedBlockCss(css: string): string {
  const rules = css.match(/\[data-theme="dark"\][^{]*\{[^}]*\}/g) ?? [];
  return rules
    .map((rule) => rule.replace(/\[data-theme="dark"\]/g, '.dgmo-theme-dark'))
    .join('\n');
}

export const CSS: string =
  AUTO_BASE_CSS +
  '\n' +
  BLOCK_CSS +
  '\n' +
  darkScopedBlockCss(BLOCK_CSS) +
  '\n';
