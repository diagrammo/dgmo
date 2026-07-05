/**
 * Shared browser-embed helpers for the `@diagrammo/dgmo` client-side
 * drop-ins (`./auto` script-tag renderer and `./element` custom element).
 *
 * These are the SVG sanitizer, theme resolver, the standard-block DOM
 * assembler (canonical chrome from `src/embed` — BL-114), the error card,
 * aria-label derivation, style injection, and share-URL builder — factored
 * out of `auto/index.ts` so the two entries share one implementation rather
 * than diverging copies. The `auto` entry's public `window.dgmo` surface is
 * unaffected; it imports from here.
 */
declare const VERSION: string;

type ThemePreference = 'auto' | 'light' | 'dark' | 'transparent';
declare function resolveTheme(
  theme: ThemePreference | undefined
): 'light' | 'dark' | 'transparent';

/**
 * `@diagrammo/dgmo/auto` — IIFE-distributed auto-renderer for static HTML.
 *
 * Drop a `<script src="…/auto.js">` on any page; on `DOMContentLoaded`
 * this module scans for `.dgmo, .language-dgmo`, runs `render()`, and
 * replaces each match with the standard DGMO embed block (BL-114,
 * `figure.dgmo.dgmo-rendered`) — the diagram plus a hover-reveal icon
 * toolbar with view-source, Copy, and "Open in editor" actions.
 *
 * Public API: frozen `window.dgmo` and alias `window.diagrammo` with
 * `{ initialize, run, version }`. Configuration is read from the
 * bundle's own `<script data-config='{…}'>` (JSON with strict
 * allowlist) or via `dgmo.initialize(opts)` for `data-auto="false"`
 * embedders.
 */

interface AutoConfig {
  theme?: 'auto' | 'light' | 'dark' | 'transparent';
  palette?: string;
  showSource?: boolean;
  showEditorLink?: boolean;
}
interface RunOptions {
  nodes?: Element[] | NodeListOf<Element>;
}

declare function findScriptTag(): HTMLScriptElement | null;
declare function parseConfig(
  raw: string | null | undefined
): Partial<AutoConfig>;
declare function selectTargets(root?: ParentNode): Element[];
declare function initialize(opts?: AutoConfig): void;
declare function run(opts?: RunOptions): Promise<void>;
declare const api: Readonly<{
  initialize: typeof initialize;
  run: typeof run;
  version: string;
}>;

export {
  type AutoConfig,
  type RunOptions,
  VERSION,
  api as default,
  findScriptTag,
  initialize,
  parseConfig,
  resolveTheme,
  run,
  selectTargets,
};
