/**
 * Canonical stylesheet for the standard DGMO embed block (BL-114).
 *
 * Shipped two ways: `dist/block.css` (extracted at build time by
 * tsup.config.ts, same regex mechanism as auto.css) for `<link>`/import
 * consumers, and the `BLOCK_CSS` string export for embedders that inject a
 * `<style>` tag.
 *
 * Dark mode keys off BOTH `[data-theme="dark"]` (Starlight, Docusaurus) and
 * `html.dark` (Tailwind, next-themes, VitePress), because those two cover
 * essentially every host and picking one silently left the other half of the
 * ecosystem with a diagram that never toggled. A host on a third signal
 * (`body.theme-dark`) still rewrites the selector at its build step —
 * fumadocs-dgmo/nextra-dgmo's build-css.mjs is the reference adapter.
 *
 * 🔴 Keep the two conventions in SEPARATE rule blocks. `auto/styles.ts`
 * re-scopes the `[data-theme="dark"]` rules onto `.dgmo-theme-dark` with a
 * regex that swallows everything up to the `{`, so folding them into one
 * multi-selector rule would drag `html.dark` into the re-scoped copy too.
 *
 * The `.dgmo-tok-*` role colors mirror LIGHT_ROLE_STYLES (light) and
 * NORD_ROLE_STYLES (dark) from editor/highlight-api.ts. A parity test
 * (tests/block.test.ts) guards against drift — update both when either
 * changes.
 *
 * IMPORTANT: keep this a single pure template literal — the build extracts it
 * with a regex, so no interpolation or computed values.
 */
