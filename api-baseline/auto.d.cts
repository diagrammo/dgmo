/**
 * `@diagrammo/dgmo/auto` — IIFE-distributed auto-renderer for static HTML.
 *
 * Drop a `<script src="…/auto.js">` on any page; on `DOMContentLoaded`
 * this module scans for `.dgmo, .language-dgmo`, runs `render()`, and
 * replaces each match with `<div class="dgmo-rendered">` containing the
 * SVG plus an optional collapsible source panel with Copy and
 * "Open in editor" actions.
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
declare const VERSION: string;
declare function findScriptTag(): HTMLScriptElement | null;
declare function parseConfig(raw: string | null | undefined): Partial<AutoConfig>;
declare function selectTargets(root?: ParentNode): Element[];
declare function resolveTheme(theme: AutoConfig['theme']): 'light' | 'dark' | 'transparent';
declare function initialize(opts?: AutoConfig): void;
declare function run(opts?: RunOptions): Promise<void>;
declare const api: Readonly<{
    initialize: typeof initialize;
    run: typeof run;
    version: string;
}>;

export { type AutoConfig, type RunOptions, VERSION, api as default, findScriptTag, initialize, parseConfig, resolveTheme, run, selectTargets };
