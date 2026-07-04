/**
 * `@diagrammo/dgmo/element` — the universal `<dgmo-diagram>` custom element.
 *
 * A mermaid-style, framework-agnostic client-side web component. Drop the
 * IIFE script (`dist/element.js`) on ANY page — Hugo, Jekyll, MkDocs,
 * VitePress, plain HTML — and author diagrams as:
 *
 * ```html
 * <script src="https://unpkg.com/@diagrammo/dgmo/dist/element.js"></script>
 * <dgmo-diagram palette="nord">
 *   flowchart
 *   [Start] -> [Done]
 * </dgmo-diagram>
 * ```
 *
 * The element reads its DGMO source (a nested `<script type="text/dgmo">`,
 * a `<pre>`, or its own text content — de-indented), calls the isomorphic
 * `render()`, sanitizes the SVG, and injects it. Attributes: `palette`,
 * `theme`/`color-mode`, `mode` (diagram|showcase), `editor-base`,
 * `map-data-base`.
 *
 * DOM strategy — **light DOM** (not shadow DOM). Rationale: the rendered
 * SVG, source panel, and syntax-highlight token classes are all styled by
 * the shared `auto.css` (injected once via `ensureStyles()`). Cloning that
 * whole stylesheet into every shadow root would be heavy and would break
 * the `.dgmo-tok-*` highlight hooks; the CSS is already namespaced under
 * `.dgmo-*` so collision risk is low. See the CLAUDE.md embed notes.
 *
 * Map-data seam — the base bundle never statically imports the ~380 KB geo
 * JSON. Only when a diagram's first token is `map` does the element
 * lazy-`fetch()` the map assets from `map-data-base` (default: the pinned
 * unpkg `dist/map-data/` path) and inject them as `render({ mapData })`.
 * Fetched data is cached across every element on the page. Non-map diagrams
 * trigger ZERO extra network requests.
 */

declare class DgmoDiagram extends HTMLElement {
  static get observedAttributes(): readonly string[];
  /** DGMO source, captured from the original children ONCE before the first
   *  render replaces them. */
  private source;
  /** Monotonic render token — a late-resolving render/fetch whose token is
   *  stale (superseded by a newer attribute-driven render) is discarded. */
  private renderToken;
  private container;
  connectedCallback(): void;
  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null
  ): void;
  private readSource;
  private themePreference;
  private palette;
  private editorBase;
  private mapDataBase;
  private isShowcase;
  private mount;
  private showError;
  private rerender;
}
/** Idempotently define `<dgmo-diagram>`. Safe to call multiple times and in
 *  SSR/no-DOM contexts (no-ops when `customElements` is unavailable). */
declare function defineDgmoDiagram(): void;

export { DgmoDiagram, DgmoDiagram as default, defineDgmoDiagram };