export const BLOCK_CSS: string = `
/* @diagrammo/dgmo block — standard embed chrome.
 * Dark mode is keyed on a data-theme="dark" attribute (Starlight, Docusaurus)
 * AND an html.dark class (Tailwind, next-themes, VitePress), so all of those
 * work as shipped. Add your own selector if your site marks dark a third way.
 *
 * No selector is spelled in bracket form anywhere in these comments on
 * purpose: the adapters that re-key the attribute rules onto another host's
 * signal match that exact substring, and a mention inside a comment would be
 * swallowed into a rule they then emit as garbage. */

/* === Color-mode visibility (dual-render) ===
 * The dark wrapper also carries an inline display:none, so a page that never
 * loaded this stylesheet shows the light diagram rather than both of them.
 * The two reveal rules are !important because of it: an inline declaration
 * outranks every normal author rule, and only an important one beats it.
 *
 * That inline style replaced the "hidden" ATTRIBUTE in issue 647. Tailwind v4
 * hides [hidden] with !important from inside a cascade layer, and a layered
 * important declaration outranks an unlayered one at ANY specificity — so no
 * rule here could reveal the dark wrapper, and every diagram on a Tailwind v4
 * host was a zero-height empty box in dark mode.
 * Keep the two host conventions in separate rule blocks — the adapters
 * rewrite by literal replace and a folded rule would half-rewrite. */
.dgmo-dark {
  display: none;
}
[data-theme="dark"] .dgmo-light {
  display: none;
}
[data-theme="dark"] .dgmo-dark {
  display: block !important;
}
html.dark .dgmo-light {
  display: none;
}
html.dark .dgmo-dark {
  display: block !important;
}

/* === Diagram sizing ===
 * SVGs are emitted with viewBox only (no fixed width/height). Force them to
 * fill their wrapper so light and dark variants render at identical sizes. */
.dgmo-light > svg,
.dgmo-dark > svg,
.dgmo-svg > svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
}

/* === Toolbar ===
 * The diagram is the star: the toolbar is an overlay pinned to the diagram's
 * bottom-right corner (position:absolute — it reserves no layout space, so the
 * block is exactly as tall as the chart). Bottom-right (not top-right) so it
 * never collides with a host's own top-right chart chrome — e.g. Obsidian's
 * code-block copy button. It stays fully transparent until the block is
 * hovered or focused, or the source panel is open. It is the <summary> of the
 * source <details>, so toggling works without any JS. No text labels, no
 * disclosure triangle — three wordless icon buttons.
 *
 * Anchored to .dgmo-source-wrap (position:relative below), whose top edge is
 * always the diagram's bottom edge — bottom:calc(100% + gap) therefore keeps
 * the toolbar at the diagram's bottom-right whether the source panel is open or
 * closed (a figure-anchored bottom would drift down below the open code). */
.dgmo-source-wrap {
  margin: 0;
  position: relative;
}
.dgmo-toolbar {
  position: absolute;
  bottom: calc(100% + 0.4em);
  right: 0.4em;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25em;
  padding: 0.15em;
  opacity: 0;
  transition: opacity 0.15s ease;
  cursor: pointer;
  list-style: none;
  user-select: none;
  color: rgba(127, 127, 127, 0.9);
}
.dgmo-toolbar::-webkit-details-marker {
  display: none;
}
/* Reveal is keyed to the diagram IMAGE (the svg wrappers), not the whole
 * figure — hovering the open code panel keeps the page quiet. The toolbar's
 * own :hover keeps it alive while the pointer travels down from the image
 * (they're adjacent, so there's no dead gap). focus-within covers keyboard
 * and touch-tap. */
.dgmo-light:hover ~ .dgmo-source-wrap > .dgmo-toolbar,
.dgmo-dark:hover ~ .dgmo-source-wrap > .dgmo-toolbar,
.dgmo-svg:hover ~ .dgmo-source-wrap > .dgmo-toolbar,
.dgmo-toolbar:hover,
.dgmo:focus-within .dgmo-toolbar {
  opacity: 1;
}
/* Touch devices have no hover: keep the icons faintly visible so the
 * affordance is discoverable at all. */
@media (hover: none) {
  .dgmo-toolbar {
    opacity: 0.5;
  }
}

.dgmo-toggle,
.dgmo-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9em;
  height: 1.9em;
  border-radius: 0.35em;
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  cursor: pointer;
  opacity: 0.75;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease;
}
.dgmo-toggle:hover,
.dgmo-toolbar-btn:hover {
  opacity: 1;
  background: rgba(127, 127, 127, 0.12);
}
.dgmo-toggle svg,
.dgmo-toolbar-btn svg {
  width: 1em;
  height: 1em;
}
/* Active state while the source panel is open. */
.dgmo-source-wrap[open] > .dgmo-toolbar .dgmo-toggle {
  opacity: 1;
  background: rgba(127, 127, 127, 0.15);
}
.dgmo-copy--success {
  color: #5cba7a;
  opacity: 1;
}

/* === Full-screen lightbox ===
 * The expand button clones the visible diagram into a native <dialog> that
 * the client shows with showModal(): top-layer, so it escapes any transformed
 * or overflow-clipped ancestor (docs sidebars) and fills the whole viewport.
 * Escape / backdrop-click / the close button dismiss it. The <dialog> itself
 * fills the viewport with a transparent background (so a click landing on it
 * — outside the centered card — reads as a backdrop dismiss); the dim comes
 * from ::backdrop. */
.dgmo-lightbox {
  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: hidden;
}
.dgmo-lightbox[open] {
  display: flex;
  align-items: center;
  justify-content: center;
}
.dgmo-lightbox::backdrop {
  background: rgba(0, 0, 0, 0.72);
}
.dgmo-lightbox-svg {
  width: 95vw;
  max-width: 95vw;
  max-height: 95vh;
  overflow: auto;
  border-radius: 0.5em;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
  /* Opaque surface behind the enlarged diagram so a transparent embed doesn't
   * show the page through it. The client overrides this inline with the block's
   * own palette bg (data-dgmo-bg); this is the fallback for blocks that predate
   * that attribute. */
  background: #fff;
}
[data-theme="dark"] .dgmo-lightbox-svg {
  background: #1e1e1e;
}
.dgmo-lightbox-svg > svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
}
.dgmo-lightbox-close {
  position: fixed;
  top: max(1rem, env(safe-area-inset-top));
  right: max(1rem, env(safe-area-inset-right));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4em;
  height: 2.4em;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.dgmo-lightbox-close:hover {
  background: rgba(0, 0, 0, 0.75);
}

/* === Frame the whole block ===
 * When the source panel is open, diagram + toolbar + code get one shared
 * border so the code visibly belongs to the chart above it. The frame box
 * (border + padding) is RESERVED at all times — with the border transparent
 * while closed — so opening the panel only paints the border in. It never
 * reflows the diagram. position:relative anchors the overlay toolbar to
 * this box. */
.dgmo:has(> .dgmo-source-wrap) {
  position: relative;
  border: 1px solid transparent;
  border-radius: 0.6em;
  padding: 0.75em 0.75em 0.5em;
}
.dgmo:has(> .dgmo-source-wrap[open]) {
  border-color: rgba(127, 127, 127, 0.3);
}

/* === Source panel (hidden until toggled) === */
.dgmo-source-inner {
  border-top: 1px solid rgba(127, 127, 127, 0.25);
  background: rgba(127, 127, 127, 0.06);
  overflow: hidden;
  margin: 0 -0.75em -0.5em;
  border-radius: 0 0 0.6em 0.6em;
}
.dgmo-pre {
  white-space: pre;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  line-height: 1.5;
  margin: 0;
  padding: 1em;
}
.dgmo-code {
  display: block;
}

/* === Error card === */
.dgmo--error {
  border: 1px solid rgba(220, 80, 80, 0.5);
  border-radius: 0.5em;
  padding: 0.75em 1em;
}
.dgmo--error pre {
  white-space: pre;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  margin: 0.5em 0 0;
}
.dgmo-error-docs {
  display: inline-block;
  margin-top: 0.6em;
  font-size: 0.9em;
  font-weight: bold;
  color: inherit;
}

/* === Source highlight roles ===
 * Light values mirror LIGHT_ROLE_STYLES; dark overrides mirror
 * NORD_ROLE_STYLES. Guarded by the parity test in tests/block.test.ts. */
.dgmo-tok-keyword {
  color: #3b6ea5;
  font-weight: bold;
}
.dgmo-tok-controlKeyword {
  color: #7d5ba6;
  font-weight: bold;
}
.dgmo-tok-definitionKeyword {
  color: #2f5a86;
  font-weight: bold;
}
.dgmo-tok-modifier {
  color: #7d5ba6;
}
.dgmo-tok-chartType {
  color: #b8691f;
  font-weight: bold;
}
.dgmo-tok-operator {
  color: #c0504d;
  font-weight: bold;
}
.dgmo-tok-number {
  color: #7d5ba6;
}
.dgmo-tok-comment {
  color: #677483;
  font-style: italic;
}
.dgmo-tok-heading {
  color: #b8691f;
  font-weight: bold;
}
.dgmo-tok-bracket {
  color: #5b6672;
}
.dgmo-tok-separator {
  color: #2d7268;
}
.dgmo-tok-deprecatedSyntax {
  color: #c0504d;
  text-decoration: line-through;
}
.dgmo-tok-url {
  color: #3b6ea5;
  text-decoration: underline;
}
.dgmo-tok-colorAnnotation {
  color: #b8691f;
  font-style: italic;
}
.dgmo-tok-punctuation {
  color: #677483;
}
.dgmo-tok-propertyName {
  color: #2d7268;
}
.dgmo-tok-string {
  color: #3f7a3b;
}
.dgmo-tok-noteContent {
  color: #677483;
  font-style: italic;
}

[data-theme="dark"] .dgmo-tok-keyword {
  color: #81a1c1;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-controlKeyword {
  color: #b48ead;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-definitionKeyword {
  color: #5e81ac;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-modifier {
  color: #b48ead;
}
[data-theme="dark"] .dgmo-tok-chartType {
  color: #d08770;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-operator {
  color: #bf616a;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-number {
  color: #b48ead;
}
[data-theme="dark"] .dgmo-tok-comment {
  color: #616e88;
  font-style: italic;
}
[data-theme="dark"] .dgmo-tok-heading {
  color: #d08770;
  font-weight: bold;
}
[data-theme="dark"] .dgmo-tok-bracket {
  color: #5e81ac;
}
[data-theme="dark"] .dgmo-tok-separator {
  color: #88c0d0;
}
[data-theme="dark"] .dgmo-tok-deprecatedSyntax {
  color: #bf616a;
  text-decoration: line-through;
}
[data-theme="dark"] .dgmo-tok-url {
  color: #88c0d0;
  text-decoration: underline;
}
[data-theme="dark"] .dgmo-tok-colorAnnotation {
  color: #d08770;
  font-style: italic;
}
[data-theme="dark"] .dgmo-tok-punctuation {
  color: #616e88;
}
[data-theme="dark"] .dgmo-tok-propertyName {
  color: #88c0d0;
}
[data-theme="dark"] .dgmo-tok-string {
  color: #a3be8c;
}
[data-theme="dark"] .dgmo-tok-noteContent {
  color: #616e88;
  font-style: italic;
}

/* === Live links ===
 * A withdrawn pointer's placeholder, and the "this moved" affordance a host's
 * client script falls back to when it can see a diagram has changed but cannot
 * safely swap it in. Both are deliberately quiet: a page peppered with badges
 * is worse than one that is a few days behind. */
.dgmo--tombstone {
  border: 1px dashed currentColor;
  border-radius: 6px;
  opacity: 0.6;
  padding: 1.5rem;
  text-align: center;
}
.dgmo-tombstone-text {
  font-size: 0.9em;
  margin: 0;
}
.dgmo-updated {
  display: block;
  font-size: 0.8em;
  margin-top: 0.4rem;
  opacity: 0.7;
  text-align: right;
}
/* The card a docs site shows when live links are switched OFF, plus its
 * hover-revealed way to turn them on. Hover-only on purpose: a READER never
 * meets it, and anyone mousing over a diagram-shaped thing on their own docs
 * site is almost certainly its author — which makes this the fix for a build
 * warning nobody reads. The markup is the WRAPPER's (only it knows the feature
 * is off); the styling is here because there is one stylesheet. */
.dgmo-live-link-off {
  position: relative;
}
.dgmo-live-link-view {
  display: block;
  text-decoration: none;
}
/* pointer-events: none alongside the fade, or an invisible link sits over the
 * card's bottom-right corner and navigates a reader who clicks near it. Focus
 * still reveals it (:focus-within on the wrapper), so a keyboard user is not
 * shut out of something a mouse user can reach. */
.dgmo-live-link-enable {
  bottom: 0.5rem;
  font-size: 0.8em;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  right: 0.5rem;
  transition: opacity 0.15s ease-in-out;
}
.dgmo-live-link-off:hover .dgmo-live-link-enable,
.dgmo-live-link-off:focus-within .dgmo-live-link-enable {
  opacity: 1;
  pointer-events: auto;
}
@media (prefers-reduced-motion: reduce) {
  .dgmo-live-link-enable {
    transition: none;
  }
}
`;
